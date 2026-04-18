from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class WritingOperation(str, Enum):
    REWRITE = "rewrite"
    SUMMARIZE = "summarize"


class InteractionStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AIRequestContext(BaseModel):
    document_id: str | None = Field(default=None, description="Collaborative document identifier.")
    user_id: str = Field(..., min_length=1, description="Requester identifier for quota and logging.")
    session_id: str | None = Field(default=None, description="Editor session identifier.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class BaseWritingRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Source text to transform.")
    instructions: str | None = Field(default=None, description="Optional user-authored guidance.")
    context: AIRequestContext


class RewriteRequest(BaseWritingRequest):
    tone: str | None = Field(default=None, description="Desired output tone.")
    preserve_meaning: bool = Field(default=True)


class SummarizeRequest(BaseWritingRequest):
    max_sentences: int = Field(default=3, ge=1, le=20)
    format: str = Field(default="paragraph", description="paragraph or bullets.")


class AIResult(BaseModel):
    operation: WritingOperation
    output_text: str
    model: str
    quota_remaining: int
    request_id: str


class QuotaStatus(BaseModel):
    allowed: bool
    limit: int
    used: int
    remaining: int


class LoggedInteraction(BaseModel):
    request_id: str
    operation: WritingOperation
    user_id: str
    document_id: str | None = None
    input_text_length: int = 0
    output_text_length: int = 0
    status: InteractionStatus
    created_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class AIInteractionHistoryItem(BaseModel):
    operation: WritingOperation
    timestamp: datetime
    status: InteractionStatus
    input_text_length: int
    output_text_length: int


class CancelGenerationResponse(BaseModel):
    request_id: str
    cancelled: bool
    status: InteractionStatus


class StreamChunk(BaseModel):
    request_id: str
    operation: WritingOperation
    delta: str
    done: bool = False
