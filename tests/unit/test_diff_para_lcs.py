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
