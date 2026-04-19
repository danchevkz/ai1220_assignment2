from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models.store import InMemoryStore, ShareLinkRecord


@pytest.fixture()
def s() -> InMemoryStore:
    store = InMemoryStore()
    yield store


# ── Users ──────────────────────────────────────────────────────────────────────

def test_create_user_success(s):
    user = s.create_user("alice", "alice@example.com", "hash")
    assert user.id
    assert user.username == "alice"
    assert user.email == "alice@example.com"


def test_create_user_duplicate_username_raises(s):
    s.create_user("alice", "alice@example.com", "h")
    with pytest.raises(ValueError, match="Username is already taken"):
        s.create_user("alice", "other@example.com", "h")


def test_create_user_duplicate_email_raises(s):
    s.create_user("alice", "alice@example.com", "h")
    with pytest.raises(ValueError, match="Email is already registered"):
        s.create_user("bob", "alice@example.com", "h")


def test_find_user_by_username(s):
    created = s.create_user("alice", "alice@example.com", "h")
    found = s.find_user("alice")
    assert found is not None
    assert found.id == created.id


def test_find_user_by_email(s):
    created = s.create_user("alice", "alice@example.com", "h")
    found = s.find_user("alice@example.com")
    assert found is not None
    assert found.id == created.id


def test_find_user_case_insensitive(s):
    s.create_user("Alice", "Alice@Example.com", "h")
    assert s.find_user("alice") is not None
    assert s.find_user("ALICE@EXAMPLE.COM") is not None


def test_get_user_missing_returns_none(s):
    assert s.get_user("nonexistent-id") is None


# ── Documents ──────────────────────────────────────────────────────────────────

def test_create_document_sets_owner_role(s):
    user = s.create_user("bob", "bob@example.com", "h")
    doc = s.create_document(user.id, "My Doc")
    assert doc.collaborators[user.id] == "owner"
    assert doc.title == "My Doc"
    assert doc.version == 1


def test_create_document_initial_version_recorded(s):
    user = s.create_user("bob", "bob@example.com", "h")
    doc = s.create_document(user.id)
    assert len(doc.versions) == 1
    assert doc.versions[0].version == 1
    assert doc.versions[0].saved_by == user.id


def test_set_document_content_increments_version(s):
    user = s.create_user("bob", "bob@example.com", "h")
    doc = s.create_document(user.id)
    s.set_document_content(doc, "<p>Hello</p>", user.id)
    assert doc.version == 2
    assert doc.content == "<p>Hello</p>"
    assert len(doc.versions) == 2
    assert doc.versions[1].version == 2


def test_set_document_content_multiple_versions(s):
    user = s.create_user("bob", "bob@example.com", "h")
    doc = s.create_document(user.id)
    s.set_document_content(doc, "v2", user.id)
    s.set_document_content(doc, "v3", user.id)
    assert doc.version == 3
    assert len(doc.versions) == 3


def test_get_document_missing_returns_none(s):
    assert s.get_document("no-such-doc") is None


# ── Share links ────────────────────────────────────────────────────────────────

def test_share_link_not_expired(s):
    user = s.create_user("carol", "carol@example.com", "h")
    doc = s.create_document(user.id)
    link = s.create_share_link(doc, "viewer", user.id, expires_in_hours=24)
    retrieved = s.get_share_link(link.token)
    assert retrieved is not None
    assert retrieved.role == "viewer"


def test_share_link_no_expiry(s):
    user = s.create_user("carol", "carol@example.com", "h")
    doc = s.create_document(user.id)
    link = s.create_share_link(doc, "editor", user.id, expires_in_hours=None)
    assert link.expires_at is None
    assert s.get_share_link(link.token) is not None


def test_share_link_expired_returns_none(s):
    user = s.create_user("carol", "carol@example.com", "h")
    doc = s.create_document(user.id)
    link = ShareLinkRecord(
        token="expired-token",
        document_id=doc.id,
        role="viewer",
        created_at=datetime.now(UTC),
        created_by=user.id,
        expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    doc.share_links[link.token] = link
    assert s.get_share_link("expired-token") is None


# ── AI interactions ────────────────────────────────────────────────────────────

def test_add_ai_interaction(s):
    user = s.create_user("dave", "dave@example.com", "h")
    doc = s.create_document(user.id)
    interaction = s.add_ai_interaction(doc.id, user.id, "rewrite", "some text")
    assert interaction.id
    assert interaction.document_id == doc.id
    assert interaction.user_id == user.id
    assert interaction.operation == "rewrite"
    assert interaction.input_text == "some text"
    assert interaction.status == "pending"
    assert interaction.result_text == ""
    assert s.ai_interactions[interaction.id] is interaction


# ── Reset ──────────────────────────────────────────────────────────────────────

def test_reset_clears_all(s):
    user = s.create_user("eve", "eve@example.com", "h")
    s.create_document(user.id)
    s.reset()
    assert s.users == {}
    assert s.documents == {}
    assert s.ai_interactions == {}
    assert s.users_by_username == {}
    assert s.users_by_email == {}
