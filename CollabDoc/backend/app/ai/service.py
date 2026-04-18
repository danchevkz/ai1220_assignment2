from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from uuid import uuid4

from .logging_service import InteractionLoggingService
from .prompts import build_rewrite_prompt, build_summary_prompt
from .provider import AIProvider
from .quota import QuotaService
from .schemas import AIResult, InteractionStatus, RewriteRequest, StreamChunk, SummarizeRequest, WritingOperation


@dataclass(slots=True)
class GenerationRegistry:
    _states: dict[str, bool] = field(default_factory=dict)

    def register(self, request_id: str) -> None:
        self._states[request_id] = False

    def cancel(self, request_id: str) -> bool:
        if request_id not in self._states:
            return False
        self._states[request_id] = True
        return True

    def is_cancelled(self, request_id: str) -> bool:
        return self._states.get(request_id, False)

    def unregister(self, request_id: str) -> None:
        self._states.pop(request_id, None)


@dataclass(slots=True)
class AIWritingService:
    provider: AIProvider
    quota_service: QuotaService
    logging_service: InteractionLoggingService
    generation_registry: GenerationRegistry

    def rewrite(self, request: RewriteRequest) -> AIResult:
        return self._run_generation(
            operation=WritingOperation.REWRITE,
            prompt=build_rewrite_prompt(request),
            source_text=request.text,
            user_id=request.context.user_id,
            document_id=request.context.document_id,
            metadata=request.context.metadata,
        )

    def summarize(self, request: SummarizeRequest) -> AIResult:
        return self._run_generation(
            operation=WritingOperation.SUMMARIZE,
            prompt=build_summary_prompt(request),
            source_text=request.text,
            user_id=request.context.user_id,
            document_id=request.context.document_id,
            metadata=request.context.metadata,
        )

    def stream_rewrite(self, request: RewriteRequest, *, request_id: str) -> Iterator[StreamChunk]:
        yield from self._stream_generation(
            request_id=request_id,
            operation=WritingOperation.REWRITE,
            prompt=build_rewrite_prompt(request),
            source_text=request.text,
            user_id=request.context.user_id,
            document_id=request.context.document_id,
            metadata=request.context.metadata,
        )

    def stream_summary(self, request: SummarizeRequest, *, request_id: str) -> Iterator[StreamChunk]:
        yield from self._stream_generation(
            request_id=request_id,
            operation=WritingOperation.SUMMARIZE,
            prompt=build_summary_prompt(request),
            source_text=request.text,
            user_id=request.context.user_id,
            document_id=request.context.document_id,
            metadata=request.context.metadata,
        )

    def create_generation_id(self) -> str:
        return str(uuid4())

    def cancel_generation(self, request_id: str) -> bool:
        cancelled = self.generation_registry.cancel(request_id)
        if cancelled:
            try:
                self.logging_service.update_entry(
                    request_id=request_id,
                    status=InteractionStatus.CANCELLED,
                    metadata={"cancelled": True},
                )
            except KeyError:
                pass
        return cancelled

    def _run_generation(
        self,
        *,
        operation: WritingOperation,
        prompt: str,
        source_text: str,
        user_id: str,
        document_id: str | None,
        metadata: dict,
    ) -> AIResult:
        request_id = str(uuid4())
        quota_status = self.quota_service.consume(user_id)
        self.logging_service.create_entry(
            request_id=request_id,
            operation=operation,
            user_id=user_id,
            document_id=document_id,
            input_text_length=len(source_text),
            metadata=metadata,
        )
        try:
            output_text = self.provider.generate(prompt)
        except Exception:
            self.logging_service.update_entry(
                request_id=request_id,
                status=InteractionStatus.FAILED,
            )
            raise

        self.logging_service.update_entry(
            request_id=request_id,
            status=InteractionStatus.COMPLETED,
            output_text_length=len(output_text),
            metadata=metadata,
        )
        return AIResult(
            operation=operation,
            output_text=output_text,
            model=self.provider.model_name,
            quota_remaining=quota_status.remaining,
            request_id=request_id,
        )

    def _stream_generation(
        self,
        *,
        request_id: str,
        operation: WritingOperation,
        prompt: str,
        source_text: str,
        user_id: str,
        document_id: str | None,
        metadata: dict,
    ) -> Iterator[StreamChunk]:
        quota_status = self.quota_service.consume(user_id)
        stream_metadata = {**metadata, "quota_remaining": quota_status.remaining}
        self.generation_registry.register(request_id)
        try:
            self.logging_service.create_entry(
                request_id=request_id,
                operation=operation,
                user_id=user_id,
                document_id=document_id,
                input_text_length=len(source_text),
                metadata=stream_metadata,
            )
            chunks: list[str] = []
            try:
                for delta in self.provider.stream_generate(prompt):
                    if self.generation_registry.is_cancelled(request_id):
                        self.logging_service.update_entry(
                            request_id=request_id,
                            status=InteractionStatus.CANCELLED,
                            output_text_length=len("".join(chunks)),
                            metadata={**stream_metadata, "cancelled": True},
                        )
                        return
                    chunks.append(delta)
                    if self.generation_registry.is_cancelled(request_id):
                        self.logging_service.update_entry(
                            request_id=request_id,
                            status=InteractionStatus.CANCELLED,
                            output_text_length=len("".join(chunks)),
                            metadata={**stream_metadata, "cancelled": True},
                        )
                        return
                    yield StreamChunk(request_id=request_id, operation=operation, delta=delta, done=False)
            except GeneratorExit:
                self.logging_service.update_entry(
                    request_id=request_id,
                    status=InteractionStatus.CANCELLED,
                    output_text_length=len("".join(chunks)),
                    metadata={**stream_metadata, "cancelled": True},
                )
                raise
            except Exception:
                self.logging_service.update_entry(
                    request_id=request_id,
                    status=InteractionStatus.FAILED,
                    output_text_length=len("".join(chunks)),
                    metadata=stream_metadata,
                )
                raise

            output_text = "".join(chunks)
            if self.generation_registry.is_cancelled(request_id):
                self.logging_service.update_entry(
                    request_id=request_id,
                    status=InteractionStatus.CANCELLED,
                    output_text_length=len(output_text),
                    metadata={**stream_metadata, "cancelled": True},
                )
                return

            self.logging_service.update_entry(
                request_id=request_id,
                status=InteractionStatus.COMPLETED,
                output_text_length=len(output_text),
                metadata=stream_metadata,
            )
            yield StreamChunk(request_id=request_id, operation=operation, delta="", done=True)
        finally:
            self.generation_registry.unregister(request_id)
