from __future__ import annotations

import re
from dataclasses import dataclass


MODEL_NAME = "mock-1"
MAX_INPUT_CHARS = 8000
MAX_CONTEXT_CHARS = 4000


@dataclass
class Prompt:
    instruction: str
    text: str
    context: str | None = None

    def render(self) -> str:
        parts = [f"Instruction: {self.instruction}"]
        if self.context:
            parts.append(f"Document context:\n{self.context}")
        parts.append(f"Input:\n{self.text}")
        return "\n\n".join(parts)


def bound_text(text: str | None, limit: int) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit]


def build_prompt(
    *,
    instruction: str,
    text: str,
    context: str | None,
) -> Prompt:
    return Prompt(
        instruction=instruction,
        text=bound_text(text, MAX_INPUT_CHARS),
        context=bound_text(context, MAX_CONTEXT_CHARS) or None,
    )


class MockLLMProvider:
    model = MODEL_NAME

    def rewrite(self, prompt: Prompt) -> str:
        normalized = " ".join(prompt.text.split())
        if not normalized:
            return ""
        sentences = re.split(r"(?<=[.!?])\s+", normalized)
        polished = []
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            polished.append(sentence[0].upper() + sentence[1:])
        return " ".join(polished)

    def summarize(self, prompt: Prompt, max_sentences: int = 3) -> str:
        normalized = " ".join(prompt.text.split())
        if not normalized:
            return ""
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", normalized) if s.strip()]
        if sentences:
            return "\n\n".join(sentences[:max_sentences])
        words = normalized.split()
        return " ".join(words[: min(len(words), 40)])


provider = MockLLMProvider()
