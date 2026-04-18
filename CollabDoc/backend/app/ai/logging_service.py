from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .schemas import InteractionStatus, LoggedInteraction, WritingOperation


@dataclass(slots=True)
class InteractionLoggingService:
    _entries: list[LoggedInteraction] = field(default_factory=list)
    _entries_by_request_id: dict[str, LoggedInteraction] = field(default_factory=dict)

    def create_entry(
        self,
        *,
        request_id: str,
        operation: WritingOperation,
        user_id: str,
        document_id: str | None,
        input_text_length: int,
        metadata: dict[str, Any] | None = None,
    ) -> LoggedInteraction:
        entry = LoggedInteraction(
            request_id=request_id,
            operation=operation,
            user_id=user_id,
            document_id=document_id,
            input_text_length=input_text_length,
            output_text_length=0,
            status=InteractionStatus.PENDING,
            created_at=datetime.now(timezone.utc),
            metadata=metadata or {},
        )
        self._entries.append(entry)
        self._entries_by_request_id[request_id] = entry
        return entry

    def update_entry(
        self,
        *,
        request_id: str,
        status: InteractionStatus,
        output_text_length: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> LoggedInteraction:
        entry = self._entries_by_request_id[request_id]
        entry.status = status
        if output_text_length is not None:
            entry.output_text_length = output_text_length
        if metadata is not None:
            entry.metadata = {**entry.metadata, **metadata}
        return entry

    def list_entries(self) -> list[LoggedInteraction]:
        return list(self._entries)

    def list_history(self, *, document_id: str, user_id: str) -> list[LoggedInteraction]:
        return [
            entry
            for entry in self._entries
            if entry.document_id == document_id and entry.user_id == user_id
        ]
