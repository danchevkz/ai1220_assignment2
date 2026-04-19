from __future__ import annotations

import y_py as Y
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.models.store import DocumentRecord, DocumentRole, UserRecord, VersionRecord, store, utcnow
from app.schemas.documents import (
    CreateDocumentRequest,
    CreateShareLinkRequest,
    DocumentCollaboratorRead,
    DocumentRead,
    DocumentSummaryRead,
    DocumentVersionRead,
    RedeemShareLinkResponse,
    ShareDocumentRequest,
    ShareLinkRead,
    UpdateCollaboratorRequest,
    UpdateDocumentRequest,
)
from app.websocket.collaboration import normalize_room_name, websocket_server


def is_empty_yjs_snapshot(snapshot: bytes | None) -> bool:
    """A Yjs `encode_state_as_update` of a freshly-constructed YDoc is the
    2-byte sentinel \\x00\\x00. Treat that — and missing snapshots — as
    "no usable collaborative content yet"."""
    if not snapshot:
        return True
    return snapshot == b"\x00\x00"


def content_from_yjs_snapshot(snapshot: bytes) -> str | None:
    """Best-effort extract a serialized text representation from a Yjs binary
    snapshot. Returns None if extraction yields nothing usable; callers should
    fall back to existing REST `doc.content` in that case."""
    try:
        ydoc = Y.YDoc()
        Y.apply_update(ydoc, snapshot)
    except Exception:
        return None

    # TipTap's Collaboration extension stores its prosemirror state under the
    # XmlFragment named "default". y-py exposes it via get_xml_element.
    pieces: list[str] = []
    try:
        xml = ydoc.get_xml_element("default")
        rendered = str(xml).strip()
        # y-py wraps top-level fragments with <UNDEFINED>…</UNDEFINED>; strip that.
        if rendered.startswith("<UNDEFINED>") and rendered.endswith("</UNDEFINED>"):
            rendered = rendered[len("<UNDEFINED>"):-len("</UNDEFINED>")]
        if rendered:
            pieces.append(rendered)
    except Exception:
        pass

    # Plain Y.Text fallback (some clients may store under "default" as text).
    try:
        text = str(ydoc.get_text("default")).strip()
        if text and text not in pieces:
            pieces.append(text)
    except Exception:
        pass

    combined = "".join(pieces).strip()
    return combined or None


# Cache the latest live collaborative snapshot exposed through GET /versions so
# the endpoint stays read-only while restore can still target the previewed
# snapshot the user saw in the drawer.
_live_version_cache: dict[str, VersionRecord] = {}

router = APIRouter(prefix="/documents", tags=["documents"])


