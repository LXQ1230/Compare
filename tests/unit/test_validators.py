"""Tests for validate_file function."""

from src_backend.validators import validate_file


class TestValidateFile:
    """Tests for validate_file function."""

    # ── valid extensions ──

    def test_valid_txt_extension(self):
        result = validate_file("test.txt", "Hello World")
        assert result["valid"] is True
        assert result["format"] == "txt"
        assert result["errors"] == []

    def test_valid_md_extension(self):
        result = validate_file("doc.md", "# Title\n\nContent")
        assert result["valid"] is True
        assert result["format"] == "md"

    def test_valid_docx_extension(self):
        result = validate_file("doc.docx", "placeholder")
        assert result["valid"] is True
        assert result["format"] == "docx"

    # ── invalid extensions ──

    def test_invalid_extension_rejected(self):
        result = validate_file("image.png", "content")
        assert result["valid"] is False
        assert result["format"] == "png"
        assert len(result["errors"]) > 0

    def test_empty_content_rejected(self):
        result = validate_file("test.txt", "   \n  ")
        assert result["valid"] is False
        assert any("空" in e for e in result["errors"])

    def test_no_extension_rejected(self):
        result = validate_file("noextension", "content")
        assert result["valid"] is False
        assert result["format"] == "unknown"

    def test_valid_content_with_whitespace(self):
        result = validate_file("test.txt", "  hello  ")
        assert result["valid"] is True

    # ── PDF / unsupported formats ──

    def test_pdf_extension_invalid(self):
        result = validate_file("document.pdf", "content")
        assert result["valid"] is False
        assert result["format"] == "pdf"
        assert any(".pdf" in e for e in result["errors"])

    def test_unknown_extension_invalid(self):
        result = validate_file("data.csv", "a,b,c")
        assert result["valid"] is False

    # ── empty content with unsupported format ──

    def test_md_empty_invalid(self):
        result = validate_file("test.md", "")
        assert result["valid"] is False

    def test_docx_with_empty_content_invalid(self):
        result = validate_file("test.docx", "   ")
        assert result["valid"] is False

    # ── md minimum content check ──

    def test_md_too_short_invalid(self):
        result = validate_file("test.md", "ab")
        assert result["valid"] is False
        assert any("短" in e for e in result["errors"])

    def test_md_just_long_enough_valid(self):
        result = validate_file("test.md", "abc")
        assert result["valid"] is True

    # ── valid content ──

    def test_txt_with_valid_content(self):
        result = validate_file("test.txt", "This is a valid text file content.")
        assert result["valid"] is True
        assert result["format"] == "txt"

    def test_md_with_valid_content(self):
        result = validate_file("test.md", "# Heading\n\nParagraph text here.")
        assert result["valid"] is True
        assert result["format"] == "md"
