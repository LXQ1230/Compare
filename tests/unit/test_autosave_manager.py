"""Tests for AutosaveManager class."""

import hashlib
import json
import os
from pathlib import Path

from src_backend.autosave_manager import AutosaveManager


class TestAutosaveManager:
    """Tests for AutosaveManager class."""

    def test_save_creates_file(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        am.save("key1", text="hello", html="<p>hello</p>", timestamp=12345.0)

        result = am.load("key1")
        assert result is not None
        assert result["text"] == "hello"

    def test_save_and_load_cycle(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        am.save("doc1", text="some text", html="<b>bold</b>", timestamp=100.0)

        result = am.load("doc1")
        assert result is not None
        assert result["text"] == "some text"
        assert result["html"] == "<b>bold</b>"
        assert result["time"] == 100.0

    def test_load_missing_key_returns_none(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        result = am.load("nonexistent")
        assert result is None

    def test_overwrite(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        am.save("key1", text="first", html="<p>first</p>", timestamp=1.0)
        am.save("key1", text="second", html="<p>second</p>", timestamp=2.0)

        result = am.load("key1")
        assert result["text"] == "second"
        assert result["html"] == "<p>second</p>"

    def test_default_values(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        am.save("defaults")

        result = am.load("defaults")
        assert result["text"] == ""
        assert result["html"] == ""
        # time is auto-generated when timestamp <= 0

    def test_save_different_keys(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        am.save("k1", text="a")
        am.save("k2", text="b")

        assert am.load("k1")["text"] == "a"
        assert am.load("k2")["text"] == "b"

    def test_storage_dir_created(self, tmp_path):
        storage_dir = Path(str(tmp_path)) / "nested" / "autosaves"
        am = AutosaveManager(storage_dir=str(storage_dir))
        am.save("key", text="test")
        assert storage_dir.exists()

    def test_delete_removes_file(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        am.save("to-delete", text="temp")

        am.delete("to-delete")
        result = am.load("to-delete")
        assert result is None

    def test_delete_nonexistent_no_error(self, tmp_path):
        am = AutosaveManager(storage_dir=str(tmp_path))
        # Should not raise
        am.delete("nonexistent")

    def test_safe_key_sanitization(self, tmp_path):
        """Keys with path separators are hashed for filesystem safety."""
        am = AutosaveManager(storage_dir=str(tmp_path))
        am.save("user/input:file*name", text="data")

        # Should be loadable by same key
        result = am.load("user/input:file*name")
        assert result is not None
        assert result["text"] == "data"
