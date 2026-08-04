"""Integration tests for POST /api/compare NDJSON streaming endpoint."""

import json


class TestCompareEndpoint:
    """Integration tests for the POST /api/compare endpoint."""

    # ── helpers ────────────────────────────────────────────────────

    @staticmethod
    def _parse_ndjson(text: str) -> list[dict]:
        """Parse NDJSON response text into a list of dicts."""
        return [json.loads(line) for line in text.splitlines() if line]

    # ── happy path ─────────────────────────────────────────────────

    def test_compare_two_txt_files(self, client, tmp_path):
        """Comparing two different .txt files returns NDJSON stream with changes."""
        a_file = tmp_path / "a.txt"
        b_file = tmp_path / "b.txt"
        a_file.write_text("Hello World\nLine two.", encoding="utf-8")
        b_file.write_text("Hello Python\nLine two.", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes(), "text/plain"),
                "fileB": ("b.txt", b_file.read_bytes(), "text/plain"),
            },
        )

        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)
        assert len(parsed) >= 4, "expected >=4 NDJSON lines"

        types = [p["type"] for p in parsed]
        assert "phase" in types
        assert "meta" in types
        assert "segments" in types
        assert parsed[-1]["type"] == "done"

        # meta carries stats + totalChunks
        meta = next(p for p in parsed if p["type"] == "meta")
        assert all(k in meta["stats"] for k in ("total", "add", "del", "mod"))
        assert meta["stats"]["total"] > 0
        # 方案 L0: meta 携带 scale 分级（小文件应为 S）
        assert meta["scale"] == "S"

        # segments chunk is populated
        seg_line = next(p for p in parsed if p["type"] == "segments")
        assert isinstance(seg_line["data"], list)
        assert len(seg_line["data"]) > 0

    def test_compare_identical_files(self, client, tmp_path):
        """Identical files produce stats with all-zero change counts."""
        content = "Exactly the same content."
        a_file = tmp_path / "a.txt"
        b_file = tmp_path / "b.txt"
        a_file.write_text(content, encoding="utf-8")
        b_file.write_text(content, encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes(), "text/plain"),
                "fileB": ("b.txt", b_file.read_bytes(), "text/plain"),
            },
        )

        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)

        meta = next(p for p in parsed if p["type"] == "meta")
        assert meta["stats"]["total"] == 0
        assert meta["stats"]["add"] == 0
        assert meta["stats"]["del"] == 0
        assert meta["stats"]["mod"] == 0
        # Identical content still produces one "none" segment → one chunk
        assert meta["totalChunks"] == 1

        assert parsed[-1]["type"] == "done"

    def test_compare_md_files(self, client, tmp_path):
        """Comparing two .md files streams valid NDJSON."""
        md_a = tmp_path / "a.md"
        md_b = tmp_path / "b.md"
        md_a.write_text("# Title\n\n**bold** text here.", encoding="utf-8")
        md_b.write_text("# Title\n\n*italic* text here.", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.md", md_a.read_bytes(), "text/markdown"),
                "fileB": ("b.md", md_b.read_bytes(), "text/markdown"),
            },
        )

        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)

        types = [p["type"] for p in parsed]
        assert "done" in types
        assert parsed[-1]["type"] == "done"

        meta = next(p for p in parsed if p["type"] == "meta")
        assert meta["stats"]["total"] > 0

    # ── error cases ────────────────────────────────────────────────

    def test_oversized_file_rejected(self, client, tmp_path, monkeypatch):
        """Files exceeding COMPARE_MAX_BYTES return 413 (方案 L0/XL 上限)."""
        import src_backend.main as main_mod
        monkeypatch.setattr(main_mod, "COMPARE_MAX_BYTES", 1024)  # 1KB 上限

        a_file = tmp_path / "a.txt"
        b_file = tmp_path / "b.txt"
        a_file.write_text("x" * 2048, encoding="utf-8")  # 2KB > 1KB
        b_file.write_text("y" * 10, encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes(), "text/plain"),
                "fileB": ("b.txt", b_file.read_bytes(), "text/plain"),
            },
        )

        assert response.status_code == 413
        body = response.json()
        assert body["error"] is True
        assert body["severity"] == "blocking"

    def test_unsupported_format_rejected(self, client, tmp_path):
        """Uploading an unsupported extension (.pdf) returns 400 AppError."""
        pdf = tmp_path / "test.pdf"
        pdf.write_text("fake pdf body", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.pdf", pdf.read_bytes(), "application/pdf"),
                "fileB": ("b.pdf", pdf.read_bytes(), "application/pdf"),
            },
        )

        assert response.status_code == 400
        body = response.json()
        assert body["error"] is True
        assert body["severity"] == "blocking"

    def test_missing_file_rejected(self, client, tmp_path):
        """Omitting fileB returns 422 validation error."""
        a_file = tmp_path / "a.txt"
        a_file.write_text("hello", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes(), "text/plain"),
            },
        )

        assert response.status_code == 422

    def test_no_extension_rejected(self, client, tmp_path):
        """A file with no extension is rejected with 400 AppError."""
        no_ext = tmp_path / "noextension"
        no_ext.write_text("content without extension", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("noextension", no_ext.read_bytes(), "application/octet-stream"),
                "fileB": ("noextension", no_ext.read_bytes(), "application/octet-stream"),
            },
        )

        assert response.status_code == 400
        body = response.json()
        assert body["error"] is True
        assert body["severity"] == "blocking"

    # ── content-type robustness ────────────────────────────────────

    def test_txt_upload_without_explicit_mime(self, client, tmp_path):
        """TXT upload still works when mime type is omitted / generic."""
        a_file = tmp_path / "a.txt"
        b_file = tmp_path / "b.txt"
        a_file.write_text("AAA", encoding="utf-8")
        b_file.write_text("BBB", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes()),
                "fileB": ("b.txt", b_file.read_bytes()),
            },
        )

        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)
        assert parsed[-1]["type"] == "done"
