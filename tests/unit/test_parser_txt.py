import pytest
import tempfile
import os
from src_backend.parsers.txt_parser import parse_txt


class TestParseTxt:
    def test_parses_utf8_file(self):
        content = "Hello, world!\nSecond line"
        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".txt", delete=False
        ) as f:
            f.write(content.encode("utf-8"))
            filepath = f.name
        try:
            result = parse_txt(filepath)
            assert result == content
        finally:
            os.unlink(filepath)

    def test_detects_bom_utf8(self):
        content = "BOM test"
        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".txt", delete=False
        ) as f:
            f.write(b"\xef\xbb\xbf" + content.encode("utf-8"))
            filepath = f.name
        try:
            result = parse_txt(filepath)
            assert result == content
        finally:
            os.unlink(filepath)

    def test_empty_file_returns_empty_string(self):
        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".txt", delete=False
        ) as f:
            filepath = f.name
        try:
            result = parse_txt(filepath)
            assert result == ""
        finally:
            os.unlink(filepath)
