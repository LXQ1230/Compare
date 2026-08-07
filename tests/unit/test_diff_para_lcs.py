"""段落级 LCS 大文档 diff 路径测试（2026-08-06 落地）。

覆盖：重建一致性、边界（空/单段/全 eq/全替换）、替换组限长 fine/coarse、
标点归因防线在段内行为、阈值切换、校验失败回退全局路径。
"""

import pytest

from src_backend.diff_engine import (
    _SEP,
    _LARGE_DOC_THRESHOLD,
    diff_texts,
    diff_texts_para_lcs,
    diff_texts_with_style,
)


def _rebuild(segments, side):
    """按 diff segments 重构一侧文本（side: 'a'=原版 / 'b'=修改版）。"""
    return "".join(
        s["text"] for s in segments
        if s["operation"] in ("none", "del" if side == "a" else "add")
        or (s["operation"] == "mod" and s.get("side") == ("old" if side == "a" else "new"))
    )


def _para(text: str) -> str:
    """构造带段落分隔符的文档。"""
    return text


class TestParaLcsRebuild:
    """重建一致性是段落路径的正确性硬保证（与全局路径同构）。"""

    @pytest.mark.parametrize("a,b", [
        ("", ""),
        ("只有一段。", "只有一段。"),
        ("只有一段。", "只有一段，改。"),
        ("甲\u2029乙\u2029丙", "甲\u2029乙\u2029丙"),
        ("甲\u2029乙\u2029丙", "甲\u2029丙"),                      # 删段
        ("甲\u2029乙\u2029丙", "甲\u2029乙\u2029乙2\u2029丙"),      # 插段
        ("甲\u2029乙\u2029丙", "丙\u2029乙\u2029甲"),              # 重排
        ("甲\u2029乙\u2029丙", "甲2\u2029丁\u2029丙"),              # 改段
        ("甲\u2029乙\u2029丙", "甲\u2029乙\u2029"),                 # 末段删空
        ("甲\u2029乙\u2029", "甲\u2029乙\u2029丙"),                 # 空段补内容
    ])
    def test_rebuild_consistency(self, a, b):
        segments, stats = diff_texts_para_lcs(a, b)
        assert _rebuild(segments, "a") == a, f"A 侧重建不一致: {a!r}"
        assert _rebuild(segments, "b") == b, f"B 侧重建不一致: {b!r}"

    def test_large_replace_group_coarse(self):
        """替换组总长 > 4096 → coarse（段落级 DEL+ADD），重建仍一致。

        注：coarse 输出 DEL+ADD 相邻，_build_segments 按既有语义合成为
        mod（side old/new）——与全局路径的替换展示一致。
        """
        long_a = "段甲" + "字" * 3000
        long_b = "段乙" + "字" * 3000
        a = long_a + _SEP + "相同段"
        b = long_b + _SEP + "相同段"
        segments, stats = diff_texts_para_lcs(a, b)
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b
        mods = [s for s in segments if s["operation"] == "mod"]
        assert mods
        old_text = "".join(s["text"] for s in mods if s.get("side") == "old")
        new_text = "".join(s["text"] for s in mods if s.get("side") == "new")
        # coarse 段含段尾 U+2029（split_keep 保留）→ 3002 + 1
        assert len(old_text) == 3003 and old_text.startswith("段甲") and old_text.endswith(_SEP)
        assert len(new_text) == 3003 and new_text.startswith("段乙") and new_text.endswith(_SEP)

    def test_identical_docs(self):
        segments, stats = diff_texts_para_lcs("甲\u2029乙\u2029丙", "甲\u2029乙\u2029丙")
        assert stats["total"] == 0
        assert all(s["operation"] == "none" for s in segments)

    def test_single_para_no_sep(self):
        segments, stats = diff_texts_para_lcs("无段落分隔符文档", "无段落分隔符，修改版")
        assert _rebuild(segments, "a") == "无段落分隔符文档"
        assert _rebuild(segments, "b") == "无段落分隔符，修改版"


