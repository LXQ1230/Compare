"""IDML (InDesign Markup Language) 解析器 — 排版效果级呈现。

解析 .idml（ZIP 包）→ 结构化结果（设计方案 docs/IDML支持设计方案-2026-08-05.md）：

    text:  str          参与 diff 的纯文本（竖排转逻辑顺序；段落分隔符 U+2029，§5.7.1）
    spans: StyleSpan[]  字符级样式区间（连续合并压缩，§5.6）
    meta:  DocMeta      文档级排版元数据（竖排/行高系数/首行缩进）

安全防线：
  - ZIP 头校验（PK\\x03\\x04）+ 解压后体积上限（zip bomb，方案 §10，上限 250MB）
  - DOCTYPE/ENTITY 声明拒绝（XXE 防御——正则解析不展开实体，声明级拒绝双保险）
  - 文本总量上限（200 万字，§5.1）

解析骨架复用 JidouInject 实证过的正则方案（8 本经书，497 级 63 万字 ~1.8s），
差异点（方案深度挖掘结论）：
  - 段落边界由 <Br/> 驱动，非 PSR（§5.7）：Br → U+2029 段落分隔符（§5.7.1）
  - 样式提取扩展：Warichu/PointSize/FontStyle/FillColor/BaselineShift/AppliedFont/Leading
  - 相邻同签名 CSR 连续合并（§5.6），产出紧凑 StyleSpan
  - 装饰性 Story 过滤：「净字 < 50 且非最大 Story」（§6.8）
"""

import html
import os
import re
import zipfile
from dataclasses import dataclass, field, replace

from src_backend.errors import AppError, Severity
from src_backend.parsers.font_map import (
    font_warning,
    is_bold_fallback,
    map_font,
)

# ── 常量 ──────────────────────────────────────────────────────────
ZIP_MAGIC = b"PK\x03\x04"

# zip bomb：解压后总字节上限（方案 §10 实证 497 级 170.9MB → 上限 250MB）
MAX_UNCOMPRESSED_BYTES = int(os.environ.get("IDML_MAX_UNCOMPRESSED", "250000000"))
# 文本总量上限（200 万字，§5.1）
MAX_TEXT_CHARS = int(os.environ.get("IDML_MAX_TEXT_CHARS", "2000000"))
# 装饰性 Story 过滤阈值（§6.8：<50 净字 且 非最大 Story 才过滤）
MIN_STORY_CLEAN_CHARS = 50

# 段落分隔符（§5.7.1）：不在 diff_engine._WS_CHARS 中，段落合并/拆分差异可见
PARA_SEP = "\u2029"

# 默认正文样式（span 瘦身时省略与默认相同的字段）
DEFAULT_SIZE_PT = 28.0
DEFAULT_FONT = ""
DEFAULT_COLOR = ""

# 校勘标注色（Color/Registration → 醒目红，方案 §2.5）
REGISTRATION_COLOR = "#C00000"

# 旧标点（自检过滤用，与 JidouInject 一致——自检比对排除标点/空白/分隔符）
_OLD_PUNCT_CHARS = set(
    "。！？；：，、…—～「」『』（）《》〈〉【】〔〕｛｝·"
    ",.;:!?…~\"'()[]{}"
)

# PSR/CSR 双分支正则（自闭合空段兼容，JidouInject 同款）
_PSR_PATTERN = (
    r"(<ParagraphStyleRange[^>]*?/>"
    r"|<ParagraphStyleRange[^>]*>.*?</ParagraphStyleRange>)"
)
_CSR_PATTERN = r"<CharacterStyleRange([^>]*?)(?:>(.*?)</CharacterStyleRange>|/>)"
# Content 与 Br 按出现顺序统一匹配（段落边界 Br 驱动，§5.7）
_CONTENT_OR_BR_PATTERN = r"<Content>(.*?)</Content>|<Br\s*/>"

# 单个字符的 XML 声明/实体特征（XXE 探测）
_XXE_PATTERN = re.compile(r"<!DOCTYPE|<!ENTITY", re.IGNORECASE)


# ── 数据模型 ──────────────────────────────────────────────────────

