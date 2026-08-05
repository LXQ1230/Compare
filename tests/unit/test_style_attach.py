"""StyleSpan 附着测试（设计方案 §5.8 diff 偏移映射 + §6.1 侧归属）。

核心不变量：diff 序列能重构出 A/B 两侧原文；style 附着后同样能重构出
两侧的样式序列（与解析器 spans 完全一致）。该不变量证明游标映射无错位。
"""

import os

from src_backend.diff_engine import diff_texts_with_style
from src_backend.parsers.idml_parser import StyleSpan, parse_idml

FIXTURE_7 = os.path.join(
    os.path.dirname(__file__), "..", "..", "fixtures", "7.idml"
)


def _rebuild(segments, side):
    """按 diff segments 重构一侧文本。"""
    return "".join(
        s["text"] for s in segments
        if s["operation"] in ("none", "del" if side == "a" else "add")
        or (s["operation"] == "mod" and s.get("side") == ("old" if side == "a" else "new"))
    )


def _rebuild_styles(segments, side):
    """重构一侧样式为全文偏移的 (start, end, dict) 列表。"""
    out = []
    pos = 0
    for s in segments:
        op = s["operation"]
        take = (
            op in ("none", "del") or (op == "mod" and s.get("side") == "old")
        ) if side == "a" else (
            op in ("none", "add") or (op == "mod" and s.get("side") == "new")
        )
        if take:
            t = s["text"]
            for sp in s.get("style", []):
                out.append((pos + sp["start"], pos + sp["end"], sp))
            pos += len(t)
    return out


def _spans_as_list(spans):
    """(start, end, 样式属性 dict)——去掉冗余的 start/end 字段统一比较基准。"""
    out = []
    for sp in spans:
        d = sp.to_dict()
        out.append((sp.start, sp.end, {
            k: v for k, v in d.items() if k not in ("start", "end")
        }))
    return out


_STYLE_KEYS = ("font", "sizePt", "bold", "color", "warichu", "warichuSize",
               "baselineShift")


def _same_style(d1: dict, d2: dict) -> bool:
    return all(d1.get(k) == d2.get(k) for k in _STYLE_KEYS)


def _merge_adjacent_styles(seg_list):
    """把被 diff 段边界切碎的样式段，按相邻同签名合并回连续区间。"""
    out = []
    for s, e, d in sorted(seg_list, key=lambda x: x[0]):
        clean = {k: v for k, v in d.items() if k not in ("start", "end")}
        if out and out[-1][1] == s and _same_style(out[-1][2], clean):
            out[-1] = (out[-1][0], e, out[-1][2])
        else:
            out.append((s, e, clean))
    return out


class TestStyleAttachInvariant:
    """样式重构不变量：附着后的 style 能重构出与原始 spans 完全一致的序列。

    由于 diff 段边界会切碎样式区间（如 [0,4) 被 add 点切成 [0,3)+[3,4)），
    断言采用「合并等价」：把切碎段按相邻同签名合并后 == 原始 spans。
    该不变量证明游标映射无错位、无丢失、无多余。
    """

    def _check(self, text_a, text_b, spans_a, spans_b):
        segments, stats = diff_texts_with_style(
            text_a, text_b, spans_a, spans_b
        )
        # 文本重构（两侧原文不变量）
        assert _rebuild(segments, "a") == text_a
        assert _rebuild(segments, "b") == text_b
        # 样式合并等价（仅当该侧提供 spans）
        if spans_a:
            rebuilt = _rebuild_styles(segments, "a")
            merged = _merge_adjacent_styles(rebuilt)
            assert merged == _spans_as_list(spans_a), \
                f"A 侧样式合并不一致: {len(merged)} vs {len(spans_a)}"
        if spans_b:
            rebuilt = _rebuild_styles(segments, "b")
            merged = _merge_adjacent_styles(rebuilt)
            assert merged == _spans_as_list(spans_b), \
                f"B 侧样式合并不一致: {len(merged)} vs {len(spans_b)}"
        return segments

    def test_identical_texts(self):
        text = "AB\nCD"
        spans = [StyleSpan(0, 2, font="FangSong"), StyleSpan(2, 5)]
        self._check(text, text, spans, spans)

    def test_addition(self):
        # none 段位置两侧样式一致（'D' 两侧均默认）
        spans_a = [StyleSpan(0, 3, font="FangSong"), StyleSpan(3, 4)]
        spans_b = [StyleSpan(0, 3, font="FangSong"), StyleSpan(3, 7)]
        self._check("ABCD", "ABCxyzD", spans_a, spans_b)

    def test_deletion(self):
        # none 段 'D' 样式取 A 侧（§6.1）：A/B 侧 (3,4) 均用默认样式
        spans_a = [StyleSpan(0, 3, font="FangSong"), StyleSpan(3, 7)]
        spans_b = [StyleSpan(0, 3, font="FangSong"), StyleSpan(3, 4)]
        self._check("ABCxyzD", "ABCD", spans_a, spans_b)

    def test_modification(self):
        # B 侧在 mod 位置换样式；none 段位置两侧样式一致
        spans_a = [StyleSpan(0, 5, font="FangSong")]
        spans_b = [
            StyleSpan(0, 2, font="FangSong"),
            StyleSpan(2, 3, font="SourceHanSerifCN", bold=True),
            StyleSpan(3, 5, font="FangSong"),
        ]
        self._check("ABCDE", "ABxDE", spans_a, spans_b)

    def test_warichu_boundary_cut(self):
        """割注边界被 diff 切分：style 必须正确切片（§5.8 span 切分）。"""
        # A: 「佛說」+ 割注「阿彌陀」+「經」；B 在割注中间插入标点
        # B 侧 '阿彌。陀' 均为割注（割注内标点按普通字符折行，方案 §10）
        spans_a = [
            StyleSpan(0, 2, font="FangSong"),
            StyleSpan(2, 5, font="FangSong", warichu=True, warichu_size=40),
            StyleSpan(5, 6, font="FangSong"),
        ]
        spans_b = [
            StyleSpan(0, 2, font="FangSong"),
            StyleSpan(2, 6, font="FangSong", warichu=True, warichu_size=40),
            StyleSpan(6, 7, font="FangSong"),
        ]
        self._check("佛說阿彌陀經", "佛說阿彌。陀經", spans_a, spans_b)

    def test_no_spans_zero_overhead(self):
        """两侧无 spans → 不附着 style 字段，行为与 diff_texts 一致。"""
        segments, stats = diff_texts_with_style("abc", "abd")
        assert all("style" not in s for s in segments)

    def test_punct_rewrite_keeps_cursor_consistency(self):
        """标点归因重写后游标仍一致（L1 重写的核心防御）。"""
        text_a = "舎衛國。在"
        text_b = "舎衛。國在"
        # none 段位置两侧样式一致（'舎衛'、'國在' 均为 SourceHanSans）
        spans_a = [
            StyleSpan(0, 2, font="FangSong"),
            StyleSpan(2, 5, font="SourceHanSansCN"),
        ]
        spans_b = [
            StyleSpan(0, 2, font="FangSong"),
            StyleSpan(2, 3, font="SourceHanSansCN", bold=True),
            StyleSpan(3, 5, font="SourceHanSansCN"),
        ]
        self._check(text_a, text_b, spans_a, spans_b)


