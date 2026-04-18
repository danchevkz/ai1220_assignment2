from __future__ import annotations

import json
from collections.abc import Iterable, Iterator

from .schemas import StreamChunk


def sse_event(data: dict) -> bytes:
    return f"data: {json.dumps(data)}\n\n".encode("utf-8")


def stream_chunks(chunks: Iterable[StreamChunk]) -> Iterator[bytes]:
    for chunk in chunks:
        yield sse_event(chunk.model_dump())
