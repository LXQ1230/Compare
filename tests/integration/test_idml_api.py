"""IDML 集成测试：/api/compare 上传 .idml → NDJSON 携带 style + docMeta。

覆盖（设计方案 §9 测试策略）：
  - IDML 与 IDML 对比：segments 携带 style、meta 携带 docMeta
  - IDML 与 TXT 混比（单侧 style 附着）
  - 防御：损坏 IDML → 明确 AppError
"""

import json
import os

FIXTURE_7 = os.path.join(
    os.path.dirname(__file__), "..", "..", "fixtures", "7.idml"
)


def _read7() -> bytes:
    with open(FIXTURE_7, "rb") as f:
        return f.read()


class TestCompareIdml:
    @staticmethod
    def _parse_ndjson(text: str) -> list[dict]:
        return [json.loads(line) for line in text.splitlines() if line]

    def test_idml_vs_idml_styled(self, client, tmp_path):
        """IDML vs IDML：segments 带 style，meta 带 docMeta（竖排/行高）。"""
        # B 侧：替换一个字符（构造修改版 IDML）
        import zipfile
        import io

        src = _read7()
        buf = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(src), "r") as zin:
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
                for item in zin.namelist():
                    data = zin.read(item)
                    if item == "Stories/Story_u15de.xml":
                        data = data.replace(
                            "淨土四經".encode("utf-8"),
                            "淨土五經".encode("utf-8"),
                        )
                    zout.writestr(item, data)
        b_bytes = buf.getvalue()

        response = client.post(
            "/api/compare",
            files={
                "fileA": ("7.idml", src, "application/octet-stream"),
                "fileB": ("7mod.idml", b_bytes, "application/octet-stream"),
            },
        )
        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)

        meta = next(p for p in parsed if p["type"] == "meta")
        assert meta["docMeta"]["vertical"] is True
        assert abs(meta["docMeta"]["leadingRatio"] - 1.536) < 0.01

        seg_lines = [p for p in parsed if p["type"] == "segments"]
        styled_count = 0
        none_styled = 0
        for line in seg_lines:
            for seg in line["data"]:
                if "style" in seg:
                    styled_count += 1
                    if seg["operation"] == "none":
                        none_styled += 1
        # 修改点（mod/add/del）与 none 段都应带 style（§5.8/§6.1）
        assert styled_count > 0
        assert none_styled > 0
        assert meta["stats"]["total"] > 0

    def test_idml_vs_txt_single_side_style(self, client, tmp_path):
        """IDML vs TXT：IDML 侧 style 附着，TXT 侧无 style（零开销）。"""
        response = client.post(
            "/api/compare",
            files={
                "fileA": ("7.idml", _read7(), "application/octet-stream"),
                "fileB": ("b.txt", "原刻淨土四經敘\u2029余友邵陽魏默深".encode("utf-8"), "text/plain"),
            },
        )
        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)
        meta = next(p for p in parsed if p["type"] == "meta")
        assert meta["docMeta"]["vertical"] is True

        any_styled = False
        for line in parsed:
            if line["type"] == "segments":
                for seg in line["data"]:
                    if "style" in seg:
                        any_styled = True
        assert any_styled, "IDML 侧应有 style 附着"

    def test_txt_vs_txt_no_style_zero_overhead(self, client, tmp_path):
        """txt vs txt：无 style 字段、无 docMeta（回归防线）。"""
        response = client.post(
            "/api/compare",
            files={
                "fileA": ("a.txt", b"hello world"),
                "fileB": ("b.txt", b"hello python"),
            },
        )
        assert response.status_code == 200
        parsed = self._parse_ndjson(response.text)
        meta = next(p for p in parsed if p["type"] == "meta")
        assert "docMeta" not in meta
        for line in parsed:
            if line["type"] == "segments":
                for seg in line["data"]:
                    assert "style" not in seg

    def test_corrupt_idml_rejected(self, client, tmp_path):
        """损坏的 IDML → 400 明确错误。"""
        response = client.post(
            "/api/compare",
            files={
                "fileA": ("bad.idml", b"PK\x03\x04" + b"\x00" * 32, "application/octet-stream"),
                "fileB": ("7.idml", _read7(), "application/octet-stream"),
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] is True
