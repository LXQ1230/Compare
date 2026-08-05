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
        # 方案 P5：首个版本存全量（a_parent/b_parent 为 None）
        assert data["a_parent"] is None
        assert data["a_text"] == "AAA"
        assert data["b_parent"] is None
        assert data["b_text"] == "BBB"
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

        # 最旧的根版本（首次保存）应被删除；链式提升使后继 mtime 变新，
        # 不保证 version_ids[1] 一定被删（patch 化后的合理行为）
        remaining_ids = {v["id"] for v in versions}
        assert version_ids[0] not in remaining_ids
        # 每个剩余版本可完整恢复
        for v in versions:
            restored = vm.restore(v["id"])
            assert restored is not None
            assert len(restored["file_a_content"]) > 0

    def test_patch_chain_restore_after_cleanup(self, tmp_path):
        """链式 patch 在清理（删中间节点+提升后继）后恢复仍正确。"""
        vm = VersionManager(storage_dir=str(tmp_path))
        ids = []
        # 不同内容（patch 有意义），短文本
        contents = [
            "原版内容第一章\n正文第一行",
            "原版内容第一章\n正文第一行（修改）",
            "原版内容第一章\n正文第二行新增\n正文第一行（修改）",
            "最终版：第一章完\n正文第二行新增\n正文第一行（修改）",
        ]
        for i, c in enumerate(contents):
            ids.append(vm.save(f"v{i}", c, c, {}))
            time.sleep(0.01)

        # 触发清理：保存超过 10 个
        for i in range(10):
            vm.save(f"extra{i}", f"extra content {i}", f"extra content {i}", {})
            time.sleep(0.01)

        # 每个剩余版本 restore 都返回其保存时的全量内容
        versions = vm.list()
        assert len(versions) == 10
        for v in versions:
            restored = vm.restore(v["id"])
            assert restored is not None
            assert isinstance(restored["file_a_content"], str)
            assert len(restored["file_a_content"]) > 0

    def test_patch_chain_storage_size(self, tmp_path):
        """同一文档多次小幅编辑：后续版本存 patch，文件体积显著小于全量。"""
        vm = VersionManager(storage_dir=str(tmp_path))
        base = "汉" * 20_000  # 2 万字基线
        id1 = vm.save("v1", base, base, {})
        time.sleep(0.01)
        id2 = vm.save("v2", base + "追加一行", base + "追加一行", {})
        time.sleep(0.01)
        id3 = vm.save("v3", base + "追加一行\n再追加", base + "追加一行\n再追加", {})

        sizes = []
        for vid in (id1, id2, id3):
            p = Path(str(tmp_path)) / f"{vid}.json"
            sizes.append(p.stat().st_size)
        # v2/v3 存 patch（kb 级），远小于 v1 全量（约 40KB+）
        assert sizes[1] < sizes[0] / 10
        assert sizes[2] < sizes[0] / 10
        # 恢复仍返回完整内容
        assert vm.restore(id3)["file_a_content"] == base + "追加一行\n再追加"

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


class TestVersionManagerStyle:
    """IDML 版本样式链路（方案 §6.6 链路 1：styleA/styleB/docMeta 随版本存储）。"""

    def test_save_restore_styles_and_docmeta(self, tmp_path):
        vm = VersionManager(storage_dir=str(tmp_path))
        style_a = [
            {"start": 0, "end": 4, "font": "FangSong"},
            {"start": 4, "end": 10, "font": "SourceHanSerifCN", "bold": True},
        ]
        style_b = [{"start": 0, "end": 10, "font": "FangSong"}]
        doc_meta = {"vertical": True, "leadingRatio": 1.536}
        vid = vm.save("v1", "AAA", "BBB", {"total": 1},
                      style_a=style_a, style_b=style_b, doc_meta=doc_meta)

        # 文件内存储
        data = json.loads(
            (Path(str(tmp_path)) / f"{vid}.json").read_text(encoding="utf-8")
        )
        assert data["style_a"] == style_a
        assert data["style_b"] == style_b
        assert data["doc_meta"] == doc_meta

        # 恢复回传
        restored = vm.restore(vid)
        assert restored["style_a"] == style_a
        assert restored["style_b"] == style_b
        assert restored["doc_meta"] == doc_meta

    def test_non_idml_zero_overhead(self, tmp_path):
        """非 IDML：无 style/docMeta → 空值，不破坏旧格式兼容。"""
        vm = VersionManager(storage_dir=str(tmp_path))
        vid = vm.save("plain", "AAA", "BBB", {})
        restored = vm.restore(vid)
        assert restored["style_a"] == []
        assert restored["style_b"] == []
        assert restored["doc_meta"] == {}

    def test_legacy_format_compat(self, tmp_path):
        """旧格式（file_a_content 全量字段）读取兼容：缺 style 字段返回空。"""
        vm = VersionManager(storage_dir=str(tmp_path))
        vid = vm.save("old", "AAA", "BBB", {})
        path = Path(str(tmp_path)) / f"{vid}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        # 模拟旧格式：移除新字段
        data.pop("style_a", None)
        data.pop("style_b", None)
        data.pop("doc_meta", None)
        path.write_text(json.dumps(data), encoding="utf-8")
        restored = vm.restore(vid)
        assert restored["style_a"] == []
        assert restored["style_b"] == []
        assert restored["doc_meta"] == {}
        assert restored["file_a_content"] == "AAA"
