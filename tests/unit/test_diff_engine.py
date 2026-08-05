from src_backend.diff_engine import (
    diff_texts, make_patches, apply_patches,
    _resolve_punct_substring, _resolve_punct_alignment, _resolve_whitespace,
)


def _rebuild(segments, side):
    """按 diff segments 重构一侧文本（side: 'a'=原版 / 'b'=修改版）。"""
    return "".join(
        s["text"] for s in segments
        if s["operation"] in ("none", "del" if side == "a" else "add")
        or (s["operation"] == "mod" and s.get("side") == ("old" if side == "a" else "new"))
    )


class TestDiffTexts:
    def test_identical_texts(self):
        segments, stats = diff_texts("hello world", "hello world")
        assert stats["total"] == 0
        assert all(s["operation"] == "none" for s in segments)

    def test_addition(self):
        segments, stats = diff_texts("abc", "abcd")
        assert stats["add"] > 0
        assert stats["total"] > 0

    def test_deletion(self):
        segments, stats = diff_texts("abcd", "abc")
        assert stats["del"] > 0

    def test_modification(self):
        segments, stats = diff_texts("abcd", "abXd")
        assert stats["mod"] > 0

    def test_empty_original(self):
        segments, stats = diff_texts("", "hello")
        assert stats["add"] > 0

    def test_empty_modified(self):
        segments, stats = diff_texts("hello", "")
        assert stats["del"] > 0

    def test_both_empty(self):
        segments, stats = diff_texts("", "")
        assert stats["total"] == 0

    def test_chinese_text(self):
        segments, stats = diff_texts("你好世界", "你好新世界")
        assert stats["total"] > 0


class TestPunctTransposition:
    """标点移动优先（2026-08-04 用户实测）：相邻「實词+标点」交换时，
    diff 应解释为「移动标点」（add 标点 + 实词不动 + del 标点），
    而非 DMP 默认的「移动实词」（del 实词 + add 实词）。"""

    def _ops(self, a, b):
        segments, _ = diff_texts(a, b)
        return [(s["operation"], s.get("side"), s["text"]) for s in segments]

    def test_punct_moved_instead_of_word(self):
        """用户场景：舎衛國。在 → 舎衛。國在（句号前移，'國' 不动）。"""
        ops = self._ops("佛逰舎衛國。在勝林", "佛逰舎衛。國在勝林")
        assert ("add", None, "。") in ops          # 國前新增句号
        assert ("none", None, "國") in ops         # 國保持不动
        assert ("del", None, "。") in ops          # 國后的句号被删
        # 不得再把'國'标成删除/新增
        assert ("del", None, "國") not in ops
        assert ("add", None, "國") not in ops

    def test_reconstruction_unchanged(self):
        """重写前后 A/B 两侧文本重构必须一致（数学等价，无信息丢失）。"""
        a = "我聞如是。一時。佛逰舎衛國。在勝林給孤獨園。"
        b = "我聞如是。一時。佛逰舎衛。國在勝林給孤獨園。"
        segments, _ = diff_texts(a, b)
        rebuilt_a = "".join(
            s["text"] for s in segments
            if s["operation"] in ("none", "del")
            or (s["operation"] == "mod" and s.get("side") == "old")
        )
        rebuilt_b = "".join(
            s["text"] for s in segments
            if s["operation"] in ("none", "add")
            or (s["operation"] == "mod" and s.get("side") == "new")
        )
        assert rebuilt_a == a
        assert rebuilt_b == b

    def test_far_apart_same_text_not_rewritten(self):
        """相距很远的 del X + add X 是独立操作，不得误判为交换。"""
        a = "甲X乙" + "中" * 500 + "丙"
        b = "甲乙" + "中" * 500 + "丙X"
        ops = self._ops(a, b)
        # 'X' 的删除与新增距离 > gap 上限 → 保持独立 del/add
        assert ("del", None, "X") in ops
        assert ("add", None, "X") in ops

    def test_non_punct_gap_not_rewritten(self):
        """间隔非标点（如汉字）时保持 DMP 原样（无法判断移动意图）。"""
        a = "甲乙丙"
        b = "甲丙乙"   # 两个字交换，间隔无标点
        ops = self._ops(a, b)
        # 不应出现「add 乙 + none 丙 + del 乙」这类重写（间隔非标点）
        # 仅断言不抛错且 A/B 重构正确
        segments, _ = diff_texts(a, b)
        rebuilt_a = "".join(
            s["text"] for s in segments
            if s["operation"] in ("none", "del")
            or (s["operation"] == "mod" and s.get("side") == "old")
        )
        rebuilt_b = "".join(
            s["text"] for s in segments
            if s["operation"] in ("none", "add")
            or (s["operation"] == "mod" and s.get("side") == "new")
        )
        assert rebuilt_a == "甲乙丙"
        assert rebuilt_b == "甲丙乙"


