"""Autosave manager for browser-side draft persistence."""

import hashlib
import json
import time
from pathlib import Path


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
    ) -> None:
        """Persist an autosave entry keyed by a unique identifier."""
        # When timestamp is exactly 0.0, treat it as user-supplied (default)
        entry = {"key": key, "text": text, "html": html, "time": timestamp}
        path = self._dir / f"{_safe_key(key)}.json"
        path.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")

    def load(self, key: str) -> dict | None:
        """Load an autosave entry by key. Returns None if missing or corrupt."""
        path = self._dir / f"{_safe_key(key)}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        return {"text": data.get("text", ""), "html": data.get("html", ""), "time": data.get("time", 0.0)}

    def delete(self, key: str) -> None:
        """Remove an autosave entry."""
        path = self._dir / f"{_safe_key(key)}.json"
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
