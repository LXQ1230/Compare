import pytest
from src_backend.parsers.docx_parser import parse_docx
from src_backend.errors import AppError


class TestParseDocx:
    def test_parses_simple_docx(self):
        result = parse_docx("tests/fixtures/simple.docx")
        assert len(result) > 0
        assert isinstance(result, str)

    def test_rejects_non_docx(self):
        with pytest.raises(AppError):
            parse_docx("tests/fixtures/hello.txt")
