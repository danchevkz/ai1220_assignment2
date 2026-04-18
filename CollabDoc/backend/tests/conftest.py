import shutil

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.models.store import store


@pytest.fixture(autouse=True)
def reset_state():
    store.reset()
    if settings.ystore_dir.exists():
        shutil.rmtree(settings.ystore_dir)
    settings.ystore_dir.mkdir(parents=True, exist_ok=True)
    yield
    store.reset()
    if settings.ystore_dir.exists():
        shutil.rmtree(settings.ystore_dir)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c