class TestPunctSubstring:
    """标点包裹插入/删除优先（L2，2026-08-05 用户实测）：原文「我聞如是」改为
    「我。聞。如是。」——DMP 把实词'聞'标成替换（DEL '聞' + ADD '。聞。'）。
    用户实际只是加标点，'聞'应保持不动，变更归因于标点。"""

    def _ops(self, a, b):
        segments, stats = diff_texts(a, b)
        return [(s["operation"], s.get("side"), s["text"]) for s in segments], stats

    def test_wrap_insert_both_sides(self):
        """用户场景：我聞如是 → 我。聞。如是（'聞'前后各加'。'，'聞'不动）。"""
        ops, stats = self._ops("我聞如是", "我。聞。如是")
        assert ("none", None, "聞") in ops      # '聞' 保持不动
        assert ("add", None, "。") in ops       # 新增标点标为 add
        assert stats["mod"] == 0                # 不得把'聞'标成替换
        assert ("mod", None, "聞") not in ops

    def test_wrap_delete_both_sides(self):
        """对称场景：我。聞。如是 → 我聞如是（删'聞'两侧的'。'）。"""
        ops, stats = self._ops("我。聞。如是", "我聞如是")
        assert ("none", None, "聞") in ops
        assert ("del", None, "。") in ops
        assert stats["mod"] == 0

    def test_prefix_and_suffix_punct(self):
        """单侧标点：'聞' → '。聞' / '聞。'（DMP 天然正确，重写不得破坏）。"""
        ops1, stats1 = self._ops("聞", "。聞")
        assert ("add", None, "。") in ops1
        assert ("none", None, "聞") in ops1
        assert stats1["mod"] == 0
        ops2, stats2 = self._ops("聞", "聞。")
        assert ("add", None, "。") in ops2
        assert ("none", None, "聞") in ops2
        assert stats2["mod"] == 0

    def test_real_change_not_rewritten(self):
        """真替换（新增内容含汉字）：'聞' → '。見聞。' 保持 mod，不得重写。"""
        ops, stats = self._ops("聞", "。見聞。")
        assert stats["mod"] == 1
        assert ("mod", "old", "聞") in ops
        assert ("mod", "new", "。見聞。") in ops

    def test_reconstruction_unchanged(self):
        """重写前后 A/B 两侧文本重构必须一致（数学等价，无信息丢失）。"""
        a = "我聞如是。一時。佛逰舎衛國。在勝林給孤獨園。"
        b = "我。聞。如是。一時。佛逰舎衛。國在勝林給孤獨園。"
        segments, _ = diff_texts(a, b)
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b

    def test_substring_rule_direct(self):
        """规则函数直测：DEL X + ADD(P+X+Q) → ADD P + EQ X + ADD Q。"""
        raw = [(-1, "聞"), (1, "。聞。")]
        out = _resolve_punct_substring(raw)
        assert out == [(1, "。"), (0, "聞"), (1, "。")]
        # 对称：DEL(P+Y+Q) + ADD Y → DEL P + EQ Y + DEL Q
        raw2 = [(-1, "。聞。"), (1, "聞")]
        assert _resolve_punct_substring(raw2) == [(-1, "。"), (0, "聞"), (-1, "。")]


class TestPunctAlignment:
    """实词对齐兜底（L3）：去标点后实词串相同的 DEL/ADD 对，强制标点归因。
    DMP 正常路径下几乎不触发（cleanupSemantic 已擅长保留实词），
    故以直接单测规则函数为主，保证该兜底逻辑本身正确。"""

    def test_single_char_reposition(self):
        """标点换位：'丙。' ↔ '。丙' → ADD '。' + EQ '丙' + DEL '。'。"""
        raw = [(-1, "丙。"), (1, "。丙")]
        out = _resolve_punct_alignment(raw)
        assert out == [(1, "。"), (0, "丙"), (-1, "。")]

    def test_punct_between_chars(self):
        """标点在实词中间：'聞。見' → '聞見' → DEL '。' 归位到字符间隙。"""
        raw = [(-1, "聞。見"), (1, "聞見")]
        out = _resolve_punct_alignment(raw)
        assert out == [(0, "聞"), (-1, "。"), (0, "見")]

    def test_punct_replacement_gap_kept(self):
        """同一间隙两侧标点不同 = 标点替换 → 保持 DEL+ADD（mod 语义正确）。"""
        raw = [(-1, "甲。"), (1, "甲，")]
        out = _resolve_punct_alignment(raw)
        assert out == [(0, "甲"), (-1, "。"), (1, "，")]

    def test_real_change_not_rewritten(self):
        """实词不同（真替换）→ 原样返回。"""
        raw = [(-1, "聞"), (1, "見")]
        assert _resolve_punct_alignment(raw) == raw

    def test_all_punct_not_rewritten(self):
        """两侧全为标点（无实词可对齐）→ 原样返回。"""
        raw = [(-1, "。"), (1, "，")]
        assert _resolve_punct_alignment(raw) == raw

    def test_adjacent_merge_guard(self):
        """重写首操作为 DEL 且前一操作是 ADD → 放弃重写（防被合成 mod）。"""
        raw = [(1, "Z"), (-1, "。丙"), (1, "丙。")]
        assert _resolve_punct_alignment(raw) == raw

    def test_end_to_end_punct_shift(self):
        """端到端：我聞。 → 我。聞（L1 路径）+'聞' 不动 + 重构一致。"""
        a, b = "我聞。", "我。聞"
        segments, stats = diff_texts(a, b)
        ops = [(s["operation"], s.get("side"), s["text"]) for s in segments]
        assert ("none", None, "聞") in ops
        assert ("del", None, "。") in ops
        assert ("add", None, "。") in ops
        assert stats["mod"] == 0
        assert _rebuild(segments, "a") == a
        assert _rebuild(segments, "b") == b


