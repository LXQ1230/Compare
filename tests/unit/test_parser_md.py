import pytest
from src_backend.parsers.md_parser import parse_md


class TestParseMd:
    def test_strips_headers(self):
        result = parse_md("# Title\n\nContent")
        assert "#" not in result
        assert "Title" in result
        assert "Content" in result

    def test_strips_bold_and_italic(self):
        result = parse_md("This is **bold** and *italic*")
        assert "**" not in result
        assert "*" not in result
        assert "bold" in result
        assert "italic" in result

    def test_strips_links(self):
        result = parse_md("Click [here](https://example.com)")
        assert "https" not in result
        assert "here" in result

    def test_strips_code_blocks(self):
        result = parse_md("```\ncode\n```\n\nnormal")
        assert "```" not in result
        assert "code" in result
        assert "normal" in result

    def test_collapses_blank_lines(self):
        result = parse_md("line1\n\n\n\nline2")
        # should have at most 2 consecutive newlines
        assert "\n\n\n" not in result

    def test_preserves_paragraph_breaks(self):
        result = parse_md("para1\n\npara2")
        assert "para1" in result
        assert "para2" in result