class TestStyleAttachSideOwnership:
    """侧归属（§6.1）：none 取 A 侧 / add 取 B 侧 / mod-old 取 A / mod-new 取 B。"""

    def test_none_takes_a_side(self):
        spans_a = [StyleSpan(0, 4, font="FangSong")]
        segments, _ = diff_texts_with_style("ABCD", "ABCD", spans_a, None)
        none_seg = next(s for s in segments if s["operation"] == "none")
        assert none_seg["style"][0]["font"] == "FangSong"

    def test_add_takes_b_side(self):
        spans_b = [StyleSpan(0, 6, font="SourceHanSerifCN", bold=True)]
        segments, _ = diff_texts_with_style("AB", "ABxyz", None, spans_b)
        add_seg = next(s for s in segments if s["operation"] == "add")
        assert add_seg["style"][0]["bold"] is True

    def test_mod_sides(self):
        spans_a = [StyleSpan(0, 5, font="FangSong")]
        spans_b = [StyleSpan(0, 5, font="SourceHanSansCN")]
        segments, _ = diff_texts_with_style("ABCDE", "ABXDE", spans_a, spans_b)
        old = next(s for s in segments if s.get("side") == "old")
        new = next(s for s in segments if s.get("side") == "new")
        assert old["style"][0]["font"] == "FangSong"
        assert new["style"][0]["font"] == "SourceHanSansCN"


class TestStyleAttachIdml7:
    """7.idml 实测：真实解析 + 修改版 diff 附着。"""

    def _load(self):
        r = parse_idml(FIXTURE_7)
        return r

    def test_attach_7_idml(self):
        r = self._load()
        # B 侧：替换一个字 + 尾注新增段落
        text_b = r.text.replace("淨土四經", "淨土五經", 1) + "新增尾注段落。"
        segments, stats = diff_texts_with_style(r.text, text_b, r.spans, None)
        assert stats["total"] > 0
        assert _rebuild(segments, "a") == r.text
        assert _rebuild(segments, "b") == text_b
        # A 侧样式完全重构
        assert _merge_adjacent_styles(_rebuild_styles(segments, "a")) == \
            _spans_as_list(r.spans)

    def test_both_sides_styled(self):
        r_a = self._load()
        text_b = r_a.text[:100] + "改" + r_a.text[101:] + "尾注。"
        # B 侧 spans：前段照抄 A 侧（1:1 对齐），尾部新增 3 字尾注
        spans_b = r_a.spans + [
            StyleSpan(len(r_a.text), len(r_a.text) + 1, font="SourceHanSerifCN"),
            StyleSpan(len(r_a.text) + 1, len(text_b)),
        ]
        segments, stats = diff_texts_with_style(
            r_a.text, text_b, r_a.spans, spans_b
        )
        assert _rebuild(segments, "b") == text_b
        assert _merge_adjacent_styles(_rebuild_styles(segments, "b")) == \
            _spans_as_list(spans_b)
