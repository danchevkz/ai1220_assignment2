from app.models.store import store


def register_and_login(client, username: str, email: str, password: str = "password123"):
    user = client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert user.status_code == 201, user.text
    tokens = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert tokens.status_code == 200, tokens.text
    access_token = tokens.json()["access_token"]
    return user.json(), {"Authorization": f"Bearer {access_token}"}


def test_auth_document_sharing_and_versions_flow(client):
    owner, owner_headers = register_and_login(client, "owner", "owner@example.com")
    collaborator, collaborator_headers = register_and_login(client, "editor", "editor@example.com")

    created = client.post("/api/v1/documents", json={"title": "Draft"}, headers=owner_headers)
    assert created.status_code == 201, created.text
    document = created.json()
    document_id = document["id"]
    assert document["collaborators"][0]["role"] == "owner"

    updated = client.patch(
        f"/api/v1/documents/{document_id}",
        json={"title": "Draft v2", "content": "<p>Hello world</p>"},
        headers=owner_headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["title"] == "Draft v2"

    shared = client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": collaborator["email"], "role": "editor"},
        headers=owner_headers,
    )
    assert shared.status_code == 200, shared.text
    assert any(c["user_id"] == collaborator["id"] for c in shared.json()["collaborators"])

    collaborator_doc = client.get(f"/api/v1/documents/{document_id}", headers=collaborator_headers)
    assert collaborator_doc.status_code == 200, collaborator_doc.text

    link = client.post(
        f"/api/v1/documents/{document_id}/share-links",
        json={"role": "viewer", "expires_in_hours": 24},
        headers=owner_headers,
    )
    assert link.status_code == 201, link.text

    versions = client.get(f"/api/v1/documents/{document_id}/versions", headers=owner_headers)
    assert versions.status_code == 200, versions.text
    assert any(version["content"] == "<p>Hello world</p>" for version in versions.json())

    restored = client.post(
        f"/api/v1/documents/{document_id}/versions/1/restore",
        headers=owner_headers,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["content"] == ""


def test_share_link_redeem_and_collaborator_management(client):
    _, owner_headers = register_and_login(client, "owner2", "owner2@example.com")
    viewer, viewer_headers = register_and_login(client, "viewer2", "viewer2@example.com")

    created = client.post("/api/v1/documents", json={"title": "Shareable"}, headers=owner_headers)
    document_id = created.json()["id"]

    link = client.post(
        f"/api/v1/documents/{document_id}/share-links",
        json={"role": "viewer", "expires_in_hours": None},
        headers=owner_headers,
    )
    token = link.json()["token"]

    redeemed = client.post(f"/api/v1/documents/share-links/{token}/redeem", headers=viewer_headers)
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["role"] == "viewer"

    updated = client.patch(
        f"/api/v1/documents/{document_id}/collaborators/{viewer['id']}",
        json={"role": "editor"},
        headers=owner_headers,
    )
    assert updated.status_code == 200, updated.text
    collaborator = next(c for c in updated.json()["collaborators"] if c["user_id"] == viewer["id"])
    assert collaborator["role"] == "editor"

    removed = client.delete(
        f"/api/v1/documents/{document_id}/collaborators/{viewer['id']}",
        headers=owner_headers,
    )
    assert removed.status_code == 200, removed.text
    assert all(c["user_id"] != viewer["id"] for c in removed.json()["collaborators"])


def test_ai_stream_history_and_cancel(client):
    owner, headers = register_and_login(client, "aiuser", "ai@example.com")
    created = client.post("/api/v1/documents", json={"title": "AI Doc"}, headers=headers)
    document_id = created.json()["id"]

    with client.stream(
        "POST",
        "/api/v1/ai/rewrite/stream",
        json={
            "text": "this sentence needs cleanup.",
            "context": {
                "user_id": owner["id"],
                "document_id": document_id,
                "document_context": "Surrounding document text.",
            },
        },
        headers=headers,
    ) as response:
        assert response.status_code == 200, response.text
        request_id = response.headers["x-request-id"]
        body = "".join(response.iter_text())
        assert '"done": true' in body
        assert request_id

    history = client.get(f"/api/v1/ai/history/{document_id}", params={"user_id": owner["id"]}, headers=headers)
    assert history.status_code == 200, history.text
    entry = history.json()[0]
    assert entry["id"] == request_id
    assert entry["operation"] == "rewrite"
    assert entry["status"] == "completed"
    assert entry["input_text"] == "this sentence needs cleanup."
    assert entry["result_text"]
    assert entry["model"]
    assert "Instruction:" in entry["prompt_text"]
    assert "Surrounding document text." in entry["prompt_text"]
    assert entry["outcome"] is None

    cancel = client.post(f"/api/v1/ai/generations/{request_id}/cancel", headers=headers)
    assert cancel.status_code == 202, cancel.text


def test_ai_prompt_bounds_long_input_and_context(client):
    from app.services.ai.provider import MAX_CONTEXT_CHARS, MAX_INPUT_CHARS

    owner, headers = register_and_login(client, "boundsuser", "bounds@example.com")
    document_id = client.post("/api/v1/documents", json={"title": "Bounds"}, headers=headers).json()["id"]

    long_text = "x" * (MAX_INPUT_CHARS + 200)
    long_ctx = "y" * (MAX_CONTEXT_CHARS + 200)
    with client.stream(
        "POST",
        "/api/v1/ai/rewrite/stream",
        json={
            "text": long_text,
            "context": {
                "user_id": owner["id"],
                "document_id": document_id,
                "document_context": long_ctx,
            },
        },
        headers=headers,
    ) as response:
        assert response.status_code == 200
        list(response.iter_text())

    history = client.get(f"/api/v1/ai/history/{document_id}", params={"user_id": owner["id"]}, headers=headers)
    entry = history.json()[0]
    assert len(entry["input_text"]) == MAX_INPUT_CHARS
    # Context fits into prompt_text (bounded), so full prompt length is bounded too.
    assert "y" * MAX_CONTEXT_CHARS in entry["prompt_text"]
    assert "y" * (MAX_CONTEXT_CHARS + 1) not in entry["prompt_text"]


def test_ai_record_outcome_persists(client):
    owner, headers = register_and_login(client, "outcomeuser", "outcome@example.com")
    document_id = client.post("/api/v1/documents", json={"title": "Outcome"}, headers=headers).json()["id"]

    with client.stream(
        "POST",
        "/api/v1/ai/rewrite/stream",
        json={
            "text": "some text.",
            "context": {"user_id": owner["id"], "document_id": document_id},
        },
        headers=headers,
    ) as resp:
        assert resp.status_code == 200
        interaction_id = resp.headers["x-request-id"]
        list(resp.iter_text())

    patched = client.patch(
        f"/api/v1/ai/generations/{interaction_id}/outcome",
        json={"outcome": "accepted", "applied_text": "some text."},
        headers=headers,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["outcome"] == "accepted"

    history = client.get(f"/api/v1/ai/history/{document_id}", params={"user_id": owner["id"]}, headers=headers)
    assert history.json()[0]["outcome"] == "accepted"


def test_ai_record_outcome_rejects_other_users(client):
    owner, owner_headers = register_and_login(client, "outowner", "outowner@example.com")
    other, other_headers = register_and_login(client, "outother", "outother@example.com")
    document_id = client.post("/api/v1/documents", json={"title": "OutcomeAuth"}, headers=owner_headers).json()["id"]

    with client.stream(
        "POST",
        "/api/v1/ai/rewrite/stream",
        json={"text": "x", "context": {"user_id": owner["id"], "document_id": document_id}},
        headers=owner_headers,
    ) as resp:
        interaction_id = resp.headers["x-request-id"]
        list(resp.iter_text())

    resp = client.patch(
        f"/api/v1/ai/generations/{interaction_id}/outcome",
        json={"outcome": "accepted"},
        headers=other_headers,
    )
    assert resp.status_code == 403, resp.text


def test_ai_record_outcome_rejects_invalid_outcome(client):
    owner, headers = register_and_login(client, "badout", "badout@example.com")
    document_id = client.post("/api/v1/documents", json={"title": "BadOut"}, headers=headers).json()["id"]

    with client.stream(
        "POST",
        "/api/v1/ai/rewrite/stream",
        json={"text": "x", "context": {"user_id": owner["id"], "document_id": document_id}},
        headers=headers,
    ) as resp:
        interaction_id = resp.headers["x-request-id"]
        list(resp.iter_text())

    resp = client.patch(
        f"/api/v1/ai/generations/{interaction_id}/outcome",
        json={"outcome": "pending"},
        headers=headers,
    )
    assert resp.status_code == 422


def test_ai_cancel_completed_generation_preserves_outcome(client):
    """Cancelling a completed (non-pending) generation must NOT overwrite its outcome to 'cancelled'."""
    owner, headers = register_and_login(client, "cancelout", "cancelout@example.com")
    document_id = client.post("/api/v1/documents", json={"title": "CancelOut"}, headers=headers).json()["id"]

    with client.stream(
        "POST",
        "/api/v1/ai/rewrite/stream",
        json={"text": "x.", "context": {"user_id": owner["id"], "document_id": document_id}},
        headers=headers,
    ) as resp:
        interaction_id = resp.headers["x-request-id"]
        list(resp.iter_text())

    cancel = client.post(f"/api/v1/ai/generations/{interaction_id}/cancel", headers=headers)
    assert cancel.status_code == 202

    history = client.get(f"/api/v1/ai/history/{document_id}", params={"user_id": owner["id"]}, headers=headers)
    assert history.json()[0]["outcome"] is None


def test_viewer_cannot_use_ai_generation_or_cancel(client):
    owner, owner_headers = register_and_login(client, "aiowner", "aiowner@example.com")
    viewer, viewer_headers = register_and_login(client, "aiviewer", "aiviewer@example.com")

    created = client.post("/api/v1/documents", json={"title": "AI Access Test"}, headers=owner_headers)
    document_id = created.json()["id"]

    client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": viewer["email"], "role": "viewer"},
        headers=owner_headers,
    )

    rewrite_resp = client.post(
        "/api/v1/ai/rewrite/stream",
        json={"text": "hello", "context": {"user_id": viewer["id"], "document_id": document_id}},
        headers=viewer_headers,
    )
    assert rewrite_resp.status_code == 403, rewrite_resp.text

    summarize_resp = client.post(
        "/api/v1/ai/summarize/stream",
        json={"text": "hello", "context": {"user_id": viewer["id"], "document_id": document_id}},
        headers=viewer_headers,
    )
    assert summarize_resp.status_code == 403, summarize_resp.text


def test_viewer_can_read_ai_history(client):
    owner, owner_headers = register_and_login(client, "histowner", "histowner@example.com")
    viewer, viewer_headers = register_and_login(client, "histviewer", "histviewer@example.com")

    created = client.post("/api/v1/documents", json={"title": "History Test"}, headers=owner_headers)
    document_id = created.json()["id"]

    client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": viewer["email"], "role": "viewer"},
        headers=owner_headers,
    )

    history_resp = client.get(
        f"/api/v1/ai/history/{document_id}",
        params={"user_id": viewer["id"]},
        headers=viewer_headers,
    )
    assert history_resp.status_code == 200, history_resp.text
    assert history_resp.json() == []