@dataclass
class StyleSpan:
    """字符级样式区间（§4.1，附身后的偏移为 segment 内偏移）。"""

    start: int
    end: int
    font: str = ""
    size_pt: float = DEFAULT_SIZE_PT
    bold: bool = False
    color: str = ""
    warichu: bool = False
    warichu_size: int = 0
    baseline_shift: float = 0.0

    @property
    def _sig(self) -> tuple:
        """连续合并签名（§5.6）：样式相同才合并。"""
        return (
            self.font, self.size_pt, self.bold, self.color,
            self.warichu, self.warichu_size, self.baseline_shift,
        )

    def to_dict(self) -> dict:
        """span 瘦身（§5.6）：只传非默认值，压缩 NDJSON 体积。"""
        d: dict = {"start": self.start, "end": self.end}
        if self.font:
            d["font"] = self.font
        if self.size_pt != DEFAULT_SIZE_PT:
            d["sizePt"] = self.size_pt
        if self.bold:
            d["bold"] = True
        if self.color:
            d["color"] = self.color
        if self.warichu:
            d["warichu"] = True
            if self.warichu_size:
                d["warichuSize"] = self.warichu_size
        if self.baseline_shift:
            d["baselineShift"] = self.baseline_shift
        return d

    def slice(self, start: int, end: int) -> "StyleSpan":
        """按字符偏移切出子区间，偏移转为目标区间内相对值。"""
        return replace(
            self,
            start=start,
            end=end,
        )

    @classmethod
    def from_dict(cls, d: dict) -> "StyleSpan":
        return cls(
            start=d.get("start", 0),
            end=d.get("end", 0),
            font=d.get("font", ""),
            size_pt=d.get("sizePt", DEFAULT_SIZE_PT),
            bold=d.get("bold", False),
            color=d.get("color", ""),
            warichu=d.get("warichu", False),
            warichu_size=d.get("warichuSize", 0),
            baseline_shift=d.get("baselineShift", 0.0),
        )


@dataclass
class DocMeta:
    """文档级排版元数据（§5.3，随 NDJSON meta 行传输）。"""

    vertical: bool = False            # 竖排（StoryOrientation="Vertical"）
    leading_ratio: float = 1.536      # 行高系数（43/28，§2.3）
    first_line_indent: float = 0.0    # 首行缩进 pt（FirstLineIndent）
    fonts_unavailable: list = field(default_factory=list)  # 不可用字体告警

    def to_dict(self) -> dict:
        return {
            "vertical": self.vertical,
            "leadingRatio": self.leading_ratio,
            "firstLineIndent": self.first_line_indent,
            "fontsUnavailable": self.fonts_unavailable,
        }


@dataclass
class IdmlParseResult:
    text: str
    spans: list
    meta: DocMeta


# ── 颜色映射 ──────────────────────────────────────────────────────

def _cmyk_to_hex(c: float, m: float, y: float, k: float) -> str:
    """CMYK (0-100) → #RRGGBB（标准公式，无 ICC 校准，效果级够用，§2.5）。"""
    def _conv(v: float) -> int:
        return int(round(255 * (1 - v / 100) * (1 - k / 100)))
    return "#{:02X}{:02X}{:02X}".format(
        _conv(c), _conv(m), _conv(y)
    )


_CMYK_REF = re.compile(r"^C=(\d+)\s+M=(\d+)\s+Y=(\d+)\s+K=(\d+)$")


def _map_fill_color(fill_ref: str | None) -> str:
    """FillColor 引用 → CSS 颜色。

    Color/Registration → 校勘红（§2.5）；Color/C=M=Y=K= → CMYK 换算；
    其余（无/默认）→ 空串（黑色，span 瘦身省略）。
    """
    if not fill_ref:
        return ""
    if fill_ref == "Color/Registration":
        return REGISTRATION_COLOR
    # 引用格式为 "Color/C=15 M=100 Y=100 K=0"（§2.5 实证），剥离前缀后匹配 CMYK
    ref = fill_ref[6:] if fill_ref.startswith("Color/") else fill_ref
    m = _CMYK_REF.match(ref)
    if m:
        return _cmyk_to_hex(*[float(v) for v in m.groups()])
    return ""


# ── 入口 ──────────────────────────────────────────────────────────

