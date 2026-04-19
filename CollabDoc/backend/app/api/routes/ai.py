from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user
from app.models.store import AIInteractionRecord, DocumentRecord, UserRecord, store
from app.schemas.ai import AIHistoryItemRead, RewriteStreamRequest, SummarizeStreamRequest
from app.services.ai.provider import provider

router = APIRouter(prefix="/ai", tags=["ai"])


def require_document_for_ai(
    document_id: str,
    current_user: UserRecord,
    *,
    allow_viewer: bool = False,
) -> DocumentRecord:
    doc = store.get_document(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    role = doc.collaborators.get(current_user.id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if role == "viewer" and not allow_viewer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot use AI features")
    return doc


def sse_frame(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def stream_text(
    interaction: AIInteractionRecord,
    generated_text: str,
) -> AsyncIterator[str]:
    words = generated_text.split()
    if not words:
        interaction.status = "completed"
        yield sse_frame(
            {
                "request_id": interaction.id,
                "operation": interaction.operation,
                "delta": "",
                "done": True,
            }
        )
        return

    result = []
    for word in words:
        if interaction.cancel_requested:
            interaction.status = "cancelled"
            return
        chunk = word + " "
        result.append(chunk)
        interaction.result_text = "".join(result).rstrip()
        yield sse_frame(
            {
                "request_id": interaction.id,
                "operation": interaction.operation,
                "delta": chunk,
                "done": False,
            }
        )
        await asyncio.sleep(0.01)

    interaction.result_text = generated_text
    interaction.status = "completed"
    yield sse_frame(
        {
            "request_id": interaction.id,
            "operation": interaction.operation,
            "delta": "",
            "done": True,
        }
    )


@router.post("/rewrite/stream")
def rewrite_stream(
    payload: RewriteStreamRequest,
    response: Response,
    current_user: UserRecord = Depends(get_current_user),
) -> StreamingResponse:
    document_id = payload.context.document_id if payload.context else None
    if not document_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="document_id is required")
    require_document_for_ai(document_id, current_user)
    interaction = store.add_ai_interaction(document_id, current_user.id, "rewrite", payload.text)
    generated = provider.rewrite(payload.text)
    response.headers["X-Request-ID"] = interaction.id
    return StreamingResponse(
        stream_text(interaction, generated),
        media_type="text/event-stream",
        headers={"X-Request-ID": interaction.id, "Cache-Control": "no-cache"},
    )


@router.post("/summarize/stream")
def summarize_stream(
    payload: SummarizeStreamRequest,
    response: Response,
    current_user: UserRecord = Depends(get_current_user),
) -> StreamingResponse:
    document_id = payload.context.document_id if payload.context else None
    if not document_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="document_id is required")
    require_document_for_ai(document_id, current_user)
    interaction = store.add_ai_interaction(document_id, current_user.id, "summarize", payload.text)
    generated = provider.summarize(payload.text, payload.max_sentences)
    response.headers["X-Request-ID"] = interaction.id
    return StreamingResponse(
        stream_text(interaction, generated),
        media_type="text/event-stream",
        headers={"X-Request-ID": interaction.id, "Cache-Control": "no-cache"},
    )


@router.get("/history/{document_id}", response_model=list[AIHistoryItemRead])
def ai_history(
    document_id: str,
    user_id: str,
    current_user: UserRecord = Depends(get_current_user),
) -> list[AIHistoryItemRead]:
    require_document_for_ai(document_id, current_user, allow_viewer=True)
    if user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot view another user's history")
    items = [
        interaction
        for interaction in store.ai_interactions.values()
        if interaction.document_id == document_id and interaction.user_id == user_id
    ]
    items.sort(key=lambda item: item.created_at, reverse=True)
    return [
        AIHistoryItemRead(
            operation=item.operation,
            timestamp=item.created_at.isoformat(),
            status=item.status,
            input_text_length=len(item.input_text),
            output_text_length=len(item.result_text),
        )
        for item in items
    ]


@router.post("/generations/{interaction_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
def cancel_generation(
    interaction_id: str,
    current_user: UserRecord = Depends(get_current_user),
) -> dict[str, str]:
    interaction = store.ai_interactions.get(interaction_id)
    if interaction is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation not found")
    if interaction.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    doc = store.get_document(interaction.document_id)
    if doc is not None and doc.collaborators.get(current_user.id) == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot cancel generations")
    interaction.cancel_requested = True
    if interaction.status == "pending":
        interaction.status = "cancelled"
    return {"status": "cancelled"}