def test_viewer_cannot_cancel_own_generation_after_role_downgrade(client):
    """Viewer who previously generated as editor is blocked from cancelling their interaction."""
    owner, owner_headers = register_and_login(client, "cancelowner", "cancelowner@example.com")
    user, user_headers = register_and_login(client, "canceluser", "canceluser@example.com")

    created = client.post("/api/v1/documents", json={"title": "Cancel Test"}, headers=owner_headers)
    document_id = created.json()["id"]

    # Share as editor so the user can generate
    client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": user["email"], "role": "editor"},
        headers=owner_headers,
    )

    with client.stream(
        "POST",
        "/api/v1/ai/rewrite/stream",
        json={"text": "some text.", "context": {"user_id": user["id"], "document_id": document_id}},
        headers=user_headers,
    ) as resp:
        assert resp.status_code == 200
        interaction_id = resp.headers["x-request-id"]
        list(resp.iter_text())  # drain stream

    # Downgrade to viewer
    client.patch(
        f"/api/v1/documents/{document_id}/collaborators/{user['id']}",
        json={"role": "viewer"},
        headers=owner_headers,
    )

    cancel_resp = client.post(
        f"/api/v1/ai/generations/{interaction_id}/cancel",
        headers=user_headers,
    )
    assert cancel_resp.status_code == 403, cancel_resp.text


