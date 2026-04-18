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
        room = await self.get_room(room_name)
        return Y.encode_state_as_update(room.ydoc)

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
    if getattr(websocket_server, "_task_group", None) is not None:
        await websocket_server.__aexit__(None, None, None)


async def on_connect(_message: dict, scope: dict) -> bool:
    query = parse_qs(scope.get("query_string", b"").decode("utf-8"))
    token = query.get("token", [None])[0]
    if not token:
        return True
    try:
        claims = decode_token(token)
    except ValueError:
        return True
    if claims.get("type") != "access":
        return True
    user = store.get_user(claims.get("sub", ""))
    if user is None:
        return True
    path = normalize_room_name(scope.get("path", ""))
    doc_id = path.rsplit("/", 1)[-1]
    doc = store.get_document(doc_id)
    if doc is None:
        return True
    role = doc.collaborators.get(user.id)
    if role is None:
        return True
    return False


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

            close = await on_connect(msg, scope)
            if close:
                await send({"type": "websocket.close", "code": 1008})
                return

            await send({"type": "websocket.accept"})
            accepted = True

            from ypy_websocket.asgi_server import ASGIWebsocket

            websocket = ASGIWebsocket(
                receive,
                send,
                normalize_room_name(scope.get("path", "")),
            )
            await self._websocket_server.serve(websocket)
        except Exception:
            if not accepted:
                try:
                    await send({"type": "websocket.close", "code": 1011})
                except Exception:
                    pass
            raise


collaboration_app = CollaborationASGIApp(websocket_server)
