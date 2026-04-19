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
        json={"text": "this sentence needs cleanup.", "context": {"user_id": owner["id"], "document_id": document_id}},
        headers=headers,
    ) as response:
        assert response.status_code == 200, response.text
        request_id = response.headers["x-request-id"]
        body = "".join(response.iter_text())
        assert '"done": true' in body
        assert request_id

    history = client.get(f"/api/v1/ai/history/{document_id}", params={"user_id": owner["id"]}, headers=headers)
    assert history.status_code == 200, history.text
    assert history.json()[0]["operation"] == "rewrite"
    assert history.json()[0]["status"] == "completed"

    cancel = client.post(f"/api/v1/ai/generations/{request_id}/cancel", headers=headers)
    assert cancel.status_code == 202, cancel.text


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
