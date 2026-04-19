from typing import Literal

from pydantic import BaseModel


AIOutcome = Literal["accepted", "rejected", "partial", "cancelled"]


class AIContext(BaseModel):
    user_id: str | None = None
    document_id: str | None = None
    document_context: str | None = None


class RewriteStreamRequest(BaseModel):
    text: str
    context: AIContext | None = None


class SummarizeStreamRequest(BaseModel):
    text: str
    context: AIContext | None = None
    max_sentences: int = 3
    format: str = "paragraph"


class AIHistoryItemRead(BaseModel):
    id: str
    operation: Literal["rewrite", "summarize"]
    timestamp: str
    status: Literal["pending", "completed", "failed", "cancelled"]
    prompt_text: str
    model: str
    input_text: str
    result_text: str
    outcome: str | None


class RecordOutcomeRequest(BaseModel):
    outcome: AIOutcome
    applied_text: str | None = None
