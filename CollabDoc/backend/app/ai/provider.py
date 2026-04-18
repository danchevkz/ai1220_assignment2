from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Protocol


class AIProvider(Protocol):
    model_name: str

    def generate(self, prompt: str) -> str:
        ...

    def stream_generate(self, prompt: str) -> Iterator[str]:
        ...


@dataclass(slots=True)
class EchoAIProvider:
    model_name: str = "mock-writing-model"

    def generate(self, prompt: str) -> str:
        return _extract_text_section(prompt)

    def stream_generate(self, prompt: str) -> Iterator[str]:
        output = self.generate(prompt)
        words = output.split()
        for index, word in enumerate(words):
            suffix = "" if index == len(words) - 1 else " "
            yield word + suffix


def _extract_text_section(prompt: str) -> str:
    marker = "Text:\n"
    if marker not in prompt:
        return prompt
    return prompt.split(marker, maxsplit=1)[1].strip()
