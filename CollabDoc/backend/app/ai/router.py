from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from .logging_service import InteractionLoggingService
from .provider import EchoAIProvider
from .quota import QuotaExceededError, QuotaService
from .schemas import AIInteractionHistoryItem, AIResult, CancelGenerationResponse, InteractionStatus, RewriteRequest, SummarizeRequest
from .service import AIWritingService, GenerationRegistry
from .stream import stream_chunks

router = APIRouter(prefix="/ai", tags=["ai-writing"])

_quota_service = QuotaService()
_logging_service = InteractionLoggingService()
_provider = EchoAIProvider()
_generation_registry = GenerationRegistry()


def get_quota_service() -> QuotaService:
    return _quota_service


def get_logging_service() -> InteractionLoggingService:
    return _logging_service


def get_provider() -> EchoAIProvider:
    return _provider


def get_generation_registry() -> GenerationRegistry:
    return _generation_registry


def get_ai_writing_service(
    provider: EchoAIProvider = Depends(get_provider),
    quota_service: QuotaService = Depends(get_quota_service),
    logging_service: InteractionLoggingService = Depends(get_logging_service),
    generation_registry: GenerationRegistry = Depends(get_generation_registry),
) -> AIWritingService:
    return AIWritingService(
        provider=provider,
        quota_service=quota_service,
        logging_service=logging_service,
        generation_registry=generation_registry,
    )


@router.get("/history/{document_id}", response_model=list[AIInteractionHistoryItem])
def get_interaction_history(
    document_id: str,
    user_id: str = Query(..., min_length=1),
    logging_service: InteractionLoggingService = Depends(get_logging_service),
) -> list[AIInteractionHistoryItem]:
    entries = logging_service.list_history(document_id=document_id, user_id=user_id)
    return [
        AIInteractionHistoryItem(
            operation=entry.operation,
            timestamp=entry.created_at,
            status=entry.status,
            input_text_length=entry.input_text_length,
            output_text_length=entry.output_text_length,
        )
        for entry in entries
    ]


@router.post("/rewrite", response_model=AIResult)
def rewrite_text(
    request: RewriteRequest,
    service: AIWritingService = Depends(get_ai_writing_service),
) -> AIResult:
    try:
        return service.rewrite(request)
    except QuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc


@router.post("/summarize", response_model=AIResult)
def summarize_text(
    request: SummarizeRequest,
    service: AIWritingService = Depends(get_ai_writing_service),
) -> AIResult:
    try:
        return service.summarize(request)
    except QuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc


@router.post("/rewrite/stream")
def stream_rewrite(
    request: RewriteRequest,
    service: AIWritingService = Depends(get_ai_writing_service),
) -> StreamingResponse:
    try:
        request_id = service.create_generation_id()
        return StreamingResponse(
            stream_chunks(service.stream_rewrite(request, request_id=request_id)),
            media_type="text/event-stream",
            headers={"X-Request-ID": request_id},
        )
    except QuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc


@router.post("/summarize/stream")
def stream_summarize(
    request: SummarizeRequest,
    service: AIWritingService = Depends(get_ai_writing_service),
) -> StreamingResponse:
    try:
        request_id = service.create_generation_id()
        return StreamingResponse(
            stream_chunks(service.stream_summary(request, request_id=request_id)),
            media_type="text/event-stream",
            headers={"X-Request-ID": request_id},
        )
    except QuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc


@router.post("/generations/{request_id}/cancel", response_model=CancelGenerationResponse)
def cancel_generation(
    request_id: str,
    service: AIWritingService = Depends(get_ai_writing_service),
) -> CancelGenerationResponse:
    cancelled = service.cancel_generation(request_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail=f"Active generation '{request_id}' was not found.")
    return CancelGenerationResponse(
        request_id=request_id,
        cancelled=cancelled,
        status=InteractionStatus.CANCELLED,
    )
