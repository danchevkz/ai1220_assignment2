from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import RLock
from typing import Literal
from uuid import uuid4


DocumentRole = Literal["owner", "editor", "viewer"]
AIStatus = Literal["pending", "completed", "failed", "cancelled"]


def utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass
class UserRecord:
    id: str
    username: str
    email: str
    password_hash: str
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class ShareLinkRecord:
    token: str
    document_id: str
    role: DocumentRole
    created_at: datetime
    created_by: str
    expires_at: datetime | None = None

    def is_expired(self, now: datetime | None = None) -> bool:
        if self.expires_at is None:
            return False
        return self.expires_at <= (now or utcnow())


@dataclass
class VersionRecord:
    version: int
    content: str
    saved_at: datetime
    saved_by: str
    yjs_snapshot: bytes | None = None


@dataclass
class DocumentRecord:
    id: str
    title: str
    owner_id: str
    content: str = ""
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    version: int = 1
    collaborators: dict[str, DocumentRole] = field(default_factory=dict)
    share_links: dict[str, ShareLinkRecord] = field(default_factory=dict)
    versions: list[VersionRecord] = field(default_factory=list)


@dataclass
class AIInteractionRecord:
    id: str
    document_id: str
    user_id: str
    operation: Literal["rewrite", "summarize"]
    input_text: str
    result_text: str = ""
    status: AIStatus = "pending"
    created_at: datetime = field(default_factory=utcnow)
    cancel_requested: bool = False


class InMemoryStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self.users: dict[str, UserRecord] = {}
        self.users_by_username: dict[str, str] = {}
        self.users_by_email: dict[str, str] = {}
        self.documents: dict[str, DocumentRecord] = {}
        self.ai_interactions: dict[str, AIInteractionRecord] = {}

    def reset(self) -> None:
        with self._lock:
            self.users.clear()
            self.users_by_username.clear()
            self.users_by_email.clear()
            self.documents.clear()
            self.ai_interactions.clear()

    def create_user(self, username: str, email: str, password_hash: str) -> UserRecord:
        with self._lock:
            key_username = username.strip().lower()
            key_email = email.strip().lower()
            if key_username in self.users_by_username:
                raise ValueError("Username is already taken")
            if key_email in self.users_by_email:
                raise ValueError("Email is already registered")
            user = UserRecord(
                id=str(uuid4()),
                username=username.strip(),
                email=email.strip(),
                password_hash=password_hash,
            )
            self.users[user.id] = user
            self.users_by_username[key_username] = user.id
            self.users_by_email[key_email] = user.id
            return user

    def get_user(self, user_id: str) -> UserRecord | None:
        return self.users.get(user_id)

    def find_user(self, username_or_email: str) -> UserRecord | None:
        key = username_or_email.strip().lower()
        user_id = self.users_by_username.get(key) or self.users_by_email.get(key)
        if user_id is None:
            return None
        return self.users[user_id]

    def create_document(self, owner_id: str, title: str = "Untitled") -> DocumentRecord:
        with self._lock:
            now = utcnow()
            doc = DocumentRecord(
                id=str(uuid4()),
                title=title or "Untitled",
                owner_id=owner_id,
                created_at=now,
                updated_at=now,
                collaborators={owner_id: "owner"},
            )
            doc.versions.append(
                VersionRecord(
                    version=1,
                    content=doc.content,
                    saved_at=now,
                    saved_by=owner_id,
                )
            )
            self.documents[doc.id] = doc
            return doc

    def get_document(self, document_id: str) -> DocumentRecord | None:
        return self.documents.get(document_id)

    def touch_document(self, doc: DocumentRecord) -> None:
        doc.updated_at = utcnow()

    def set_document_content(self, doc: DocumentRecord, content: str, saved_by: str) -> None:
        doc.content = content
        doc.version += 1
        now = utcnow()
        doc.updated_at = now
        doc.versions.append(
            VersionRecord(
                version=doc.version,
                content=content,
                saved_at=now,
                saved_by=saved_by,
            )
        )

    def create_share_link(
        self,
        doc: DocumentRecord,
        role: DocumentRole,
        created_by: str,
        expires_in_hours: int | None,
    ) -> ShareLinkRecord:
        now = utcnow()
        expires_at = None if expires_in_hours is None else now + timedelta(hours=expires_in_hours)
        link = ShareLinkRecord(
            token=str(uuid4()),
            document_id=doc.id,
            role=role,
            created_at=now,
            created_by=created_by,
            expires_at=expires_at,
        )
        doc.share_links[link.token] = link
        self.touch_document(doc)
        return link

    def get_share_link(self, token: str) -> ShareLinkRecord | None:
        for doc in self.documents.values():
            if token in doc.share_links:
                link = doc.share_links[token]
                if link.is_expired():
                    doc.share_links.pop(token, None)
                    return None
                return link
        return None

    def add_ai_interaction(
        self,
        document_id: str,
        user_id: str,
        operation: Literal["rewrite", "summarize"],
        input_text: str,
    ) -> AIInteractionRecord:
        interaction = AIInteractionRecord(
            id=str(uuid4()),
            document_id=document_id,
            user_id=user_id,
            operation=operation,
            input_text=input_text,
        )
        self.ai_interactions[interaction.id] = interaction
        return interaction


store = InMemoryStore()