class TestWhitespaceAttribution:
    """空白归因（W + L3 扩展，2026-08-05 用户实测）：空白符（换行/全角空格等）
    是排版符号而非内容。Word 句读结果把「行尾回车/空格 → 标点」作为常规操作，
    空白符的增删不应单独标记，实词保持不动。"""

    def _ops(self, a, b):
        segments, stats = diff_texts(a, b)
        return [(s["operation"], s.get("side"), s["text"]) for s in segments], stats

    def test_title_spaces_to_punct(self):
        """问题1：中阿含經卷第一\u3000\u3000 → 中阿含經卷第一。
        （'一'后两个全角空格被句号替换）→ 显示'一'后新增'。'，无空白删除标记。"""
        a = "中阿含經卷第一\u3000\u3000\n東晉孝武"
        b = "中阿含經卷第一。\n東晉孝武"
        ops, stats = self._ops(a, b)
        assert ("add", None, "。") in ops
        assert stats["mod"] == 0
        assert stats["del"] == 0
        assert ("none", None, "中阿含經卷第一") in ops

    def test_newline_to_punct(self):
        """问题2：道祖筆受\\n → 道祖筆受。（行尾回车被句号替换）
        → 显示'受'后新增'。'，无回车删除标记。"""
        a = "譯道祖筆受\n中阿含七法品第一有十經"
        b = "譯。道祖筆受。中阿含七法品第一有十經"
        ops, stats = self._ops(a, b)
        assert ("add", None, "。") in ops
        assert stats["mod"] == 0
        assert ("del", None, "\n") not in ops
        assert stats["add"] == 2  # 譯后 + 受后

    def test_word_list_spaces_to_punct(self):
        """问题3：空格分隔的标题词 → 各词后加句号。实词全部不动，空格删除隐藏。"""
        a = "善法晝度樹\u3000城水木積喻\u3000善人徃世福\u3000日車漏盡七\u3000\n中阿含"
        b = "善法。晝度樹。城。水。木積。喻善人。徃世。福日車。漏盡。七。中阿含"
        ops, stats = self._ops(a, b)
        for w in ("善法", "晝度樹", "城", "水", "木積", "喻善人", "徃世", "福日車", "漏盡", "七"):
            assert ("none", None, w) in ops, f"{w} 应保持不动"
        assert stats["add"] == 10
        assert stats["mod"] == 0
        assert stats["del"] == 0

    def test_real_deletion_still_shown(self):
        """真内容删除不受影响：删'水'+空格改句号混合时，'水'仍以删除线可见。"""
        a = "善法晝度樹\u3000城水木積喻\u3000善人"
        b = "善法晝度樹。城。木積喻善人"
        ops, stats = self._ops(a, b)
        assert ("mod", "old", "\u3000城水") in ops  # '水'的删除可见
        assert stats["total"] > 0

    def test_ws_rule_direct(self):
        """规则直测：纯空白 DEL + 纯标点 ADD → 折叠为 ADD 标点；孤立空白 DEL → 隐藏。"""
        raw = [(-1, "\n"), (1, "。")]
        assert _resolve_whitespace(raw) == [(1, "。")]
        raw2 = [(0, "福"), (-1, "\u3000"), (0, "日車")]
        assert _resolve_whitespace(raw2) == [(0, "福"), (0, "日車")]
        # 真内容删除不折叠
        raw3 = [(-1, "水"), (0, "甲")]
        assert _resolve_whitespace(raw3) == raw3

    def test_b_side_reconstruction(self):
        """B 侧（修改版）重构必须一致（编辑模式 baseline 安全）。"""
        a = "中阿含經卷第一\u3000\u3000\n東晉孝武及安帝\n道祖筆受\n中阿含七法品第一有十經\u2003初一日誦"
        b = "中阿含經卷第一。\n東晉孝武及安帝。道祖筆受。中阿含七法品第一有十經。\u2003。初一日誦"
        segments, _ = diff_texts(a, b)
        assert _rebuild(segments, "b") == b


class TestPatches:
    def test_roundtrip(self):
        baseline = "original text"
        current = "modified text"
        patches = make_patches(baseline, current)
        result, _ = apply_patches(baseline, patches)
        assert result == current

    def test_no_change(self):
        text = "hello world"
        patches = make_patches(text, text)
        result, _ = apply_patches(text, patches)
        assert result == text
