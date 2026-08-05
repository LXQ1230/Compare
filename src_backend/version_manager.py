"""Version history manager for compare sessions.

方案 P5（L5 §4.5.2）：版本快照 patch 化——第一个版本存全量，
后续版本存"相对最新版本的 patch"（复用 diff_engine.make_patches），
恢复时沿链逐条 apply。100 万字单版本 4MB 全量 → kb 级 patch。
链式结构：Vn.a_parent = V(n-1) 的 id；_cleanup 删除最旧版本时，
将其直接后继提升为全量存储（链不断裂，恢复始终可用）。
旧格式（file_a_content/file_b_content 全量字段）兼容读取。
"""

import json
import logging
import os
import re
import time
import uuid
from pathlib import Path

from src_backend.diff_engine import apply_patches, make_patches

logger = logging.getLogger(__name__)

_VERSION_ID_RE = re.compile(r'^[0-9a-f]{12}$')


def _validate_version_id(version_id: str) -> bool:
    """Check that version_id matches the expected hex format."""
    return bool(_VERSION_ID_RE.match(version_id))


class VersionManager:
    """Persist and restore named versions of diff results (max 10, patch-chained)."""

    def __init__(self, storage_dir: str = "./versions"):
        self._dir = Path(storage_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    # ── save ──────────────────────────────────────────────────────

    def save(
        self, label: str, file_a_content: str,
        file_b_content: str, stats: dict,
        style_a: list | None = None,
        style_b: list | None = None,
        doc_meta: dict | None = None,
    ) -> str:
        """Persist a version and return its id. Auto-cleans oldest if >10.

        后续版本相对"最新版本"存 patch（a_parent/b_parent 指向最新 id），
        首个版本存全量（parent 为 None）。
        style_a/style_b：IDML 样式区间（方案 §6.6 链路 1，全量存——
        版本数量少、仅 IDML 携带，非 IDML 为空列表零开销）。
        doc_meta：IDML 排版元数据（竖排/行高，随版本恢复）。
        """
        version_id = uuid.uuid4().hex[:12]
        prev_id, prev_a, prev_b = self._latest_full()
        if prev_id:
            a_text = make_patches(prev_a, file_a_content)
            a_parent = prev_id
            b_text = make_patches(prev_b, file_b_content)
            b_parent = prev_id
        else:
            a_text = file_a_content
            a_parent = None
            b_text = file_b_content
            b_parent = None
        entry = {
            "id": version_id, "label": label, "time": time.time(),
            "a_parent": a_parent, "a_text": a_text,
            "b_parent": b_parent, "b_text": b_text,
            "stats": stats,
            "style_a": style_a or [],
            "style_b": style_b or [],
            "doc_meta": doc_meta or {},
        }
        path = self._dir / f"{version_id}.json"
        # 方案 P3-2: 原子写入——先写同目录 tmp 再 os.replace，避免半截文件
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
        self._cleanup()
        return version_id

    def _latest_full(self) -> tuple[str | None, str, str]:
        """最新版本（mtime 最大）的 (id, file_a 全量, file_b 全量)；无版本 (None, '', '')。"""
        files = sorted(
            self._dir.glob("*.json"),
            # 方案 P3-9: 加文件名二级排序，消除同秒 mtime 的不确定性
            key=lambda p: (p.stat().st_mtime, p.stem), reverse=True,
        )
        for f in files:
            try:
                entry = json.loads(f.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            try:
                return entry["id"], self._resolve_content(entry, "a"), self._resolve_content(entry, "b")
            except Exception:
                continue
        return None, "", ""

    # ── chain resolve ─────────────────────────────────────────────

    def _load(self, version_id: str) -> dict | None:
        if not _validate_version_id(version_id):
            return None
        path = self._dir / f"{version_id}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def _resolve_content(self, entry: dict, side: str) -> str:
        """沿 parent 链逐条 apply_patches，得到该 entry 的 side 全量文本。

        兼容旧格式（直接存 file_a_content/file_b_content 全量）。
        """
        legacy = entry.get("file_a_content" if side == "a" else "file_b_content")
        if legacy is not None:
            return legacy
        text = entry.get(f"{side}_text", "")
        parent = entry.get(f"{side}_parent")
        if parent:
            parent_entry = self._load(parent)
            if parent_entry is None:
                raise ValueError(f"parent version {parent} missing")
            base = self._resolve_content(parent_entry, side)
            result, statuses = apply_patches(base, text)
            return result
        return text

    # ── list / restore ────────────────────────────────────────────

    def list(self) -> list[dict]:
        """Return versions ordered by newest first."""
        entries: list[dict] = []
        for path in sorted(
            self._dir.glob("*.json"),
            # 方案 P3-9: 加文件名二级排序，消除同秒 mtime 的不确定性
            key=lambda p: (p.stat().st_mtime, p.stem), reverse=True,
        ):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            entries.append({
                "id": data.get("id", ""), "label": data.get("label", ""),
                "time": data.get("time", 0), "stats": data.get("stats", {}),
            })
        return entries

    def restore(self, version_id: str) -> dict | None:
        """Load full version data by id. Returns None if not found or invalid."""
        entry = self._load(version_id)
        if entry is None:
            return None
        try:
            file_a = self._resolve_content(entry, "a")
            file_b = self._resolve_content(entry, "b")
        except Exception:
            return None
        return {
            "id": entry["id"], "label": entry["label"],
            "time": entry["time"], "file_a_content": file_a,
            "file_b_content": file_b,
            "stats": entry.get("stats", {}),
            "style_a": entry.get("style_a", []),
            "style_b": entry.get("style_b", []),
            "doc_meta": entry.get("doc_meta", {}),
        }

    # ── cleanup ───────────────────────────────────────────────────

    def _cleanup(self) -> None:
        """Keep at most 10 versions; delete oldest by mtime.

        删除最旧版本前，将其直接后继（a_parent/b_parent 指向被删者）提升
        为全量存储——链式结构在中间节点删除后保持完整，恢复始终可用。
        """
        # 方案 P3-9: 加文件名二级排序，消除同秒 mtime 的不确定性
        files = sorted(self._dir.glob("*.json"), key=lambda p: (p.stat().st_mtime, p.stem))
        while len(files) > 10:
            victim = files[0]
            # 方案 P3-5: 损坏文件（无 id）即无人引用，直接删除，勿再提升后继
            victim_entry = self._load(victim.stem)
            victim_id = victim_entry.get("id") if victim_entry else None
            if not victim_id:
                try:
                    victim.unlink()
                except OSError as e:
                    logger.warning("version cleanup unlink failed for %s: %s", victim.name, e)
                    break
                files.pop(0)
                continue
            # 提升依赖被删版本的后继（链式线性，至多一个）
            for f in files[1:]:
                try:
                    entry = json.loads(f.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    continue
                if entry.get("a_parent") == victim_id or entry.get("b_parent") == victim_id:
                    try:
                        full_a = self._resolve_content(entry, "a")
                        full_b = self._resolve_content(entry, "b")
                    except Exception:
                        continue
                    entry["a_parent"] = None
                    entry["a_text"] = full_a
                    entry["b_parent"] = None
                    entry["b_text"] = full_b
                    # 方案 P3-2: 原子写入
                    tmp = f.with_suffix(".json.tmp")
                    tmp.write_text(
                        json.dumps(entry, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    os.replace(tmp, f)
                    break
            try:
                victim.unlink()
            except OSError as e:
                logger.warning("version cleanup unlink failed for %s: %s", victim.name, e)
                break
            files.pop(0)
