from typing import Literal

from pydantic import BaseModel


class AIContext(BaseModel):
    user_id: str | None = None
    document_id: str | None = None


class RewriteStreamRequest(BaseModel):
    text: str
    context: AIContext | None = None


class SummarizeStreamRequest(BaseModel):
    text: str
    context: AIContext | None = None
    max_sentences: int = 3
    format: str = "paragraph"


class AIHistoryItemRead(BaseModel):
    operation: Literal["rewrite", "summarize"]
    timestamp: str
    status: Literal["pending", "completed", "failed", "cancelled"]
    input_text_length: int
    output_text_length: int
