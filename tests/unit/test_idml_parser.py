"""IDML 解析器单测（设计方案 §9 测试策略 1/2/3）。

覆盖：
  - 7.idml 集成解析（text/spans/竖排/行高/段落分隔符/割注）
  - span 覆盖完整性（连续覆盖全文、无空洞）
  - font_map 三级映射 + 回退告警
  - 颜色映射（Registration / CMYK）
  - 防御：非 ZIP 头 / 坏 ZIP / XXE / zip bomb / 文本上限
"""

import io
import os
import tempfile
import zipfile

import pytest

from src_backend.errors import AppError
from src_backend.parsers.font_map import font_warning, is_bold_fallback, map_font
from src_backend.parsers.idml_parser import (
    MAX_TEXT_CHARS,
    MAX_UNCOMPRESSED_BYTES,
    PARA_SEP,
    REGISTRATION_COLOR,
    StyleSpan,
    _cmyk_to_hex,
    _map_fill_color,
    parse_idml,
)

FIXTURE_7 = os.path.join(
    os.path.dirname(__file__), "..", "..", "fixtures", "7.idml"
)


def _make_idml(story_xml: str, story_name: str = "u1") -> bytes:
    """构造最小 IDML zip（单 Story），供防御测试使用。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "designmap.xml",
            f'<?xml version="1.0"?><DesignMap StoryList="{story_name}"/>',
        )
        zf.writestr(f"Stories/Story_{story_name}.xml", story_xml)
    return buf.getvalue()


def _write_tmp(data: bytes, suffix: str = ".idml") -> str:
    f = tempfile.NamedTemporaryFile(mode="wb", suffix=suffix, delete=False)
    f.write(data)
    f.close()
    return f.name


class TestParseIdml7:
    """7.idml 集成解析（fixtures/7.idml，实证语料）。"""

    @pytest.fixture()
    def result(self):
        return parse_idml(FIXTURE_7)

    def test_text_nonempty_and_head(self, result):
        assert len(result.text) > 10_000
        assert result.text.startswith("原刻淨土四經敘")

    def test_paragraph_separators_br_driven(self, result):
        # 方案 §5.7 实证：Br 72 个 → U+2029 段落分隔符 72 个
        assert result.text.count(PARA_SEP) == 72

    def test_vertical_and_leading_meta(self, result):
        assert result.meta.vertical is True
        assert abs(result.meta.leading_ratio - 1.536) < 0.01
        assert result.meta.first_line_indent > 0

    def test_spans_cover_text_completely(self, result):
        """span 连续覆盖全文：无空洞、无重叠、首尾对齐。"""
        pos = 0
        for s in result.spans:
            assert s.start == pos, f"span 空洞 at {pos}"
            assert s.end > s.start, "空 span"
            pos = s.end
        assert pos == len(result.text)

    def test_warichu_spans_present(self, result):
        w = [s for s in result.spans if s.warichu]
        assert len(w) > 0
        assert sum(s.end - s.start for s in w) > 1000
        # 割注字号（40/60 两档）
        sizes = {s.warichu_size for s in w}
        assert sizes <= {40, 60}

    def test_fonts_mapped(self, result):
        # 正文主力思源宋体 CN → SourceHanSerifCN（方案 §2.4）
        assert any(s.font == "SourceHanSerifCN" for s in result.spans)
        # 不可用字体 → 告警
        assert any("回退" in w for w in result.meta.fonts_unavailable)

    def test_style_serialization_roundtrip(self, result):
        """span to_dict 瘦身 + from_dict 往返（字段不丢）。"""
        for s in result.spans[:50]:
            d = s.to_dict()
            assert d["start"] == s.start and d["end"] == s.end
            r = StyleSpan.from_dict(d)
            assert r.start == s.start and r.end == s.end
            assert r.warichu == s.warichu
            if s.warichu:
                assert r.warichu_size == s.warichu_size
            assert r.font == s.font
            assert r.bold == s.bold
            assert r.color == s.color


class TestStyleSpan:
    def test_to_dict_omits_defaults(self):
        sp = StyleSpan(start=0, end=5, font="SourceHanSerifCN")
        d = sp.to_dict()
        # 默认 sizePt/bold/color/warichu 被省略（§5.6 span 瘦身）
        assert "sizePt" not in d
        assert "bold" not in d
        assert "color" not in d
        assert "warichu" not in d
        assert d["font"] == "SourceHanSerifCN"

    def test_to_dict_keeps_non_defaults(self):
        sp = StyleSpan(
            start=0, end=3, font="FangSong", size_pt=20,
            bold=True, color="#C00000", warichu=True, warichu_size=40,
            baseline_shift=-9.2,
        )
        d = sp.to_dict()
        assert d["sizePt"] == 20
        assert d["bold"] is True
        assert d["color"] == "#C00000"
        assert d["warichu"] is True
        assert d["warichuSize"] == 40
        assert d["baselineShift"] == -9.2

    def test_slice_offsets(self):
        sp = StyleSpan(start=10, end=20, font="FangSong", bold=True)
        sub = sp.slice(3, 7)
        assert sub.start == 3 and sub.end == 7
        assert sub.font == "FangSong" and sub.bold is True


class TestFontMap:
    def test_exact_match(self):
        assert map_font("思源宋体 CN") == ("SourceHanSerifCN", True)
        assert map_font("仿宋 (OTF)") == ("FangSong", True)
        assert map_font("思源黑体 CN") == ("SourceHanSansCN", True)

    def test_prefix_match(self):
        assert map_font("思源宋体 SC") == ("SourceHanSerifCN", True)
        assert map_font("仿宋 GB18030") == ("FangSong", True)
        assert map_font("思源黑体 HW") == ("SourceHanSansCN", True)

    def test_unknown_fallback_with_warning(self):
        # 方正粗雅宋长 → 回退思源宋体 + 告警（方案 §2.4）
        css, avail = map_font("方正粗雅宋长_四川石油_GBK")
        assert css == "SourceHanSerifCN"
        assert avail is False
        assert font_warning("方正粗雅宋长_四川石油_GBK") is not None

    def test_ji_books_cu_song_bold_fallback(self):
        css, avail = map_font("经书粗宋1")
        assert css == "SourceHanSerifCN"
        assert is_bold_fallback("经书粗宋1") is True
        assert font_warning("经书粗宋1") is not None

    def test_unknown_generic(self):
        css, avail = map_font("SomeUnknownFont")
        assert avail is False
        assert css in ("serif", "sans-serif")

    def test_empty_font(self):
        css, avail = map_font("")
        assert css == "serif" and avail is False


class TestColorMapping:
    def test_registration(self):
        assert _map_fill_color("Color/Registration") == REGISTRATION_COLOR

    def test_cmyk(self):
        # C15 M100 Y100 K0 → 红（G/B 通道 0，R 约 217）
        assert _map_fill_color("Color/C=15 M=100 Y=100 K=0") == "#D90000"

    def test_none_or_unknown(self):
        assert _map_fill_color(None) == ""
        assert _map_fill_color("Swatch/None") == ""

    def test_cmyk_formula(self):
        assert _cmyk_to_hex(0, 0, 0, 0) == "#FFFFFF"
        assert _cmyk_to_hex(0, 100, 100, 0) == "#FF0000"


class TestDefenses:
    def test_non_zip_header_rejected(self):
        path = _write_tmp(b"this is not a zip at all")
        try:
            with pytest.raises(AppError) as ei:
                parse_idml(path)
            assert ei.value.status_code == 400
        finally:
            os.unlink(path)

    def test_corrupt_zip_rejected(self):
        path = _write_tmp(b"PK\x03\x04" + b"\x00" * 64)
        try:
            with pytest.raises(AppError):
                parse_idml(path)
        finally:
            os.unlink(path)

    def test_missing_designmap_rejected(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("Stories/Story_u1.xml", "<idPkg:Story/>")
        path = _write_tmp(buf.getvalue())
        try:
            with pytest.raises(AppError) as ei:
                parse_idml(path)
            assert "designmap" in ei.value.message
        finally:
            os.unlink(path)

    def test_xxe_declaration_rejected(self, monkeypatch):
        """Story 含 DOCTYPE/ENTITY 声明 → 拒绝（XXE 防御）。"""
        evil = (
            '<?xml version="1.0"?>'
            '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
            '<idPkg:Story><ParagraphStyleRange>'
            "<CharacterStyleRange><Content>&xxe;</Content></CharacterStyleRange>"
            "</ParagraphStyleRange></idPkg:Story>"
        )
        path = _write_tmp(_make_idml(evil))
        try:
            with pytest.raises(AppError) as ei:
                parse_idml(path)
            assert ei.value.status_code == 400
        finally:
            os.unlink(path)

    def test_zip_bomb_rejected(self, monkeypatch):
        """解压后体积超限 → 拒绝（§10，按 file_size 累计）。"""
        story = (
            '<idPkg:Story><ParagraphStyleRange>'
            "<CharacterStyleRange><Content>ABC</Content></CharacterStyleRange>"
            "</ParagraphStyleRange></idPkg:Story>"
        )
        path = _write_tmp(_make_idml(story))
        try:
            monkeypatch.setattr("src_backend.parsers.idml_parser.MAX_UNCOMPRESSED_BYTES", 10)
            with pytest.raises(AppError) as ei:
                parse_idml(path)
            assert ei.value.status_code == 413
        finally:
            os.unlink(path)

    def test_text_volume_limit(self, monkeypatch):
        """Story 文本总量超限 → 拒绝（§5.1 200 万字）。"""
        story = (
            '<idPkg:Story><ParagraphStyleRange>'
            "<CharacterStyleRange><Content>"
            + "字" * 1000
            + "</Content></CharacterStyleRange>"
            "</ParagraphStyleRange></idPkg:Story>"
        )
        path = _write_tmp(_make_idml(story))
        try:
            monkeypatch.setattr("src_backend.parsers.idml_parser.MAX_TEXT_CHARS", 100)
            with pytest.raises(AppError) as ei:
                parse_idml(path)
            assert ei.value.status_code == 413
        finally:
            os.unlink(path)

    def test_decorative_story_filtered(self):
        """装饰 Story（净字 < 50 且非最大）不进入 text（§6.8）。"""
        main_story = (
            '<idPkg:Story><ParagraphStyleRange>'
            "<CharacterStyleRange><Content>"
            + "正" * 200
            + "</Content></CharacterStyleRange>"
            "</ParagraphStyleRange></idPkg:Story>"
        )
        deco_story = (
            '<idPkg:Story><ParagraphStyleRange>'
            "<CharacterStyleRange><Content>装饰页眉</Content></CharacterStyleRange>"
            "</ParagraphStyleRange></idPkg:Story>"
        )
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "designmap.xml",
                '<DesignMap StoryList="u1 u2"/>',
            )
            zf.writestr("Stories/Story_u1.xml", main_story)
            zf.writestr("Stories/Story_u2.xml", deco_story)
        path = _write_tmp(buf.getvalue())
        try:
            r = parse_idml(path)
            assert "装饰页眉" not in r.text
            assert r.text.count("正") == 200
        finally:
            os.unlink(path)