class TestParaLcsPunctSemantics:
    """标点归因防线在段落路径中必须与全局路径语义一致（用户核心诉求）。"""

    def _ops(self, fn, a, b):
        segments, _ = fn(a, b)
        return [(s["operation"], s.get("side"), s["text"]) for s in segments]

    def test_punct_insert_same_as_global(self):
        a = "我聞如是\u2029一時佛在舍衛國"
        b = "我聞。如是。\u2029一時佛在舍衛國。"
        para = self._ops(diff_texts_para_lcs, a, b)
        glob = self._ops(diff_texts, a, b)
        assert para == glob

    def test_punct_transposition_same_as_global(self):
        a = "舎衛國。在\u2029彼時"
        b = "舎衛。國在\u2029彼時"
        para = self._ops(diff_texts_para_lcs, a, b)
        glob = self._ops(diff_texts, a, b)
        assert para == glob

    def test_ws_hidden_in_fine_group(self):
        """段内「行尾空白 → 标点」折叠为 ADD 标点（W 归因）。"""
        a = "道祖筆受\n\u2029次段"
        b = "道祖筆受。\u2029次段"
        segments, _ = diff_texts_para_lcs(a, b)
        ops = [(s["operation"], s["text"]) for s in segments]
        assert ("add", "。") in ops
        assert not any(op == "del" for op, _ in ops)  # 空白删除被隐藏


class TestParaLcsNormalizedHash:
    """方案 B：归一化哈希段落 LCS（2026-08-07）。

    LCS eq 判定从原文精确哈希改为归一化哈希（_strip_sep 剥离标点+空白+U+2029）：
    只差标点/空白/段落分隔符的段直接对齐为 eq，不再进替换组；eq 段对原文
    不同时用 _coarse_punct_alignment 间隙对齐细粒度化（回退段内 DMP）。
    """

    def _ops(self, fn, a, b):
        segments, _ = fn(a, b)
        return [(s["operation"], s.get("side"), s["text"]) for s in segments]

    def test_punct_only_diff_aligns_as_eq(self):
        """两段仅标点不同 → 对齐为 eq（段对间隙对齐），不再整段 DEL+ADD。"""
        a = "我聞如是。一時。\u2029佛逰舎衛國。在勝林給孤獨園。"
        b = "我聞如是。一時。\u2029佛逰舎衛國。在勝林給孤獨園。"  # 无差异
        # 构造仅标点差异：段1 加标点
        a = "我聞如是。一時。\u2029佛逰舎衛國在勝林給孤獨園"
        b = "我聞如是。一時。\u2029佛逰舎衛國。在勝林給孤獨園。"
        segments, stats = diff_texts_para_lcs(a, b)
        ops = [(s["operation"], s.get("side"), s["text"]) for s in segments]
        # 实词保持 none（段对间隙对齐），标点归因为 add
        assert ("add", None, "。") in ops
        assert not any(op in ("del", "mod") for op, _, _ in ops)
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b

    def test_sep_move_between_paras_eq(self):
        """仅段落分隔符位置差异 → 段对间隙对齐，分隔符增删可见。"""
        a = "經卷第三\u2029東晉譯\u2029次段"
        b = "經卷第三東晉譯\u2029次段"
        segments, stats = diff_texts_para_lcs(a, b)
        ops = [(s["operation"], s.get("side"), s["text"]) for s in segments]
        # U+2029 删除可见（结构变化），实词保持 none
        assert ("del", None, "\u2029") in ops
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b

    def test_empty_normalized_para(self):
        """归一化后为空的段（纯 \u2029 / \u3000\u2029）LCS 对齐正确。"""
        a = "甲\u2029\u3000\u2029乙\u2029"
        b = "甲\u2029\u2029乙\u2029"
        segments, stats = diff_texts_para_lcs(a, b)
        # A 侧允许空白差异（\u3000 被 W 归因隐藏）；B 侧严格相等
        from src_backend.diff_engine import _strip_ws
        assert _strip_ws(_rebuild(segments, "a")) == _strip_ws(a)
        assert _rebuild(segments, "b") == b

    def test_duplicate_template_para(self):
        """重复模板段（归一化哈希相同）贪心对齐无副作用，重建一致。"""
        tmpl_a = "東晉罽賓三藏瞿曇僧伽提婆譯\u2029"
        tmpl_b = "東晉罽賓三藏瞿曇僧伽提婆譯。\u2029"
        a = tmpl_a + tmpl_a + "正文"
        b = tmpl_b + tmpl_b + "正文"
        segments, stats = diff_texts_para_lcs(a, b)
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b
        ops = [(s["operation"], s.get("side"), s["text"]) for s in segments]
        # 模板段只差标点 → 对齐 eq + 间隙对齐（ADD 。），无整段 DEL+ADD
        assert ("add", None, "。") in ops
        assert not any(op == "del" and t == tmpl_a for op, side, t in ops)

    def test_real_rewrite_still_goes_through_replace_group(self):
        """实词不同（真重写）→ 归一化哈希不同 → 进替换组，不误对齐。"""
        a = "中阿含經卷第三十七\u2029正文"
        b = "中阿含經卷第四十一\u2029正文"
        segments, stats = diff_texts_para_lcs(a, b)
        ops = [(s["operation"], s.get("side"), s["text"]) for s in segments]
        # 第三十七/第四十一 是实词差异 → mod（替换），正文保持 none（与段尾 U+2029 合并）
        assert any(op == "mod" for op, _, _ in ops)
        assert any(op == "none" and "正文" in t for op, _, t in ops)
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b

    def test_eq_pair_fallback_to_dmp(self):
        """归一化对齐但间隙对齐返回 None（如空归一化 + 标点差异）→ 回退段内 DMP。"""
        # 段对 '\u2029' vs '。\u2029'：_strip_sep 后均空 → coarse 返回 None
        # → 回退 _diff_fine_group，DMP 输出 DEL '。'? 不——是 ADD '。'
        a = "甲\u2029乙"
        b = "甲。\u2029乙"
        segments, stats = diff_texts_para_lcs(a, b)
        ops = [(s["operation"], s.get("side"), s["text"]) for s in segments]
        assert ("add", None, "。") in ops
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b


