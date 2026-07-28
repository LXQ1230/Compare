import pytest
from fastapi.testclient import TestClient
from src_backend.main import app


@pytest.fixture
def client():
    return TestClient(app)
