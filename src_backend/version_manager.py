"""Version history manager for compare sessions."""

import json
import re
import time
import uuid
from pathlib import Path

_VERSION_ID_RE = re.compile(r'^[0-9a-f]{12}$')


def _validate_version_id(version_id: str) -> bool:
    """Check that version_id matches the expected hex format."""
    return bool(_VERSION_ID_RE.match(version_id))


class VersionManager:
    """Persist and restore named versions of diff results (max 10)."""

    def __init__(self, storage_dir: str = "./versions"):
        self._dir = Path(storage_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    def save(
        self, label: str, file_a_content: str,
        file_b_content: str, stats: dict,
    ) -> str:
        """Persist a version and return its id. Auto-cleans oldest if >10."""
        version_id = uuid.uuid4().hex[:12]
        entry = {
            "id": version_id, "label": label, "time": time.time(),
            "file_a_content": file_a_content,
            "file_b_content": file_b_content, "stats": stats,
        }
        path = self._dir / f"{version_id}.json"
        path.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
        self._cleanup()
        return version_id

    def list(self) -> list[dict]:
        """Return versions ordered by newest first."""
        entries: list[dict] = []
        for path in sorted(
            self._dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime, reverse=True,
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
        if not _validate_version_id(version_id):
            return None
        path = self._dir / f"{version_id}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        return {
            "id": data["id"], "label": data["label"],
            "time": data["time"], "file_a_content": data["file_a_content"],
            "file_b_content": data["file_b_content"],
            "stats": data.get("stats", {}),
        }

    def _cleanup(self) -> None:
        """Keep at most 10 versions; delete oldest by mtime."""
        files = sorted(self._dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
        while len(files) > 10:
            try:
                files[0].unlink()
                files.pop(0)
            except OSError:
                break
