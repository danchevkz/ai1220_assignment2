from __future__ import annotations
from pathlib import Path
from urllib.parse import parse_qs

import y_py as Y
from ypy_websocket.asgi_server import ASGIServer
from ypy_websocket.websocket_server import WebsocketServer
from ypy_websocket.yroom import YRoom
from ypy_websocket.ystore import FileYStore

from app.core.config import settings
from app.core.security import decode_token
from app.models.store import store


# Yjs wire-protocol constants.
# https://github.com/y-crdt/ypy-websocket/blob/main/ypy_websocket/yutils.py
_YJS_TYPE_SYNC = 0
_YJS_TYPE_AWARENESS = 1
_YJS_SYNC_STEP1 = 0   # client → server: state-vector request (READ)
_YJS_SYNC_STEP2 = 1   # client → server: state apply (MUTATION)
_YJS_SYNC_UPDATE = 2  # client → server: incremental update (MUTATION)


class PersistentWebsocketServer(WebsocketServer):
    def __init__(self, base_dir: Path) -> None:
        super().__init__(rooms_ready=True, auto_clean_rooms=False)
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _store_path(self, room_name: str) -> Path:
        key = normalize_room_name(room_name).replace("/", "__")
        return self.base_dir / f"{key}.bin"

    async def get_room(self, name: str) -> YRoom:
        if name not in self.rooms:
            ystore = FileYStore(str(self._store_path(name)))
            room = YRoom(ready=False, ystore=ystore, log=self.log)
            try:
                await ystore.apply_updates(room.ydoc)
            except Exception:
                pass
            room.ready = True
            self.rooms[name] = room
        room = self.rooms[name]
        await self.start_room(room)
        return room

    async def snapshot(self, room_name: str) -> bytes:
        persisted_doc = Y.YDoc()
        try:
            await FileYStore(str(self._store_path(room_name))).apply_updates(persisted_doc)
        except Exception:
            pass
        return Y.encode_state_as_update(persisted_doc)

    async def restore(self, room_name: str, snapshot: bytes) -> None:
        path = self._store_path(room_name)
        if path.exists():
            path.unlink()

        ydoc = Y.YDoc()
        if snapshot:
            Y.apply_update(ydoc, snapshot)
        ystore = FileYStore(str(path))
        await ystore.write(Y.encode_state_as_update(ydoc))

        if room_name in self.rooms:
            old_room = self.rooms.pop(room_name)
            old_room.stop()


websocket_server = PersistentWebsocketServer(settings.ystore_dir)


def normalize_room_name(path: str) -> str:
    return "/" + path.strip("/")


async def ensure_websocket_server_running() -> None:
    if getattr(websocket_server, "_task_group", None) is None:
        await websocket_server.__aenter__()


async def stop_websocket_server() -> None:
    if getattr(websocket_server, "_task_group", None) is None:
        return

    for room in list(websocket_server.rooms.values()):
        try:
            room.stop()
        except Exception:
            pass

    # Prefer the server's own shutdown so the AnyIO task group and exit stack
    # unwind cleanly in production (uvicorn lifespan). Fall back to a hard reset
    # if we're on a different task/loop than the one that opened the server
    # (TestClient teardown hits this path — `anyio.Lock` is tied to the now-
    # closed loop, so `__aexit__` raises).
    try:
        await websocket_server.__aexit__(None, None, None)
    except Exception:
        pass

    websocket_server.rooms = {}
    websocket_server._task_group = None
    websocket_server._started = None
    if hasattr(websocket_server, "_exit_stack"):
        try:
            delattr(websocket_server, "_exit_stack")
        except Exception:
            pass


def is_yjs_mutation(message: bytes) -> bool:
    """True for client→server messages that mutate the shared YDoc.

    A read-only viewer must not be allowed to send these. We still allow:
      - SYNC_STEP1 (state-vector request — server replies with current state)
      - AWARENESS (presence/cursor; doesn't touch shared content)
    """
    if len(message) < 2:
        return False
    if message[0] != _YJS_TYPE_SYNC:
        return False
    return message[1] in (_YJS_SYNC_STEP2, _YJS_SYNC_UPDATE)


class ReadOnlyWebsocketWrapper:
    """Per-connection filter that strips Yjs document-mutation messages.

    Wraps an inner Websocket so that the YRoom's `async for message in
    websocket:` loop never sees a viewer's attempted writes. Sends from the
    server side pass through unchanged so the viewer still receives updates
    other clients make.
    """

    def __init__(self, inner) -> None:
        self._inner = inner

    @property
    def path(self) -> str:
        return self._inner.path

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes:
        # Skip any mutation message; let everything else through.
        while True:
            message = await self._inner.__anext__()
            if not is_yjs_mutation(message):
                return message

    async def recv(self) -> bytes:
        while True:
            message = await self._inner.recv()
            if not is_yjs_mutation(message):
                return message

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)


async def authorize_connection(scope: dict) -> str | None:
    """Authenticate a websocket upgrade and resolve the user's role on the
    requested document. Returns the role string ("owner" / "editor" / "viewer")
    when the connection should be accepted, or None to reject.
    """
    query = parse_qs(scope.get("query_string", b"").decode("utf-8"))
    token = query.get("token", [None])[0]
    if not token:
        return None
    try:
        claims = decode_token(token)
    except ValueError:
        return None
    if claims.get("type") != "access":
        return None
    user = store.get_user(claims.get("sub", ""))
    if user is None:
        return None
    path = normalize_room_name(scope.get("path", ""))
    doc_id = path.rsplit("/", 1)[-1]
    doc = store.get_document(doc_id)
    if doc is None:
        return None
    return doc.collaborators.get(user.id)


async def on_connect(_message: dict, scope: dict) -> bool:
    # Kept for backwards-compatibility: returns True to deny the connection.
    role = await authorize_connection(scope)
    return role is None


class CollaborationASGIApp:
    def __init__(self, websocket_server: PersistentWebsocketServer) -> None:
        self._websocket_server = websocket_server

    async def __call__(self, scope, receive, send):
        await ensure_websocket_server_running()
        accepted = False
        try:
            msg = await receive()
            if msg["type"] != "websocket.connect":
                return

            role = await authorize_connection(scope)
            if role is None:
                await send({"type": "websocket.close", "code": 1008})
                return

            await send({"type": "websocket.accept"})
            accepted = True

            from ypy_websocket.asgi_server import ASGIWebsocket

            inner = ASGIWebsocket(
                receive,
                send,
                normalize_room_name(scope.get("path", "")),
            )
            websocket = ReadOnlyWebsocketWrapper(inner) if role == "viewer" else inner
            await self._websocket_server.serve(websocket)
        except Exception:
            if not accepted:
                try:
                    await send({"type": "websocket.close", "code": 1011})
                except Exception:
                    pass
            raise


collaboration_app = CollaborationASGIApp(websocket_server)