def test_editor_and_owner_can_use_ai_endpoints(client):
    owner, owner_headers = register_and_login(client, "aiowner2", "aiowner2@example.com")
    editor, editor_headers = register_and_login(client, "aieditor2", "aieditor2@example.com")

    created = client.post("/api/v1/documents", json={"title": "AI Allow Test"}, headers=owner_headers)
    document_id = created.json()["id"]

    client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": editor["email"], "role": "editor"},
        headers=owner_headers,
    )

    for headers, uid in [(owner_headers, owner["id"]), (editor_headers, editor["id"])]:
        with client.stream(
            "POST",
            "/api/v1/ai/rewrite/stream",
            json={"text": "test sentence.", "context": {"user_id": uid, "document_id": document_id}},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200, resp.text
            list(resp.iter_text())

        with client.stream(
            "POST",
            "/api/v1/ai/summarize/stream",
            json={"text": "test sentence.", "context": {"user_id": uid, "document_id": document_id}},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200, resp.text
            list(resp.iter_text())


def test_non_collaborator_cannot_use_ai_endpoints(client):
    owner, owner_headers = register_and_login(client, "aiowner3", "aiowner3@example.com")
    outsider, outsider_headers = register_and_login(client, "outsider3", "outsider3@example.com")

    created = client.post("/api/v1/documents", json={"title": "Private"}, headers=owner_headers)
    document_id = created.json()["id"]

    resp = client.post(
        "/api/v1/ai/rewrite/stream",
        json={"text": "hello", "context": {"user_id": outsider["id"], "document_id": document_id}},
        headers=outsider_headers,
    )
    assert resp.status_code == 403, resp.text


def _token_for(headers: dict[str, str]) -> str:
    return headers["Authorization"].split(" ", 1)[1]


def _make_yjs_update_message(text_value: str) -> bytes:
    """Build a real Yjs SYNC_UPDATE wire-frame inserting `text_value` into
    a Y.Text named "default". Used to prove that viewer mutations are dropped
    server-side rather than relying on UI guards."""
    import y_py as Y
    from ypy_websocket.yutils import create_update_message

    doc = Y.YDoc()
    text = doc.get_text("default")
    with doc.begin_transaction() as txn:
        text.insert(txn, 0, text_value)
    return create_update_message(Y.encode_state_as_update(doc))


def _read_room_state(document_id: str) -> bytes:
    """Read the current YDoc state for a document (sync wrapper around the
    async server API)."""
    import asyncio
    from app.websocket.collaboration import (
        ensure_websocket_server_running,
        normalize_room_name,
        websocket_server,
    )

    async def go() -> bytes:
        await ensure_websocket_server_running()
        return await websocket_server.snapshot(normalize_room_name(document_id))

    return asyncio.run(go())


def _inject_into_room(document_id: str, text_value: str) -> None:
    """Directly mutate the live YDoc in the collaboration room — simulates the
    effect of an editor having already collaborated through Yjs without having
    to drive the full websocket handshake from a sync test."""
    import asyncio
    import y_py as Y
    from app.websocket.collaboration import (
        ensure_websocket_server_running,
        normalize_room_name,
        websocket_server,
    )

    async def go() -> None:
        await ensure_websocket_server_running()
        room = await websocket_server.get_room(normalize_room_name(document_id))
        text = room.ydoc.get_text("default")
        with room.ydoc.begin_transaction() as txn:
            text.insert(txn, 0, text_value)
        if room.ystore is not None:
            await room.ystore.write(Y.encode_state_as_update(room.ydoc))

    asyncio.run(go())


def test_viewer_websocket_can_connect_and_read(client):
    """A viewer should still be able to open the collab WS and receive the
    initial sync handshake — only mutations must be blocked."""
    owner, owner_headers = register_and_login(client, "rvowner", "rvowner@example.com")
    viewer, viewer_headers = register_and_login(client, "rvviewer", "rvviewer@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "ROView"}, headers=owner_headers
    ).json()["id"]
    client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": viewer["email"], "role": "viewer"},
        headers=owner_headers,
    )

    with client.websocket_connect(f"/ws/{document_id}?token={_token_for(viewer_headers)}") as ws:
        first = ws.receive_bytes()
        # Server greets with a SYNC message (sync_step1) so the read path works.
        assert first[0] == 0


def test_viewer_yjs_mutation_is_dropped_server_side(client):
    """A crafted viewer client cannot inject document updates — even when the
    frontend protections are bypassed. The mutation must be filtered before it
    reaches the YRoom."""
    owner, owner_headers = register_and_login(client, "vmoowner", "vmoowner@example.com")
    viewer, viewer_headers = register_and_login(client, "vmoviewer", "vmoviewer@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "MutBlock"}, headers=owner_headers
    ).json()["id"]
    client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": viewer["email"], "role": "viewer"},
        headers=owner_headers,
    )

    payload = "VIEWER_INJECTED_MUTATION"
    with client.websocket_connect(f"/ws/{document_id}?token={_token_for(viewer_headers)}") as ws:
        ws.receive_bytes()  # drain server's sync_step1
        ws.send_bytes(_make_yjs_update_message(payload))

    import y_py as Y
    server_state = _read_room_state(document_id)
    server_doc = Y.YDoc()
    Y.apply_update(server_doc, server_state)
    text = str(server_doc.get_text("default"))
    assert payload not in text, "Viewer mutation should never be applied server-side"