def require_document(document_id: str) -> DocumentRecord:
    doc = store.get_document(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


def role_for(doc: DocumentRecord, user_id: str) -> DocumentRole | None:
    return doc.collaborators.get(user_id)


def require_role(doc: DocumentRecord, user_id: str, allowed: set[str]) -> str:
    role = role_for(doc, user_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if role not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return role


def serialize_collaborators(doc: DocumentRecord) -> list[DocumentCollaboratorRead]:
    users = []
    for user_id, role in doc.collaborators.items():
        user = store.get_user(user_id)
        if user is None:
            continue
        users.append(
            DocumentCollaboratorRead(
                user_id=user.id,
                username=user.username,
                email=user.email,
                role=role,
            )
        )
    users.sort(key=lambda item: (0 if item.role == "owner" else 1, item.username.lower()))
    return users


def serialize_document(doc: DocumentRecord) -> DocumentRead:
    return DocumentRead(
        id=doc.id,
        title=doc.title,
        content=doc.content,
        owner_id=doc.owner_id,
        created_at=doc.created_at.isoformat(),
        updated_at=doc.updated_at.isoformat(),
        version=doc.version,
        collaborators=serialize_collaborators(doc),
    )


def serialize_summary(doc: DocumentRecord, role: str) -> DocumentSummaryRead:
    return DocumentSummaryRead(
        id=doc.id,
        title=doc.title,
        owner_id=doc.owner_id,
        created_at=doc.created_at.isoformat(),
        updated_at=doc.updated_at.isoformat(),
        role=role,
    )


def serialize_version(version: VersionRecord) -> DocumentVersionRead:
    return DocumentVersionRead(
        version=version.version,
        content=version.content,
        saved_at=version.saved_at.isoformat(),
        saved_by=version.saved_by,
    )


def live_version_for(doc: DocumentRecord, snapshot: bytes | None) -> VersionRecord | None:
    cached = _live_version_cache.get(doc.id)
    if snapshot is None or is_empty_yjs_snapshot(snapshot):
        _live_version_cache.pop(doc.id, None)
        return None

    if any(version.yjs_snapshot == snapshot for version in doc.versions):
        _live_version_cache.pop(doc.id, None)
        return None

    extracted = content_from_yjs_snapshot(snapshot)
    content = extracted if extracted is not None else doc.content
    version_number = doc.version + 1

    if (
        cached is not None
        and cached.version == version_number
        and cached.yjs_snapshot == snapshot
        and cached.content == content
    ):
        return cached

    live_version = VersionRecord(
        version=version_number,
        content=content,
        saved_at=utcnow(),
        saved_by="autosave",
        yjs_snapshot=snapshot,
    )
    _live_version_cache[doc.id] = live_version
    return live_version


@router.get(
    "",
    response_model=list[DocumentSummaryRead],
    summary="List documents visible to the caller",
    description=(
        "Returns every document where the caller is owner, editor, or viewer, "
        "sorted by `updated_at` descending. Each entry includes the caller's "
        "role on that document so the UI can gate editing actions without a "
        "second round-trip."
    ),
)
def list_documents(current_user: UserRecord = Depends(get_current_user)) -> list[DocumentSummaryRead]:
    docs = []
    for doc in store.documents.values():
        role = role_for(doc, current_user.id)
        if role is not None:
            docs.append(serialize_summary(doc, role))
    docs.sort(key=lambda item: item.updated_at, reverse=True)
    return docs


@router.post(
    "",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new document",
    description=(
        "Creates an empty document owned by the caller, seeded with an initial "
        "v1 version record so the history drawer always has at least one entry. "
        "Missing/blank `title` defaults to `Untitled`."
    ),
)
def create_document(
    payload: CreateDocumentRequest,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = store.create_document(owner_id=current_user.id, title=payload.title or "Untitled")
    return serialize_document(doc)


@router.get(
    "/{document_id}",
    response_model=DocumentRead,
    summary="Get a single document",
    description=(
        "Returns the full document record including its collaborator roster "
        "and current REST-persisted `content`. Accessible to any collaborator "
        "(owner/editor/viewer); non-collaborators get 403, missing ids 404."
    ),
)
def get_document(document_id: str, current_user: UserRecord = Depends(get_current_user)) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner", "editor", "viewer"})
    return serialize_document(doc)


@router.patch(
    "/{document_id}",
    response_model=DocumentRead,
    summary="Update document metadata or content",
    description=(
        "Partial update of `title` and/or `content`. Title edits are debounced "
        "from the UI and don't snapshot a version; content edits do bump the "
        "version counter and append a version record. Requires owner or "
        "editor role — viewers get 403."
    ),
)
def update_document(
    document_id: str,
    payload: UpdateDocumentRequest,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner", "editor"})
    if payload.title is not None:
        doc.title = payload.title or "Untitled"
        store.touch_document(doc)
    if payload.content is not None and payload.content != doc.content:
        store.set_document_content(doc, payload.content, current_user.username)
        _live_version_cache.pop(doc.id, None)
    return serialize_document(doc)


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document",
    description=(
        "Permanently removes the document, its collaborators, share links, "
        "and version history. Owner-only. Returns 204 on success."
    ),
)
def delete_document(document_id: str, current_user: UserRecord = Depends(get_current_user)) -> None:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    _live_version_cache.pop(doc.id, None)
    store.documents.pop(doc.id, None)


@router.post(
    "/{document_id}/share",
    response_model=DocumentRead,
    summary="Invite an existing user as a collaborator",
    description=(
        "Grants the named user (looked up by username or email) the given "
        "role on the document. Owner-only. Role must be `editor` or `viewer` "
        "— the owner role is never assigned through this endpoint."
    ),
)
def share_document(
    document_id: str,
    payload: ShareDocumentRequest,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    if payload.role not in {"editor", "viewer"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    user = store.find_user(payload.username_or_email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    doc.collaborators[user.id] = payload.role
    store.touch_document(doc)
    return serialize_document(doc)


@router.patch(
    "/{document_id}/collaborators/{user_id}",
    response_model=DocumentRead,
    summary="Change a collaborator's role",
    description=(
        "Switches an existing collaborator between `editor` and `viewer`. "
        "Owner-only. The document owner's role itself is not mutable through "
        "this endpoint — attempting to change the owner's role returns 400."
    ),
)
def update_collaborator(
    document_id: str,
    user_id: str,
    payload: UpdateCollaboratorRequest,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    if user_id == doc.owner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner role cannot be changed")
    if user_id not in doc.collaborators:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collaborator not found")
    if payload.role not in {"editor", "viewer"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    doc.collaborators[user_id] = payload.role
    store.touch_document(doc)
    return serialize_document(doc)


@router.delete(
    "/{document_id}/collaborators/{user_id}",
    response_model=DocumentRead,
    summary="Revoke a collaborator's access",
    description=(
        "Removes the specified user from the document's collaborator list. "
        "Owner-only; the owner themselves cannot be removed. Returns the "
        "updated document so the UI can refresh the roster in-place."
    ),
)
def delete_collaborator(
    document_id: str,
    user_id: str,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    if user_id == doc.owner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner cannot be removed")
    if user_id not in doc.collaborators:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collaborator not found")
    doc.collaborators.pop(user_id, None)
    store.touch_document(doc)
    return serialize_document(doc)


@router.get(
    "/{document_id}/share-links",
    response_model=list[ShareLinkRead],
    summary="List active share-by-link tokens",
    description=(
        "Returns unexpired share links for the document, newest first. "
        "Owner-only. Each entry includes its role, creation timestamp, and "
        "optional expiry so the UI can render an 'expires in' label."
    ),
)
def list_share_links(
    document_id: str,
    current_user: UserRecord = Depends(get_current_user),
) -> list[ShareLinkRead]:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    active = [link for link in doc.share_links.values() if not link.is_expired()]
    active.sort(key=lambda item: item.created_at, reverse=True)
    return [
        ShareLinkRead(
            token=link.token,
            role=link.role,
            created_at=link.created_at.isoformat(),
            expires_at=link.expires_at.isoformat() if link.expires_at else None,
            created_by=link.created_by,
        )
        for link in active
    ]


@router.post(
    "/{document_id}/share-links",
    response_model=ShareLinkRead,
    status_code=status.HTTP_201_CREATED,
    summary="Mint a new share-by-link token",
    description=(
        "Creates a single-role share token that any signed-in user can redeem "
        "to join the document. Owner-only. `expires_in_hours` may be 24, 168 "
        "(7d), 720 (30d), or null for no expiry; role must be `editor` or "
        "`viewer`."
    ),
)
def create_share_link(
    document_id: str,
    payload: CreateShareLinkRequest,
    current_user: UserRecord = Depends(get_current_user),
) -> ShareLinkRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    if payload.role not in {"editor", "viewer"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    link = store.create_share_link(doc, payload.role, current_user.username, payload.expires_in_hours)
    return ShareLinkRead(
        token=link.token,
        role=link.role,
        created_at=link.created_at.isoformat(),
        expires_at=link.expires_at.isoformat() if link.expires_at else None,
        created_by=link.created_by,
    )


@router.delete(
    "/{document_id}/share-links/{token}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a share-by-link token",
    description=(
        "Invalidates a share link so it can no longer be redeemed. Already-"
        "redeemed collaborators keep their access — use the collaborator "
        "DELETE endpoint to remove them. Owner-only."
    ),
)
def delete_share_link(
    document_id: str,
    token: str,
    current_user: UserRecord = Depends(get_current_user),
) -> None:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    if token not in doc.share_links:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    doc.share_links.pop(token, None)
    store.touch_document(doc)


@router.post(
    "/share-links/{token}/redeem",
    response_model=RedeemShareLinkResponse,
    summary="Redeem a share link to join a document",
    description=(
        "Adds the caller to the document's collaborator list at the link's "
        "role, then returns the document plus the resolved role. The owner "
        "redeeming their own link is a no-op — they keep their `owner` role. "
        "Expired or unknown tokens return 404."
    ),
)
def redeem_share_link(token: str, current_user: UserRecord = Depends(get_current_user)) -> RedeemShareLinkResponse:
    link = store.get_share_link(token)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    doc = require_document(link.document_id)
    if current_user.id == doc.owner_id:
        role = "owner"
    else:
        doc.collaborators[current_user.id] = link.role
        store.touch_document(doc)
        role = link.role
    return RedeemShareLinkResponse(document=serialize_document(doc), role=role)


@router.get(
    "/{document_id}/versions",
    response_model=list[DocumentVersionRead],
    summary="List document versions including the live collaborative state",
    description=(
        "Returns the persisted version history plus, if the live Yjs room "
        "diverges from the latest persisted snapshot, a transient in-memory "
        "version that `restore` can still target. Read-only — the underlying "
        "document is not mutated. Accessible to any collaborator."
    ),
)
async def list_versions(
    document_id: str,
    current_user: UserRecord = Depends(get_current_user),
) -> list[DocumentVersionRead]:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner", "editor", "viewer"})

    # Surface the current collaborative state without mutating persisted
    # version history. If it hasn't been checkpointed yet, expose it as a
    # transient live version that restore can still target.
    live_version = live_version_for(doc, await _safe_snapshot(doc.id))

    # Dedupe by version number (defensive — list is append-only) and return
    # in stable ascending order.
    deduped: dict[int, VersionRecord] = {}
    for version in doc.versions:
        deduped[version.version] = version
    if live_version is not None:
        deduped[live_version.version] = live_version
    ordered = sorted(deduped.values(), key=lambda v: v.version)
    return [serialize_version(version) for version in ordered]


@router.post(
    "/{document_id}/versions/{version_number}/restore",
    response_model=DocumentRead,
    summary="Restore the document to a previous version",
    description=(
        "Snapshots the current live state as a new version (so nothing is "
        "lost), then replays the target version's Yjs snapshot into the live "
        "collaboration room so every connected client converges on the "
        "restored content. Requires owner or editor."
    ),
)
async def restore_version(
    document_id: str,
    version_number: int,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner", "editor"})
    selected = next((version for version in doc.versions if version.version == version_number), None)
    if selected is None:
        live_version = _live_version_cache.get(doc.id)
        if live_version is not None and live_version.version == version_number:
            selected = live_version
    if selected is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")

    # Snapshot the live collaborative state (if any) BEFORE we restore, so the
    # current state is itself preserved as a recoverable version. Use the live
    # Yjs content rather than the possibly-stale REST `doc.content`.
    pre_restore_snapshot = await _safe_snapshot(doc.id)
    pre_restore_content: str
    if pre_restore_snapshot is not None and not is_empty_yjs_snapshot(pre_restore_snapshot):
        extracted = content_from_yjs_snapshot(pre_restore_snapshot)
        pre_restore_content = extracted if extracted is not None else doc.content
    else:
        pre_restore_snapshot = None
        pre_restore_content = doc.content

    doc.version += 1
    doc.versions.append(
        VersionRecord(
            version=doc.version,
            content=pre_restore_content,
            saved_at=utcnow(),
            saved_by=current_user.username,
            yjs_snapshot=pre_restore_snapshot,
        )
    )

    # Restore the collaborative state to exactly what was saved. Skip the
    # collaborative restore if the saved version has no snapshot (REST-only
    # version) so we don't wipe the live YDoc with empty state.
    if selected.yjs_snapshot is not None and not is_empty_yjs_snapshot(selected.yjs_snapshot):
        await websocket_server.restore(normalize_room_name(f"ws/{doc.id}"), selected.yjs_snapshot)

    doc.content = selected.content
    _live_version_cache.pop(doc.id, None)
    store.touch_document(doc)
    return serialize_document(doc)


async def _safe_snapshot(document_id: str) -> bytes | None:
    # Rooms are keyed by the full websocket path (`/ws/{doc_id}`); using the
    # bare `/{doc_id}` silently reads a non-existent sibling room and returns
    # an empty snapshot, which silently breaks both version previews and
    # restore.
    try:
        return await websocket_server.snapshot(normalize_room_name(f"ws/{document_id}"))
    except Exception:
        return None
