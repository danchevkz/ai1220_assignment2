from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.models.store import DocumentRecord, DocumentRole, UserRecord, VersionRecord, store
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


@router.get("", response_model=list[DocumentSummaryRead])
def list_documents(current_user: UserRecord = Depends(get_current_user)) -> list[DocumentSummaryRead]:
    docs = []
    for doc in store.documents.values():
        role = role_for(doc, current_user.id)
        if role is not None:
            docs.append(serialize_summary(doc, role))
    docs.sort(key=lambda item: item.updated_at, reverse=True)
    return docs


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: CreateDocumentRequest,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = store.create_document(owner_id=current_user.id, title=payload.title or "Untitled")
    return serialize_document(doc)


@router.get("/{document_id}", response_model=DocumentRead)
def get_document(document_id: str, current_user: UserRecord = Depends(get_current_user)) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner", "editor", "viewer"})
    return serialize_document(doc)


@router.patch("/{document_id}", response_model=DocumentRead)
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
    return serialize_document(doc)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str, current_user: UserRecord = Depends(get_current_user)) -> None:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner"})
    store.documents.pop(doc.id, None)


@router.post("/{document_id}/share", response_model=DocumentRead)
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


@router.patch("/{document_id}/collaborators/{user_id}", response_model=DocumentRead)
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


@router.delete("/{document_id}/collaborators/{user_id}", response_model=DocumentRead)
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


@router.get("/{document_id}/share-links", response_model=list[ShareLinkRead])
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


@router.post("/{document_id}/share-links", response_model=ShareLinkRead, status_code=status.HTTP_201_CREATED)
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


@router.delete("/{document_id}/share-links/{token}", status_code=status.HTTP_204_NO_CONTENT)
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


@router.post("/share-links/{token}/redeem", response_model=RedeemShareLinkResponse)
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


@router.get("/{document_id}/versions", response_model=list[DocumentVersionRead])
async def list_versions(
    document_id: str,
    current_user: UserRecord = Depends(get_current_user),
) -> list[DocumentVersionRead]:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner", "editor", "viewer"})
    room_name = normalize_room_name(doc.id)
    try:
        snapshot = await websocket_server.snapshot(room_name)
    except Exception:
        snapshot = None
    if snapshot and (not doc.versions or doc.versions[-1].yjs_snapshot != snapshot):
        doc.versions.append(
            VersionRecord(
                version=doc.version,
                content=doc.content,
                saved_at=doc.updated_at,
                saved_by="system",
                yjs_snapshot=snapshot,
            )
        )
    deduped: dict[int, VersionRecord] = {}
    for version in doc.versions:
        deduped[version.version] = version
    return [serialize_version(version) for version in deduped.values()]


@router.post("/{document_id}/versions/{version_number}/restore", response_model=DocumentRead)
async def restore_version(
    document_id: str,
    version_number: int,
    current_user: UserRecord = Depends(get_current_user),
) -> DocumentRead:
    doc = require_document(document_id)
    require_role(doc, current_user.id, {"owner", "editor"})
    selected = next((version for version in doc.versions if version.version == version_number), None)
    if selected is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")

    current_snapshot = None
    try:
        current_snapshot = await websocket_server.snapshot(normalize_room_name(doc.id))
    except Exception:
        pass
    doc.version += 1
    doc.versions.append(
        VersionRecord(
            version=doc.version,
            content=doc.content,
            saved_at=doc.updated_at,
            saved_by=current_user.username,
            yjs_snapshot=current_snapshot,
        )
    )

    doc.content = selected.content
    store.touch_document(doc)
    if selected.yjs_snapshot is not None:
        await websocket_server.restore(normalize_room_name(doc.id), selected.yjs_snapshot)
    return serialize_document(doc)