def parse_idml(file_path: str) -> IdmlParseResult:
    """解析 IDML 文件 → 结构化结果（text + spans + meta）。"""
    _check_zip_header(file_path)

    try:
        zf = zipfile.ZipFile(file_path, "r")
    except zipfile.BadZipFile as e:
        raise AppError(
            Severity.BLOCKING,
            "文件格式无效",
            f"{os.path.basename(file_path)} 不是有效的 IDML 文件（ZIP 损坏）。",
            detail=str(e),
            status_code=400,
        )

    with zf:
        _check_zip_bomb(zf)
        try:
            designmap = zf.read("designmap.xml").decode("utf-8")
        except KeyError:
            raise AppError(
                Severity.BLOCKING,
                "文件格式无效",
                f"{os.path.basename(file_path)} 缺少 designmap.xml，不是有效的 IDML 文件。",
                status_code=400,
            )

        story_order = _parse_story_order(designmap)

        parsed_stories: list[dict] = []
        raw_story_xmls: dict[str, str] = {}
        total_chars = 0

        for story_name in story_order:
            story_path = f"Stories/Story_{story_name}.xml"
            if story_path not in zf.namelist():
                continue
            story_xml = zf.read(story_path).decode("utf-8")
            raw_story_xmls[story_name] = story_xml
            parsed = _parse_story_xml(story_xml)
            # 文本总量上限（方案 §5.1：200 万字，按净文本字符计——
            # XML 字节含标签会膨胀（497 级 XML 170MB → 净文本 63 万字））
            total_chars += sum(len(b["text"]) for b in parsed["blocks"])
            if total_chars > MAX_TEXT_CHARS:
                raise AppError(
                    Severity.BLOCKING,
                    "文件过大",
                    f"IDML 文本总量超过 {MAX_TEXT_CHARS // 10000} 万字上限，请拆分后对比。",
                    status_code=413,
                )
            parsed_stories.append({
                "name": story_name,
                "blocks": parsed["blocks"],
                "vertical": parsed["vertical"],
                "leading": parsed["leading"],
                "indent": parsed["indent"],
                "net_chars": parsed["net_chars"],
            })

    # 装饰性 Story 过滤（§6.8）：净字 < 50 且非最大 Story
    filtered = _filter_decorative_stories(parsed_stories)

    # 串接 blocks → text + 连续合并 spans（§5.6）
    text_parts: list[str] = []
    spans: list[StyleSpan] = []
    pos = 0
    for story in filtered:
        for block in story["blocks"]:
            if not block["text"]:
                continue
            sp = StyleSpan(
                start=pos,
                end=pos + len(block["text"]),
                font=block["font"],
                size_pt=block["size_pt"],
                bold=block["bold"],
                color=block["color"],
                warichu=block["warichu"],
                warichu_size=block["warichu_size"],
                baseline_shift=block["baseline_shift"],
            )
            if spans and spans[-1]._sig == sp._sig:
                # 连续合并：扩展上一 span（§5.6，避免逐 CSR 爆炸）
                spans[-1].end = sp.end
            else:
                spans.append(sp)
            text_parts.append(block["text"])
            pos += len(block["text"])

    text = "".join(text_parts)

    # 自检：正则交叉验证零丢失（JidouInject _verify_extraction 同款，§5.1）
    _verify_extraction(filtered, raw_story_xmls)

    # 文档级 meta：取第一个有效 Story 的排版属性
    vertical = any(s["vertical"] for s in filtered)
    leading = next((s["leading"] for s in filtered if s["leading"]), 0.0)
    indent = next((s["indent"] for s in filtered if s["indent"]), 0.0)
    leading_ratio = leading / DEFAULT_SIZE_PT if leading else 1.536
    fonts_unavailable = _collect_font_warnings(filtered)

    meta = DocMeta(
        vertical=vertical,
        leading_ratio=round(leading_ratio, 3),
        first_line_indent=indent,
        fonts_unavailable=fonts_unavailable,
    )
    return IdmlParseResult(text=text, spans=spans, meta=meta)


# ── 校验与防御 ────────────────────────────────────────────────────

def _check_zip_header(file_path: str) -> None:
    with open(file_path, "rb") as f:
        header = f.read(4)
    if header[:4] != ZIP_MAGIC:
        raise AppError(
            Severity.BLOCKING,
            "文件格式无效",
            f"{os.path.basename(file_path)} 不是有效的 IDML 文件（缺少 ZIP 文件头）。",
            detail=f"Expected PK\\x03\\x04 at offset 0, got {header[:4].hex()}",
            status_code=400,
        )


def _check_zip_bomb(zf: zipfile.ZipFile) -> None:
    """zip bomb 防护：按「解压后体积」上限（非上传字节，方案 §10）。

    用 ZipInfo.file_size（解压后大小，无需实际解压）累计，超限即拒。
    """
    total = sum(i.file_size for i in zf.infolist())
    if total > MAX_UNCOMPRESSED_BYTES:
        raise AppError(
            Severity.BLOCKING,
            "文件过大",
            f"IDML 解压后体积超过 {MAX_UNCOMPRESSED_BYTES // 1_000_000}MB 上限，"
            "该文件解压膨胀率异常（可能是压缩炸弹）。",
            status_code=413,
        )


