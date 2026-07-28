from src_backend.diff_engine import diff_texts, make_patches, apply_patches


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