class TestParaLcsSwitch:
    """规模阈值自动切换 + 失败回退。"""

    def test_large_doc_uses_para_path(self, monkeypatch):
        called = {}

        def fake_para(orig, modified, spans_a=None, spans_b=None):
            called["para"] = True
            return diff_texts_para_lcs(orig, modified, spans_a, spans_b)

        monkeypatch.setattr("src_backend.diff_engine.diff_texts_para_lcs", fake_para)
        a = "甲" + "字" * (_LARGE_DOC_THRESHOLD + 10)
        b = "甲" + "字" * (_LARGE_DOC_THRESHOLD + 10) + "尾"
        segments, stats = diff_texts_with_style(a, b)
        assert called.get("para") is True
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b

    def test_small_doc_uses_global_path(self, monkeypatch):
        called = {}

        def fake_para(orig, modified, spans_a=None, spans_b=None):
            called["para"] = True
            return diff_texts_para_lcs(orig, modified, spans_a, spans_b)

        monkeypatch.setattr("src_backend.diff_engine.diff_texts_para_lcs", fake_para)
        diff_texts_with_style("小文档", "小文档改")
        assert "para" not in called

    def test_para_failure_falls_back_to_global(self, monkeypatch):
        def boom(orig, modified, spans_a=None, spans_b=None):
            raise ValueError("para LCS rebuild mismatch — fallback to global DMP")

        monkeypatch.setattr("src_backend.diff_engine.diff_texts_para_lcs", boom)
        a = "甲" + "字" * (_LARGE_DOC_THRESHOLD + 10)
        b = "甲" + "字" * (_LARGE_DOC_THRESHOLD + 10) + "尾"
        segments, stats = diff_texts_with_style(a, b)
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b