# ── Story 解析 ────────────────────────────────────────────────────

def _parse_story_order(designmap_xml: str) -> list[str]:
    match = re.search(r'StoryList="([^"]*)"', designmap_xml)
    return match.group(1).split() if match else []


def _parse_story_xml(story_xml: str) -> dict:
    """解析单个 Story XML → 样式块序列 + 文档级属性。

    返回：{blocks, vertical, leading, indent, net_chars}
    """
    # XXE 防御：声明级拒绝（正则解析不展开实体，双保险）
    if _XXE_PATTERN.search(story_xml):
        raise AppError(
            Severity.BLOCKING,
            "文件格式无效",
            "IDML Story 含外部实体/DTD 声明，已拒绝解析（XXE 防护）。",
            status_code=400,
        )

    vertical = bool(re.search(r'StoryOrientation="Vertical"', story_xml))
    leading = 0.0
    indent = 0.0
    blocks: list[dict] = []

    # 默认字体：Story 内第一个显式 AppliedFont（CSR 无显式字体时继承，
    # 效果级近似 IDML 样式继承链，§2.4 正文主力思源宋体）
    default_font = ""
    m = re.search(r'<AppliedFont\s+type="string">([^<]+)</AppliedFont>', story_xml)
    if m:
        default_font = m.group(1)

    for psr_match in re.finditer(_PSR_PATTERN, story_xml, re.DOTALL):
        psr_xml = psr_match.group(1)

        # 段落级：FirstLineIndent（PSR 属性，§5.3）
        m = re.search(r'FirstLineIndent="([^"]+)"', psr_xml)
        if m:
            try:
                indent = float(m.group(1))
            except ValueError:
                pass

        _parse_psr_blocks(psr_xml, blocks, default_font)

    # 精确净字数（与自检同规则，§6.8 过滤用）
    net_chars = sum(_count_clean(b["text"]) for b in blocks)

    # Leading 取第一个有效值（Properties/Leading type="unit"，§5.3）
    if not leading:
        m = re.search(r'<Leading\s+type="unit">([\d.]+)</Leading>', story_xml)
        if m:
            try:
                leading = float(m.group(1))
            except ValueError:
                pass

    return {
        "blocks": blocks,
        "vertical": vertical,
        "leading": leading,
        "indent": indent,
        "net_chars": net_chars,
    }


def _parse_psr_blocks(psr_xml: str, blocks: list, default_font: str = "") -> None:
    """解析 PSR 内的 CSR → 样式块序列（Br → U+2029 段落边界）。"""
    for csr_match in re.finditer(_CSR_PATTERN, psr_xml, re.DOTALL):
        csr_attrs = csr_match.group(1) or ""
        csr_inner = csr_match.group(2) or ""

        # 样式属性（CSR 属性级 + Properties 内嵌；无显式字体 → 继承默认）
        font = _extract_applied_font(csr_inner) or default_font
        size_pt = _attr_float(csr_attrs, "PointSize", DEFAULT_SIZE_PT)
        font_style = _attr(csr_attrs, "FontStyle", "")
        bold = font_style in ("Heavy", "Bold", "Semibold", "Black") or is_bold_fallback(font)
        color = _map_fill_color(_attr(csr_attrs, "FillColor", ""))
        warichu = _attr(csr_attrs, "Warichu", "") == "true"
        warichu_size = int(_attr(csr_attrs, "WarichuSize", "0") or 0)
        baseline_shift = _attr_float(csr_attrs, "BaselineShift", 0.0)

        # 该 CSR 内部按出现顺序处理 Content / Br
        block_text = ""
        for cm in re.finditer(_CONTENT_OR_BR_PATTERN, csr_inner, re.DOTALL):
            if cm.group(1) is not None:
                block_text += html.unescape(cm.group(1))
            else:
                # <Br/> → 段落分隔符（§5.7.1）
                block_text += PARA_SEP

        if not block_text:
            continue

        # 样式块（稍后按签名连续合并）
        blocks.append({
            "text": block_text,
            "idml_font": font,
            "font": map_font(font)[0],
            "size_pt": size_pt,
            "bold": bold,
            "color": color,
            "warichu": warichu,
            "warichu_size": warichu_size,
            "baseline_shift": baseline_shift,
        })