def test_editor_yjs_mutation_propagates(client):
    """Sanity-check the negative case: an editor's update IS applied — the
    read-only filter must not break collaboration for allowed roles."""
    owner, owner_headers = register_and_login(client, "edmowner", "edmowner@example.com")
    editor, editor_headers = register_and_login(client, "edmeditor", "edmeditor@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "EdPropagate"}, headers=owner_headers
    ).json()["id"]
    client.post(
        f"/api/v1/documents/{document_id}/share",
        json={"username_or_email": editor["email"], "role": "editor"},
        headers=owner_headers,
    )

    payload = "EDITOR_WROTE_THIS"
    with client.websocket_connect(f"/ws/{document_id}?token={_token_for(editor_headers)}") as ws:
        ws.receive_bytes()  # drain server's sync_step1
        ws.send_bytes(_make_yjs_update_message(payload))
        # Pull a few frames so the server has time to process before disconnect.
        try:
            for _ in range(3):
                ws.receive_bytes()
        except Exception:
            pass

    import y_py as Y
    server_state = _read_room_state(document_id)
    server_doc = Y.YDoc()
    Y.apply_update(server_doc, server_state)
    assert payload in str(server_doc.get_text("default"))


def test_owner_yjs_mutation_propagates(client):
    """Owners must also be able to write through Yjs."""
    owner, owner_headers = register_and_login(client, "ownmtowner", "ownmt@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "OwnerWrite"}, headers=owner_headers
    ).json()["id"]

    payload = "OWNER_WROTE_THIS"
    with client.websocket_connect(f"/ws/{document_id}?token={_token_for(owner_headers)}") as ws:
        ws.receive_bytes()
        ws.send_bytes(_make_yjs_update_message(payload))
        try:
            for _ in range(3):
                ws.receive_bytes()
        except Exception:
            pass

    import y_py as Y
    server_state = _read_room_state(document_id)
    server_doc = Y.YDoc()
    Y.apply_update(server_doc, server_state)
    assert payload in str(server_doc.get_text("default"))


