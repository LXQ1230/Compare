"""End-to-end integration tests covering the full compare workflow.

These tests exercise the complete user journey:
1. Compare two files via POST /api/compare with NDJSON streaming
2. Version save/restore after a compare session
3. Autosave save/load for editor drafts
4. Health check availability
"""

import json


class TestFullCompareFlow:
    """End-to-end tests from upload through NDJSON streaming to version archive."""

    @staticmethod
    def _parse_ndjson(text: str) -> list[dict]:
        """Parse NDJSON response text into a list of dicts."""
        return [json.loads(line) for line in text.splitlines() if line]

    def test_txt_full_compare_flow(self, client, tmp_path, monkeypatch):
        """Complete flow: compare two .txt files → inspect stream → save version."""
        # Arrange
        version_dir = tmp_path / "versions"
        monkeypatch.setenv("VERSION_DIR", str(version_dir))

        a_file = tmp_path / "alpha.txt"
        b_file = tmp_path / "beta.txt"
        a_file.write_text("Line one\nLine two\nLine three.", encoding="utf-8")
        b_file.write_text("Line one\nLine two modified\nLine three.", encoding="utf-8")

        # Act — compare
        response = client.post(
            "/api/compare",
            files={
                "fileA": ("alpha.txt", a_file.read_bytes(), "text/plain"),
                "fileB": ("beta.txt", b_file.read_bytes(), "text/plain"),
            },
        )

        # Assert — stream shape
        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)

        # Verify stream lifecycle: phase → meta → segments → done
        types = [p["type"] for p in parsed]
        assert "phase" in types
        assert "meta" in types
        assert "segments" in types
        assert parsed[-1]["type"] == "done"

        meta = next(p for p in parsed if p["type"] == "meta")
        assert meta["stats"]["total"] > 0

        # Extract file content for version save
        text_a = a_file.read_text(encoding="utf-8")
        text_b = b_file.read_text(encoding="utf-8")

        # Act — save a version of this compare session
        save_resp = client.post("/api/versions/save", json={
            "label": "E2E Session",
            "file_a_content": text_a,
            "file_b_content": text_b,
            "stats": meta["stats"],
        })
        assert save_resp.status_code == 200
        version_id = save_resp.json()["id"]
        assert len(version_id) == 12

        # Act — restore the version
        restore_resp = client.post(f"/api/versions/restore/{version_id}")
        assert restore_resp.status_code == 200
        restored = restore_resp.json()["version"]
        assert restored["file_a_content"] == text_a
        assert restored["file_b_content"] == text_b

    def test_md_compare_and_version_cycle(self, client, tmp_path, monkeypatch):
        """Compare markdown files, verify diff results, then save/restore version."""
        version_dir = tmp_path / "versions"
        monkeypatch.setenv("VERSION_DIR", str(version_dir))

        # Arrange
        md_a = tmp_path / "doc_a.md"
        md_b = tmp_path / "doc_b.md"
        md_a.write_text("# Heading\n\nFirst paragraph here.", encoding="utf-8")
        md_b.write_text("# Heading\n\nUpdated paragraph here.", encoding="utf-8")

        # Act — compare
        response = client.post(
            "/api/compare",
            files={
                "fileA": ("doc_a.md", md_a.read_bytes(), "text/markdown"),
                "fileB": ("doc_b.md", md_b.read_bytes(), "text/markdown"),
            },
        )

        # Assert
        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)
        assert parsed[-1]["type"] == "done"

        meta = next(p for p in parsed if p["type"] == "meta")
        assert meta["stats"]["total"] > 0

        # Segment chunks contain data with correct shape
        seg_lines = [p for p in parsed if p["type"] == "segments"]
        assert len(seg_lines) > 0
        for sl in seg_lines:
            for seg in sl["data"]:
                assert "text" in seg
                assert "operation" in seg
                assert seg["operation"] in ("add", "del", "mod", "none")

        # Save and list versions
        client.post("/api/versions/save", json={
            "label": "MD Session",
            "file_a_content": md_a.read_text(encoding="utf-8"),
            "file_b_content": md_b.read_text(encoding="utf-8"),
            "stats": meta["stats"],
        })

        list_resp = client.get("/api/versions/list")
        assert list_resp.status_code == 200
        assert len(list_resp.json()["versions"]) >= 1

    def test_autosave_draft_cycle(self, client, tmp_path, monkeypatch):
        """Full autosave lifecycle: save → load → update → load → delete."""
        autosave_dir = tmp_path / "autosaves"
        monkeypatch.setenv("AUTOSAVE_DIR", str(autosave_dir))

        # Save initial draft
        save_resp = client.post("/api/autosave", json={
            "action": "save",
            "key": "e2e-draft",
            "text": "Version 1 of the text.",
            "html": "<p>Version 1</p>",
            "time": 1000.0,
        })
        assert save_resp.status_code == 200

        # Load and verify
        load_resp = client.post("/api/autosave", json={
            "action": "load",
            "key": "e2e-draft",
        })
        assert load_resp.status_code == 200
        assert load_resp.json()["data"]["text"] == "Version 1 of the text."

        # Update draft (simulating continued editing)
        client.post("/api/autosave", json={
            "action": "save",
            "key": "e2e-draft",
            "text": "Version 2 — revised.",
            "html": "<p>Version 2</p>",
            "time": 2000.0,
        })

        # Load updated version
        updated = client.post("/api/autosave", json={
            "action": "load",
            "key": "e2e-draft",
        })
        assert updated.json()["data"]["text"] == "Version 2 — revised."

        # Delete
        del_resp = client.post("/api/autosave", json={
            "action": "delete",
            "key": "e2e-draft",
        })
        assert del_resp.status_code == 200

        # Confirm deletion
        gone = client.post("/api/autosave", json={
            "action": "load",
            "key": "e2e-draft",
        })
        assert gone.json()["data"] is None

    def test_version_cleanup_on_overflow(self, client, tmp_path, monkeypatch):
        """After saving >10 versions, only the 10 newest remain."""
        version_dir = tmp_path / "versions"
        monkeypatch.setenv("VERSION_DIR", str(version_dir))

        for i in range(12):
            client.post("/api/versions/save", json={
                "label": f"v{i}",
                "file_a_content": f"content_{i}_a",
                "file_b_content": f"content_{i}_b",
                "stats": {"total": i},
            })

        list_resp = client.get("/api/versions/list")
        versions = list_resp.json()["versions"]
        assert len(versions) == 10


