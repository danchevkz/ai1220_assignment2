from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user
from app.models.store import AIInteractionRecord, DocumentRecord, UserRecord, store
from app.schemas.ai import (
    AIHistoryItemRead,
    RecordOutcomeRequest,
    RewriteStreamRequest,
    SummarizeStreamRequest,
)
from app.services.ai.prompts import REWRITE_INSTRUCTION, SUMMARIZE_INSTRUCTION
from app.services.ai.provider import build_prompt, provider

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


@router.post(
    "/rewrite/stream",
    summary="Rewrite text via streaming AI completion",
    description=(
        "Streams the rewritten text back as SSE frames of the shape "
        "`{request_id, operation, delta, done}` so the UI can render chunks "
        "progressively. The `X-Request-ID` response header exposes the "
        "interaction id for cancellation and outcome recording. Requires "
        "owner or editor on the target document — viewers get 403."
    ),
)
def rewrite_stream(
    payload: RewriteStreamRequest,
    response: Response,
    current_user: UserRecord = Depends(get_current_user),
) -> StreamingResponse:
    ctx = payload.context
    document_id = ctx.document_id if ctx else None
    if not document_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="document_id is required")
    require_document_for_ai(document_id, current_user)

    prompt = build_prompt(
        instruction=REWRITE_INSTRUCTION,
        text=payload.text,
        context=ctx.document_context if ctx else None,
    )
    interaction = store.add_ai_interaction(
        document_id,
        current_user.id,
        "rewrite",
        prompt.text,
        prompt_text=prompt.render(),
        model=provider.model,
    )
    generated = provider.rewrite(prompt)
    response.headers["X-Request-ID"] = interaction.id
    return StreamingResponse(
        stream_text(interaction, generated),
        media_type="text/event-stream",
        headers={"X-Request-ID": interaction.id, "Cache-Control": "no-cache"},
    )


@router.post(
    "/summarize/stream",
    summary="Summarize text via streaming AI completion",
    description=(
        "Streams a concise summary of the input text as SSE frames in the "
        "same `{request_id, operation, delta, done}` shape as rewrite. "
        "`max_sentences` caps the summary length. Requires owner or editor; "
        "viewers cannot trigger generations."
    ),
)
def summarize_stream(
    payload: SummarizeStreamRequest,
    response: Response,
    current_user: UserRecord = Depends(get_current_user),
) -> StreamingResponse:
    ctx = payload.context
    document_id = ctx.document_id if ctx else None
    if not document_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="document_id is required")
    require_document_for_ai(document_id, current_user)

    prompt = build_prompt(
        instruction=SUMMARIZE_INSTRUCTION,
        text=payload.text,
        context=ctx.document_context if ctx else None,
    )
    interaction = store.add_ai_interaction(
        document_id,
        current_user.id,
        "summarize",
        prompt.text,
        prompt_text=prompt.render(),
        model=provider.model,
    )
    generated = provider.summarize(prompt, payload.max_sentences)
    response.headers["X-Request-ID"] = interaction.id
    return StreamingResponse(
        stream_text(interaction, generated),
        media_type="text/event-stream",
        headers={"X-Request-ID": interaction.id, "Cache-Control": "no-cache"},
    )


@router.get(
    "/history/{document_id}",
    response_model=list[AIHistoryItemRead],
    summary="List the caller's AI interactions for a document",
    description=(
        "Returns AI interactions scoped to a single user on a single "
        "document, newest first. History is intentionally per-user-per-"
        "document — callers may only request their own `user_id`; passing "
        "someone else's id returns 403 even if they share the document. "
        "Viewers CAN read their own history."
    ),
)
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
            id=item.id,
            operation=item.operation,
            timestamp=item.created_at.isoformat(),
            status=item.status,
            prompt_text=item.prompt_text,
            model=item.model,
            input_text=item.input_text,
            result_text=item.result_text,
            outcome=item.outcome,
        )
        for item in items
    ]


@router.post(
    "/generations/{interaction_id}/cancel",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Cancel an in-flight AI generation",
    description=(
        "Marks the interaction as cancel-requested; the streaming loop "
        "notices on its next tick and tears the SSE stream down. Only the "
        "user who started the generation may cancel it. Returns 202 (accepted "
        "for processing) rather than 200 because cancellation is cooperative."
    ),
)
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
    if interaction.outcome is None and interaction.status != "completed":
        interaction.outcome = "cancelled"
    return {"status": "cancelled"}


@router.patch(
    "/generations/{interaction_id}/outcome",
    response_model=AIHistoryItemRead,
    summary="Record how the user handled an AI generation",
    description=(
        "Records whether the user accepted, partially accepted, rejected, or "
        "regenerated the AI output, plus the actual text applied. Feeds the "
        "history drawer's outcome badges and future analytics. Only the user "
        "who owns the interaction may update it; viewers cannot."
    ),
)
def record_outcome(
    interaction_id: str,
    payload: RecordOutcomeRequest,
    current_user: UserRecord = Depends(get_current_user),
) -> AIHistoryItemRead:
    interaction = store.ai_interactions.get(interaction_id)
    if interaction is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation not found")
    if interaction.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    doc = store.get_document(interaction.document_id)
    if doc is not None and doc.collaborators.get(current_user.id) == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot record outcomes")
    interaction.outcome = payload.outcome
    if payload.applied_text is not None:
        interaction.applied_text = payload.applied_text
    return AIHistoryItemRead(
        id=interaction.id,
        operation=interaction.operation,
        timestamp=interaction.created_at.isoformat(),
        status=interaction.status,
        prompt_text=interaction.prompt_text,
        model=interaction.model,
        input_text=interaction.input_text,
        result_text=interaction.result_text,
        outcome=interaction.outcome,
    )