def _extract_applied_font(csr_inner: str) -> str:
    m = re.search(r'<AppliedFont\s+type="string">([^<]+)</AppliedFont>', csr_inner)
    return m.group(1) if m else ""


def _attr(xml: str, name: str, default: str = "") -> str:
    m = re.search(rf'{name}="([^"]*)"', xml)
    return m.group(1) if m else default


def _attr_float(xml: str, name: str, default: float) -> float:
    m = re.search(rf'{name}="([^"]+)"', xml)
    if not m:
        return default
    try:
        return float(m.group(1))
    except ValueError:
        return default


# ── Story 过滤（§6.8）──────────────────────────────────────────────

def _filter_decorative_stories(stories: list[dict]) -> list[dict]:
    """装饰性 Story 过滤：「净字 < 50 且非最大 Story」。

    正文 Story 必为净字最大者——保证短正文（短经/残页）不被误杀。
    """
    if not stories:
        return stories
    max_net = max(s["net_chars"] for s in stories)
    return [
        s for s in stories
        if s["net_chars"] >= MIN_STORY_CLEAN_CHARS or s["net_chars"] == max_net
    ]


def _count_clean(text: str) -> int:
    """净字数：排除旧标点/空白/段落分隔符（与自检同规则）。"""
    n = 0
    for ch in text:
        if ch in _OLD_PUNCT_CHARS:
            continue
        if ch.isspace() or ch == PARA_SEP:
            continue
        n += 1
    return n


# ── 自检（§5.1）───────────────────────────────────────────────────

def _verify_extraction(stories: list[dict], raw_story_xmls: dict[str, str]) -> None:
    """正则交叉验证零丢失：独立从原始 XML 提取全部 Content 净字，
    与解析器产出逐 Story 比对，任何不一致 raise ValueError。
    """
    for story in stories:
        raw_xml = raw_story_xmls.get(story["name"])
        if raw_xml is None:
            continue

        # 独立提取（不依赖解析器）
        raw_contents = re.findall(r"<Content>(.*?)</Content>", raw_xml, re.DOTALL)
        raw_text = re.sub(r"<\?.*?\?>", "", "".join(raw_contents))
        raw_text = html.unescape(raw_text)
        raw_filtered = [ch for ch in raw_text if _is_clean(ch)]

        parsed_filtered: list[str] = []
        for b in story["blocks"]:
            for ch in b["text"]:
                if _is_clean(ch):
                    parsed_filtered.append(ch)

        raw_str = "".join(raw_filtered)
        parsed_str = "".join(parsed_filtered)

        if raw_str != parsed_str:
            min_len = min(len(raw_str), len(parsed_str))
            for i in range(min_len):
                if raw_str[i] != parsed_str[i]:
                    ctx = max(0, i - 30)
                    raise ValueError(
                        f"IDML 解析自检失败！Story '{story['name']}' 提取结果与原始 XML 不一致。\n"
                        f"原始 XML 净字数: {len(raw_str)}  解析器净字数: {len(parsed_str)}\n"
                        f"第一个差异在位置 {i}:\n"
                        f"  原始 XML: ...{raw_str[ctx:ctx + 60]}...\n"
                        f"  解析器:   ...{parsed_str[ctx:ctx + 60]}...\n"
                        f"  原始字符: U+{ord(raw_str[i]):04X} ('{raw_str[i]}')\n"
                        f"  解析字符: U+{ord(parsed_str[i]):04X} ('{parsed_str[i]}')\n"
                        f"这通常意味着解析器遗漏了某种 XML 结构。"
                    )
            raise ValueError(
                f"IDML 解析自检失败！Story '{story['name']}' 净字数不一致: "
                f"原始 XML {len(raw_str)} vs 解析器 {len(parsed_str)}"
            )


def _is_clean(ch: str) -> bool:
    """自检/净字用的"可见内容字符"判定（排除旧标点/空白/段落分隔符）。"""
    if ch in _OLD_PUNCT_CHARS:
        return False
    if ch.isspace() or ch == PARA_SEP:
        return False
    return True


def _collect_font_warnings(stories: list[dict]) -> list[str]:
    """汇总不可用字体的告警（font_map.font_warning，方案 §2.4）。"""
    warned: list[str] = []
    seen: set[str] = set()
    for story in stories:
        for b in story["blocks"]:
            idml_font = b.get("idml_font", "")
            if not idml_font or idml_font in seen:
                continue
            seen.add(idml_font)
            msg = font_warning(idml_font)
            if msg and msg not in warned:
                warned.append(msg)
    return warned