class TestHealthAndSmoke:
    """Smoke tests for basic service health and error routing."""

    def test_health_endpoint(self, client):
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_compare_stream_is_valid_for_identical_files(self, client, tmp_path):
        """Identical .txt files produce valid NDJSON stream with zero changes."""
        content = "No differences here.\n"
        a_file = tmp_path / "same_a.txt"
        b_file = tmp_path / "same_b.txt"
        a_file.write_text(content, encoding="utf-8")
        b_file.write_text(content, encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("same_a.txt", a_file.read_bytes()),
                "fileB": ("same_b.txt", b_file.read_bytes()),
            },
        )

        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)
        # Stream must end with "done"
        assert parsed[-1]["type"] == "done"

        meta = next(p for p in parsed if p["type"] == "meta")
        assert meta["stats"]["total"] == 0
        assert meta["stats"]["add"] == 0
        assert meta["stats"]["del"] == 0
        assert meta["stats"]["mod"] == 0
        assert meta["totalChunks"] == 1

        # Identical text produces one "none" segment
        seg_lines = [p for p in parsed if p["type"] == "segments"]
        assert len(seg_lines) == 1
        assert seg_lines[0]["data"][0]["operation"] == "none"

    @staticmethod
    def _parse_ndjson(text: str) -> list[dict]:
        return [json.loads(line) for line in text.splitlines() if line]
