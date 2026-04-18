from __future__ import annotations

import re


class MockLLMProvider:
    def rewrite(self, text: str) -> str:
        normalized = " ".join(text.split())
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

    def summarize(self, text: str, max_sentences: int = 3) -> str:
        normalized = " ".join(text.split())
        if not normalized:
            return ""
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", normalized) if s.strip()]
        if sentences:
            return "\n\n".join(sentences[:max_sentences])
        words = normalized.split()
        return " ".join(words[: min(len(words), 40)])


provider = MockLLMProvider()
