import shutil
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.models.store import store
from app.websocket.collaboration import websocket_server


def _reset_websocket_server() -> None:
    """Drop any in-memory state the module-level `websocket_server` accumulated
    during a prior test.

    Each `TestClient` spins up its own event loop (AnyIO portal). If a previous
    test left behind a `_task_group` / `_exit_stack` bound to that now-closed
    loop, the next test's writes through the ystore get cancelled mid-flight
    (`asyncio.CancelledError` at `anyio.Lock` acquisition) because the lock is
    tied to a dead loop. Forcing a cold start per test makes the suite
    deterministic regardless of run order.
    """
    websocket_server.rooms = {}
    websocket_server._task_group = None
    websocket_server._started = None
    websocket_server._starting = False
    if hasattr(websocket_server, "_exit_stack"):
        try:
            delattr(websocket_server, "_exit_stack")
        except Exception:
            pass


@pytest.fixture(autouse=True)
def reset_state():
    store.reset()
    if settings.ystore_dir.exists():
        shutil.rmtree(settings.ystore_dir)
    settings.ystore_dir.mkdir(parents=True, exist_ok=True)
    _reset_websocket_server()
    yield
    store.reset()
    if settings.ystore_dir.exists():
        shutil.rmtree(settings.ystore_dir)
    _reset_websocket_server()


@pytest.fixture()
def client():
    c = TestClient(app)
    try:
        yield c
    finally:
        try:
            c.close()
        except Exception:
            pass


@contextmanager
def ws_connect(client: TestClient, url: str):
    """Open a WS session and suppress the known AnyIO cancel-scope teardown
    RuntimeError emitted by Starlette's TestClient under Python 3.14 when a
    nested task group (ypy_websocket) exits on disconnect.

    Functional assertions inside the `with` block still run and fail normally;
    only the teardown-only `RuntimeError: Attempted to exit a cancel scope
    that isn't the current tasks's current cancel scope` is swallowed, because
    it is a harness artifact, not a product bug.
    """
    cm = client.websocket_connect(url)
    ws = cm.__enter__()
    try:
        yield ws
    finally:
        try:
            cm.__exit__(None, None, None)
        except RuntimeError as err:
            if "cancel scope" not in str(err):
                raise
        except BaseExceptionGroup as group:  # anyio may wrap the error
            remaining = [
                e for e in group.exceptions
                if not (isinstance(e, RuntimeError) and "cancel scope" in str(e))
            ]
            if remaining:
                raise BaseExceptionGroup(group.message, remaining) from None


@pytest.fixture()
def ws():
    """Yields the ws_connect helper so tests can `with ws(client, url) as s:`."""
    return ws_connect
