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
