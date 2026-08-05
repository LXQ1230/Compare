"""Autosave manager for browser-side draft persistence."""

import hashlib
import json
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)


def _safe_key(key: str) -> str:
    """Hash the key to produce a filesystem-safe filename."""
    return hashlib.sha256(key.encode()).hexdigest()[:16]


class AutosaveManager:
    """Simple key-value persistence for editor autosave drafts."""

    def __init__(self, storage_dir: str = "./autosaves"):
        self._dir = Path(storage_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    def save(
        self, key: str, text: str = "",
        html: str = "", timestamp: float = 0.0,
        cursor_pos: int = 0, scroll_pos: int = 0,
        last_edit_offset: int = -1,
        processed_cis: list | None = None,
        file_a_name: str = "", file_b_name: str = "",
        stats: dict | None = None,
        total_chunks: int = 0,
    ) -> None:
        """Persist an autosave entry keyed by a unique identifier.

        方案 L5/P5：去掉 segments 与 baseline（均为可重建冗余——
        baseline 由 buildDocText(segments) 重建，segments 存于 IndexedDB），
        payload 缩至 ~1/10，百万字 autosave 不再序列化全量段。
        """
        entry = {
            "key": key, "text": text, "html": html, "time": timestamp,
            "cursor_pos": cursor_pos, "scroll_pos": scroll_pos,
            "last_edit_offset": last_edit_offset,
            "processed_cis": processed_cis or [],
            "file_a_name": file_a_name, "file_b_name": file_b_name,
            "stats": stats or {},
            "total_chunks": total_chunks,
        }
        path = self._dir / f"{_safe_key(key)}.json"
        # 方案 P3-2: 原子写入——先写同目录 tmp 再 os.replace，避免半截文件
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    def load(self, key: str) -> dict | None:
        """Load an autosave entry by key. Returns None if missing or corrupt."""
        path = self._dir / f"{_safe_key(key)}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        return {
            "key": data.get("key", key),
            "text": data.get("text", ""),
            "html": data.get("html", ""),
            "time": data.get("time", 0.0),
            "cursor_pos": data.get("cursor_pos", 0),
            "scroll_pos": data.get("scroll_pos", 0),
            "last_edit_offset": data.get("last_edit_offset", -1),
            "processed_cis": data.get("processed_cis", []),
            "file_a_name": data.get("file_a_name", ""),
            "file_b_name": data.get("file_b_name", ""),
            "stats": data.get("stats", {}),
            "total_chunks": data.get("total_chunks", 0),
        }

    def delete(self, key: str) -> None:
        """Remove an autosave entry."""
        path = self._dir / f"{_safe_key(key)}.json"
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            # 方案 P3-1: 静默失败 → 记录日志（删除失败不阻断主流程）
            logger.warning("autosave delete failed for key=%s: %s", key, e)
