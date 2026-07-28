"""Integration tests for autosave and version API endpoints."""

import json
import os


class TestAutosaveAPI:
    """Integration tests for POST /api/autosave endpoint."""

    def test_save_and_load(self, client, monkeypatch, tmp_path):
        autosave_dir = tmp_path / "autosaves"
        monkeypatch.setenv("AUTOSAVE_DIR", str(autosave_dir))

        # Save
        response = client.post("/api/autosave", json={
            "action": "save",
            "key": "test-doc",
            "text": "hello world",
            "html": "<p>hello world</p>",
            "time": 12345.0,
        })
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

        # Load
        response = client.post("/api/autosave", json={
            "action": "load",
            "key": "test-doc",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["data"]["text"] == "hello world"
        assert data["data"]["html"] == "<p>hello world</p>"
        assert data["data"]["time"] == 12345.0

    def test_load_nonexistent(self, client, monkeypatch, tmp_path):
        autosave_dir = tmp_path / "autosaves"
        monkeypatch.setenv("AUTOSAVE_DIR", str(autosave_dir))

        response = client.post("/api/autosave", json={
            "action": "load",
            "key": "nonexistent",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["data"] is None

    def test_delete(self, client, monkeypatch, tmp_path):
        autosave_dir = tmp_path / "autosaves"
        monkeypatch.setenv("AUTOSAVE_DIR", str(autosave_dir))

        # Save first
        client.post("/api/autosave", json={
            "action": "save",
            "key": "to-delete",
            "text": "temp",
        })

        # Delete
        response = client.post("/api/autosave", json={
            "action": "delete",
            "key": "to-delete",
        })
        assert response.status_code == 200

        # Should now be gone
        response = client.post("/api/autosave", json={
            "action": "load",
            "key": "to-delete",
        })
        assert response.json()["data"] is None

    def test_invalid_action(self, client, monkeypatch, tmp_path):
        autosave_dir = tmp_path / "autosaves"
        monkeypatch.setenv("AUTOSAVE_DIR", str(autosave_dir))

        response = client.post("/api/autosave", json={
            "action": "invalid",
            "key": "test",
        })
        assert response.status_code == 400
        body = response.json()
        assert body["error"] is True
        assert body["severity"] == "blocking"


class TestVersionAPI:
    """Integration tests for version API endpoints."""

    def test_save_version(self, client, monkeypatch, tmp_path):
        version_dir = tmp_path / "versions"
        monkeypatch.setenv("VERSION_DIR", str(version_dir))

        response = client.post("/api/versions/save", json={
            "label": "v1",
            "file_a_content": "Content A",
            "file_b_content": "Content B",
            "stats": {"total": 5, "add": 2, "del": 3, "mod": 0},
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "id" in data
        assert len(data["id"]) == 12  # 12-char hex short UUID

    def test_list_versions(self, client, monkeypatch, tmp_path):
        version_dir = tmp_path / "versions"
        monkeypatch.setenv("VERSION_DIR", str(version_dir))

        # Save a version
        save_resp = client.post("/api/versions/save", json={
            "label": "test",
            "file_a_content": "A",
            "file_b_content": "B",
            "stats": {},
        })
        vid = save_resp.json()["id"]

        # List
        response = client.get("/api/versions/list")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert len(data["versions"]) >= 1
        ids = [v["id"] for v in data["versions"]]
        assert vid in ids

    def test_restore_version(self, client, monkeypatch, tmp_path):
        version_dir = tmp_path / "versions"
        monkeypatch.setenv("VERSION_DIR", str(version_dir))

        # Save a version
        stats = {"total": 10, "add": 5, "del": 5, "mod": 0}
        save_resp = client.post("/api/versions/save", json={
            "label": "restore-test",
            "file_a_content": "File A",
            "file_b_content": "File B",
            "stats": stats,
        })
        vid = save_resp.json()["id"]

        # Restore
        response = client.post(f"/api/versions/restore/{vid}")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["version"]["file_a_content"] == "File A"
        assert data["version"]["file_b_content"] == "File B"
        assert data["version"]["stats"] == stats

    def test_restore_nonexistent(self, client, monkeypatch, tmp_path):
        version_dir = tmp_path / "versions"
        monkeypatch.setenv("VERSION_DIR", str(version_dir))

        response = client.post("/api/versions/restore/nonexistent-id")
        assert response.status_code == 404
        data = response.json()
        assert data["error"] is True
        assert data["severity"] == "blocking"
