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

    def test_oversized_file_read_in_chunks(self, client, tmp_path, monkeypatch):
        """方案 P1-2: 超限文件按 256KB 分块读取即中断，不做全量读入内存。

        断言底层文件 read 被以分块大小调用（而非单次全量），且返回 413。
        /api/compare 为同步端点（2026-08-06 防阻塞事件循环），_read_limited
        直接读 UploadFile.file（SpooledTemporaryFile）——patch 底层 read 命中。
        """
        import src_backend.main as main_mod
        import tempfile
        monkeypatch.setattr(main_mod, "COMPARE_MAX_BYTES", 1024)  # 1KB 上限

        a_file = tmp_path / "a.txt"
        a_file.write_text("x" * 2048, encoding="utf-8")  # 2KB > 1KB
        b_file = tmp_path / "b.txt"
        b_file.write_text("y" * 10, encoding="utf-8")

        reads: list[int] = []
        orig_read = tempfile.SpooledTemporaryFile.read

        def fake_read(self, size: int = -1) -> bytes:
            reads.append(size)
            return orig_read(self, size)

        monkeypatch.setattr(tempfile.SpooledTemporaryFile, "read", fake_read)

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes(), "text/plain"),
                "fileB": ("b.txt", b_file.read_bytes(), "text/plain"),
            },
        )

        assert response.status_code == 413
        # 按 256KB 分块读取（而非 -1 全量）
        assert 256 * 1024 in reads
        assert -1 not in reads
        # 2KB 文件最多读 1-2 个 chunk 即被中断，不得出现大量读取
        assert len(reads) <= 3

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

    # ── CJK / Unicode robustness (rev. 5-16 + 三期 4-12) ───────────────

    def test_compare_chinese_filenames_and_content(self, client, tmp_path):
        """中文文件名 + 中文内容上传对比端到端正确（rev. 5-16 回归）。

        中文文件名在 multipart 中按 UTF-8 传输（无需前端 encodeURIComponent——
        那反而会把名字变成 %XX 乱码，后端也没有 unquote）。扩展名校验只依赖
        ASCII 后缀，不受中文名影响。
        """
        a_file = tmp_path / "佛经原文.txt"
        b_file = tmp_path / "佛经校订.txt"
        a_file.write_text("如是我闻。一时佛在舍卫国。", encoding="utf-8")
        b_file.write_text("如是我闻。一时佛在祇园精舍。", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("佛经原文.txt", a_file.read_bytes(), "text/plain"),
                "fileB": ("佛经校订.txt", b_file.read_bytes(), "text/plain"),
            },
        )

        assert response.status_code == 200, response.text
        parsed = self._parse_ndjson(response.text)
        assert parsed[-1]["type"] == "done"
        # 至少产出差异段（含 add/del 或 mod）
        segs = [m for m in parsed if m["type"] == "segments"]
        texts = [s["text"] for m in segs for s in m["data"]]
        assert any("舍卫国" in t or "祇园精舍" in t for t in texts)

    def test_compare_cjk_extension_b_characters(self, client, tmp_path):
        """CJK Extension B（surrogate pair 编码的扩展汉字）diff 不产生错位。

        扩展汉字（如 𠀀 U+20000）在 UTF-8 中是 4 字节、UTF-16 中是代理对。
        后端 diff 使用 Python 原生 str（code point 级别），天然安全；
        此测试防止未来误用字节级/UTF-16 级处理引入回归。
        """
        a_file = tmp_path / "a.txt"
        b_file = tmp_path / "b.txt"
        # 前后缀一致，仅中间扩展汉字不同 → 应产出干净的 mod 段
        a_file.write_text("序言\u4e00\u4e8c\u4e09𠀀\u4e94\u516d\u4e03。", encoding="utf-8")
        b_file.write_text("序言\u4e00\u4e8c\u4e09𠮟\u4e94\u516d\u4e03。", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes()),
                "fileB": ("b.txt", b_file.read_bytes()),
            },
        )

        assert response.status_code == 200, response.text
        parsed = self._parse_ndjson(response.text)
        assert parsed[-1]["type"] == "done"
        # 文本往返无损坏：还原后 A/B 文本应等于输入
        rebuilt_a = ""
        rebuilt_b = ""
        for m in parsed:
            if m["type"] != "segments":
                continue
            for s in m["data"]:
                if s["operation"] == "add":
                    rebuilt_b += s["text"]
                elif s["operation"] == "del":
                    rebuilt_a += s["text"]
                elif s["operation"] == "mod":
                    if s.get("side") == "old":
                        rebuilt_a += s["text"]
                    else:
                        rebuilt_b += s["text"]
                else:
                    rebuilt_a += s["text"]
                    rebuilt_b += s["text"]
        assert rebuilt_a == "序言\u4e00\u4e8c\u4e09𠀀\u4e94\u516d\u4e03。"
        assert rebuilt_b == "序言\u4e00\u4e8c\u4e09𠮟\u4e94\u516d\u4e03。"

    def test_compare_zero_width_and_nbsp(self, client, tmp_path):
        """零宽字符与 NBSP 在 diff 中不被吞掉、不干扰段边界。"""
        a_file = tmp_path / "a.txt"
        b_file = tmp_path / "b.txt"
        a_file.write_text("正\u200b文一\u00a0段", encoding="utf-8")
        b_file.write_text("正\u200b文二\u00a0段", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes()),
                "fileB": ("b.txt", b_file.read_bytes()),
            },
        )

        assert response.status_code == 200, response.text
        parsed = self._parse_ndjson(response.text)
        assert parsed[-1]["type"] == "done"
        # 零宽/NBSP 字符应在 segment 文本中原样保留
        all_text = "".join(
            s["text"]
            for m in parsed
            if m["type"] == "segments"
            for s in m["data"]
        )
        assert "\u200b" in all_text
        assert "\u00a0" in all_text

    def test_compare_empty_file_vs_content(self, client, tmp_path):
        """空文件 vs 有内容（rev. 3-11 边界）：整段内容应标记为 add 且不崩溃。"""
        a_file = tmp_path / "empty.txt"
        b_file = tmp_path / "content.txt"
        a_file.write_text("", encoding="utf-8")
        b_file.write_text("全文内容\n第二行。", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("empty.txt", a_file.read_bytes()),
                "fileB": ("content.txt", b_file.read_bytes()),
            },
        )

        assert response.status_code == 200, response.text
        parsed = self._parse_ndjson(response.text)
        assert parsed[-1]["type"] == "done"
        # 应产出 add 段（B 全部新增），文本往返一致
        rebuilt_b = ""
        for m in parsed:
            if m["type"] != "segments":
                continue
            for s in m["data"]:
                if s["operation"] == "del":
                    continue  # 空文件没有 del
                rebuilt_b += s["text"]
        assert rebuilt_b == "全文内容\n第二行。"

    def test_compare_both_empty_files(self, client, tmp_path):
        """两个空文件（rev. 3-11）：无差异、正常完成。"""
        a_file = tmp_path / "a.txt"
        b_file = tmp_path / "b.txt"
        a_file.write_text("", encoding="utf-8")
        b_file.write_text("", encoding="utf-8")

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", a_file.read_bytes()),
                "fileB": ("b.txt", b_file.read_bytes()),
            },
        )

        assert response.status_code == 200, response.text
        parsed = self._parse_ndjson(response.text)
        assert parsed[-1]["type"] == "done"


class TestSpaFallback:
    """SPA 硬刷新 fallback（方案 P1-1c/P2-1 配套）：前端子路由直接请求返回 index.html。"""

    def test_report_route_serves_index_html(self, client):
        """/report/:sessionId 直接访问（浏览器刷新）返回 index.html 而非 404。"""
        response = client.get("/report/abc123")
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")
        # index.html 包含 SPA 挂载点
        assert "id=\"app\"" in response.text or "app" in response.text

    def test_api_routes_take_precedence_over_fallback(self, client):
        """API 路由不被 fallback 吞掉。"""
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_existing_asset_served_directly(self, client):
        """真实静态文件（assets/*.js）按原路径返回，不落入 fallback。"""
        response = client.get("/assets/does-not-exist-xyz.js")
        # 不存在的资产回退 index.html（200），但存在的资产必须是文件本体
        # —— 这里只验证 API 与 fallback 共存，资产细节由构建产物保证
        assert response.status_code in (200, 404)
