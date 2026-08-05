"""IDML 字体名 → 本机可用字体映射表（设计方案 §2.4 三级策略）。

三级映射：
  1. 精确匹配：FONT_MAP 中命中的字体名 → 本机字体家族名
  2. 前缀匹配：PREFIX_MAP 按序匹配（如 '思源宋体' → SourceHanSerifCN 系列）
  3. 回退链：未命中的字体 → FALLBACK_SERIF/SANS，并记录不可用告警

输出为 CSS font-family 名称（前端直接使用），全部为字符串字面量，
可通过修改本表扩展（可配置），无需改动解析器。
"""

# ── 精确匹配表：IDML 字体名 → CSS font-family ────────────────────
# 本机可用性为 2026-08-05 实证（方案 §2.4）：✅ 可用 / ❌ 不可用（回退）
FONT_MAP: dict[str, str] = {
    "思源宋体 CN": "SourceHanSerifCN",
    "思源宋体 SC": "SourceHanSerifCN",
    "思源黑体 CN": "SourceHanSansCN",
    "思源黑体 SC": "SourceHanSansCN",
    "仿宋 (OTF)": "FangSong",
    "仿宋_GB2312": "FangSong",
    "Adobe 宋体 Std": "AdobeSongStd",
    "Adobe 黑体 Std": "AdobeHeitiStd",
    "Minion Pro": "MinionPro",
    "Times New Roman": "Times New Roman",
}

# ── 前缀匹配表（有序）：前缀 → CSS font-family ───────────────────
# '思源宋体' 覆盖 '思源宋体 CN'/'思源宋体 SC'/'思源宋体 HW' 等所有变体
# 经书粗宋（本机不可用）按方案 §2.4 回退思源宋体 + font-weight 700
PREFIX_MAP: list[tuple[str, str]] = [
    ("思源宋体", "SourceHanSerifCN"),
    ("思源黑体", "SourceHanSansCN"),
    ("思源", "SourceHanSerifCN"),
    ("仿宋", "FangSong"),
    ("Adobe 宋体", "AdobeSongStd"),
    ("Adobe 黑体", "AdobeHeitiStd"),
    ("Minion", "MinionPro"),
    ("经书粗宋", "SourceHanSerifCN"),
]

# ── 回退链 ───────────────────────────────────────────────────────
FALLBACK_SERIF = "serif"
FALLBACK_SANS = "sans-serif"

# 已知但本机不可用的字体 → 回退到指定字体 + 告警文案（方案 §2.4：
# 方正粗雅宋长/汉仪大宋繁/经书粗宋 均回退思源宋体；经书粗宋另按 bold 模拟）
UNKNOWN_FALLBACK: dict[str, str] = {
    "方正粗雅宋长": "SourceHanSerifCN",
    "经书粗宋": "SourceHanSerifCN",
    "汉仪大宋繁": "SourceHanSerifCN",
    "法藏": "SourceHanSerifCN",
}

UNKNOWN_WARNINGS: dict[str, str] = {
    "方正粗雅宋长": "方正粗雅宋长 本机未安装，已回退为思源宋体。",
    "经书粗宋": "经书粗宋 本机未安装，已回退为思源宋体（加粗模拟）。",
    "汉仪大宋繁": "汉仪大宋繁 本机未安装，已回退为思源宋体。",
    "法藏": "法藏系列字体本机未安装，已回退为思源宋体。",
}

# 粗体回退的字体（经书粗宋等按 bold 模拟，方案 §2.4）
_BOLD_FALLBACK_PREFIXES = ("经书粗宋", "粗宋")

# 无衬线倾向的字体关键词（用于选择 sans-serif 回退链）
_SANS_KEYWORDS = ("黑体", "黑", "Heiti", "Sans", "Source Han Sans")


def map_font(idml_font: str) -> tuple[str, bool]:
    """三级映射：IDML 字体名 → (CSS font-family, available)。

    available=False 表示命中已知但本机不可用的字体（回退链生效，含告警）；
    未知字体同样返回通用回退链（serif/sans-serif），available=False。
    """
    if not idml_font:
        return FALLBACK_SERIF, False
    # 1. 精确匹配
    if idml_font in FONT_MAP:
        return FONT_MAP[idml_font], True
    # 2. 前缀匹配（含已知不可用字体 → 指定回退目标，available=False）
    for prefix, mapped in PREFIX_MAP:
        if idml_font.startswith(prefix):
            return mapped, True
    for prefix, mapped in UNKNOWN_FALLBACK.items():
        if idml_font.startswith(prefix):
            return mapped, False
    # 3. 通用回退链
    if any(k in idml_font for k in _SANS_KEYWORDS):
        return FALLBACK_SANS, False
    return FALLBACK_SERIF, False


def font_warning(idml_font: str) -> str | None:
    """已知不可用字体的告警文案；可用字体或未知字体返回 None。"""
    if not idml_font:
        return None
    for prefix, msg in UNKNOWN_WARNINGS.items():
        if idml_font.startswith(prefix):
            return msg
    return None


def is_bold_fallback(idml_font: str) -> bool:
    """该字体是否需要以 font-weight:700 模拟粗体（经书粗宋系列）。"""
    return any(idml_font.startswith(p) for p in _BOLD_FALLBACK_PREFIXES)
