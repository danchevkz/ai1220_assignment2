# `app/websocket/`

Yjs real-time collaboration endpoint, mounted at `/ws` in `app/main.py`.

`collaboration.py` wraps `ypy-websocket` with:

- a `PersistentWebsocketServer` that backs each room with a `FileYStore`
  under `settings.ystore_dir` (`backend/.data/ystore/`), so a document's
  CRDT state survives server restarts and can be snapshotted for version
  history;
- an `on_connect` hook that decodes the access token from the `?token=`
  query string, verifies the user exists and is listed on the target
  document's `collaborators`, and rejects with close code `1008`
  otherwise;
- `snapshot(room_name) -> bytes` and `restore(room_name, snapshot)` helpers
  used by the `documents` router to power the version-history drawer.

The wire format is the stock y-websocket binary protocol — sync messages
for content, awareness messages for presence/cursors — so the frontend can
use the unmodified `y-websocket` client.
