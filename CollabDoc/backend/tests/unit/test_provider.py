from __future__ import annotations

from app.services.ai.provider import MockLLMProvider


def provider() -> MockLLMProvider:
    return MockLLMProvider()


# ── rewrite ────────────────────────────────────────────────────────────────────

def test_rewrite_empty_returns_empty():
    assert provider().rewrite("") == ""


def test_rewrite_whitespace_only_returns_empty():
    assert provider().rewrite("   ") == ""


def test_rewrite_capitalizes_first_letter_of_sentence():
    result = provider().rewrite("hello world.")
    assert result[0].isupper()


def test_rewrite_normalizes_extra_whitespace():
    result = provider().rewrite("hello   world.")
    assert "  " not in result


def test_rewrite_preserves_multiple_sentences():
    text = "first sentence. second sentence."
    result = provider().rewrite(text)
    assert "First sentence." in result
    assert "Second sentence." in result


def test_rewrite_single_word():
    result = provider().rewrite("hello")
    assert result == "Hello"


# ── summarize ─────────────────────────────────────────────────────────────────

def test_summarize_empty_returns_empty():
    assert provider().summarize("") == ""


def test_summarize_whitespace_only_returns_empty():
    assert provider().summarize("   ") == ""


def test_summarize_single_sentence():
    result = provider().summarize("This is one sentence.")
    assert "This is one sentence." in result


def test_summarize_respects_max_sentences():
    text = "Sentence one. Sentence two. Sentence three. Sentence four."
    result = provider().summarize(text, max_sentences=2)
    parts = [p for p in result.split("\n\n") if p.strip()]
    assert len(parts) == 2


def test_summarize_default_max_is_three():
    text = "A. B. C. D. E."
    result = provider().summarize(text)
    parts = [p for p in result.split("\n\n") if p.strip()]
    assert len(parts) <= 3


def test_summarize_no_sentence_boundary_falls_back_to_words():
    text = "no sentence boundaries here at all whatsoever"
    result = provider().summarize(text)
    assert len(result) > 0
    assert result == text


def test_summarize_max_sentences_larger_than_available():
    text = "Just one sentence."
    result = provider().summarize(text, max_sentences=10)
    assert "Just one sentence." in result