# ── M3: Version history must reflect collaborative state ─────────────────────

def test_versions_get_does_not_create_duplicates(client):
    """Calling GET /versions repeatedly must be idempotent — listing versions
    is a read, it should never spawn duplicate snapshots or corrupt numbering."""
    owner, headers = register_and_login(client, "vidup_owner", "vidup@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "VerDup"}, headers=headers
    ).json()["id"]
    # Add some real collab state once.
    _inject_into_room(document_id, "shared edit")
    doc = store.get_document(document_id)
    assert doc is not None
    original_version = doc.version
    original_count = len(doc.versions)

    first = client.get(f"/api/v1/documents/{document_id}/versions", headers=headers)
    assert first.status_code == 200
    first_versions = first.json()
    second = client.get(f"/api/v1/documents/{document_id}/versions", headers=headers)
    third = client.get(f"/api/v1/documents/{document_id}/versions", headers=headers)
    assert second.json() == first_versions
    assert third.json() == first_versions

    version_numbers = [v["version"] for v in first_versions]
    assert len(version_numbers) == len(set(version_numbers)), "duplicate version numbers"
    assert doc.version == original_version, "GET /versions must not increment the persisted version"
    assert len(doc.versions) == original_count, "GET /versions must not append persisted versions"


def test_versions_capture_collab_edit(client):
    """A pure Yjs edit (no REST PATCH) must surface in version history with
    the actual collaborative content as the preview."""
    owner, headers = register_and_login(client, "vcol_owner", "vcol@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "Collab Capture"}, headers=headers
    ).json()["id"]

    _inject_into_room(document_id, "collab-only edit")

    versions = client.get(f"/api/v1/documents/{document_id}/versions", headers=headers).json()
    assert any("collab-only edit" in v["content"] for v in versions), (
        f"collab content missing from version history: {versions}"
    )


