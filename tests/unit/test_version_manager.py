"""Tests for VersionManager class."""

import json
import time
from pathlib import Path

from src_backend.version_manager import VersionManager


class TestVersionManager:
    """Tests for VersionManager class."""

    def test_save_returns_short_uuid(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        version_id = vm.save("v1", "content A", "content B", {"total": 5})
        assert isinstance(version_id, str)
        assert len(version_id) == 12  # 12-char hex UUID

    def test_save_creates_file(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        version_id = vm.save("v1", "content A", "content B", {"total": 5})
        file_path = Path(str(tmp_path)) / f"{version_id}.json"
        assert file_path.exists()

    def test_save_stores_correct_data(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        stats = {"total": 10, "add": 3, "del": 2, "mod": 5}
        version_id = vm.save("my-label", "AAA", "BBB", stats)

        file_path = Path(str(tmp_path)) / f"{version_id}.json"
        data = json.loads(file_path.read_text(encoding="utf-8"))

        assert data["id"] == version_id
        assert data["label"] == "my-label"
        assert data["file_a_content"] == "AAA"
        assert data["file_b_content"] == "BBB"
        assert data["stats"] == stats
        assert "time" in data

    def test_list_returns_all_versions(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        vid1 = vm.save("v1", "A", "B", {})
        vid2 = vm.save("v2", "C", "D", {})

        versions = vm.list()
        assert len(versions) == 2
        ids = [v["id"] for v in versions]
        assert vid1 in ids
        assert vid2 in ids

    def test_list_includes_label_time_stats(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        vid = vm.save("important", "X", "Y", {"total": 3})

        versions = vm.list()
        # versions are sorted newest first
        v = next(v for v in versions if v["id"] == vid)
        assert v["id"] == vid
        assert v["label"] == "important"
        assert v["stats"] == {"total": 3}
        assert isinstance(v["time"], float)

    def test_restore_returns_full_data(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        stats = {"total": 7, "add": 4, "del": 3, "mod": 0}
        vid = vm.save("restore-me", "file A content", "file B content", stats)

        restored = vm.restore(vid)
        assert restored is not None
        assert restored["file_a_content"] == "file A content"
        assert restored["file_b_content"] == "file B content"
        assert restored["stats"] == stats

    def test_10_version_cleanup(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        # Save 12 versions
        version_ids = []
        for i in range(12):
            version_ids.append(
                vm.save(f"v{i}", f"content{i}", f"content{i}", {})
            )
            time.sleep(0.01)  # ensure different timestamps

        # Only 10 should remain
        versions = vm.list()
        assert len(versions) == 10

        # The oldest (first saved) should be gone
        remaining_ids = {v["id"] for v in versions}
        assert version_ids[0] not in remaining_ids
        assert version_ids[1] not in remaining_ids

    def test_list_empty_storage(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        versions = vm.list()
        assert versions == []

    def test_storage_dir_created(self, tmp_path):
        storage_dir = Path(str(tmp_path)) / "nested" / "versions"
        vm = VersionManager(storage_dir=str(storage_dir))
        vm.save("test", "a", "b", {})
        assert storage_dir.exists()

    def test_restore_nonexistent_returns_none(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        result = vm.restore("nonexistent")
        assert result is None