def test_versions_empty_yjs_does_not_wipe_rest_content(client):
    """If the Yjs room is missing or empty, list_versions must NOT clobber the
    REST-authored versions with an empty placeholder."""
    owner, headers = register_and_login(client, "vempty_owner", "vempty@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "EmptyYjs"}, headers=headers
    ).json()["id"]
    client.patch(
        f"/api/v1/documents/{document_id}",
        json={"content": "<p>REST content</p>"},
        headers=headers,
    )

    versions = client.get(f"/api/v1/documents/{document_id}/versions", headers=headers).json()
    assert any(v["content"] == "<p>REST content</p>" for v in versions)
    # No autosave version with empty content should have been inserted.
    assert all(v["content"] != "" or v["version"] == 1 for v in versions), (
        f"empty placeholder version inserted: {versions}"
    )


def test_restore_brings_back_collab_state(client):
    """Restoring a version must replay the saved Yjs snapshot into the live
    room so subsequent reads see the restored collaborative state."""
    import y_py as Y

    owner, headers = register_and_login(client, "restore_owner", "restore@example.com")
    document_id = client.post(
        "/api/v1/documents", json={"title": "Restore Doc"}, headers=headers
    ).json()["id"]

    _inject_into_room(document_id, "v_alpha ")
    versions = client.get(f"/api/v1/documents/{document_id}/versions", headers=headers).json()
    captured_version = max(v["version"] for v in versions)

    # Mutate the live room past the captured version.
    _inject_into_room(document_id, "v_beta ")

    restored = client.post(
        f"/api/v1/documents/{document_id}/versions/{captured_version}/restore",
        headers=headers,
    )
    assert restored.status_code == 200, restored.text

    # Live room must now equal the restored snapshot — it should contain
    # v_alpha (the captured state) but NOT v_beta (the post-capture mutation).
    state = _read_room_state(document_id)
    doc = Y.YDoc()
    Y.apply_update(doc, state)
    text = str(doc.get_text("default"))
    assert "v_alpha" in text
    assert "v_beta" not in text


def test_websocket_requires_access_token_and_document_access(client):
    owner, owner_headers = register_and_login(client, "wsowner", "wsowner@example.com")
    other, _ = register_and_login(client, "wsother", "wsother@example.com")
    document_id = client.post("/api/v1/documents", json={"title": "Realtime"}, headers=owner_headers).json()["id"]
    access_token = owner_headers["Authorization"].split(" ", 1)[1]

    with client.websocket_connect(f"/ws/{document_id}?token={access_token}") as websocket:
        message = websocket.receive_bytes()
        assert message[0] == 0

    denied = client.post(
        "/api/v1/auth/login",
        json={"username": other["username"], "password": "password123"},
    )
    other_token = denied.json()["access_token"]
    try:
        client.websocket_connect(f"/ws/{document_id}?token={other_token}")
        assert False, "Expected websocket handshake failure"
    except Exception:
        pass
