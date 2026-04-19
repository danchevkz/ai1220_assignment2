from __future__ import annotations

from app.services.ai.provider import (
    MAX_CONTEXT_CHARS,
    MAX_INPUT_CHARS,
    MODEL_NAME,
    MockLLMProvider,
    Prompt,
    build_prompt,
)


def provider() -> MockLLMProvider:
    return MockLLMProvider()


def _prompt(text: str) -> Prompt:
    return build_prompt(instruction="test", text=text, context=None)


# ── Prompt / build_prompt ─────────────────────────────────────────────────────

def test_build_prompt_bounds_input_text():
    long = "a" * (MAX_INPUT_CHARS + 500)
    p = build_prompt(instruction="rewrite", text=long, context=None)
    assert len(p.text) == MAX_INPUT_CHARS


def test_build_prompt_bounds_context():
    long_ctx = "c" * (MAX_CONTEXT_CHARS + 500)
    p = build_prompt(instruction="rewrite", text="hello", context=long_ctx)
    assert p.context is not None
    assert len(p.context) == MAX_CONTEXT_CHARS


def test_build_prompt_none_context_stays_none():
    p = build_prompt(instruction="rewrite", text="hello", context=None)
    assert p.context is None


def test_build_prompt_empty_context_stays_none():
    p = build_prompt(instruction="rewrite", text="hello", context="")
    assert p.context is None


def test_prompt_render_includes_instruction_and_input():
    p = build_prompt(instruction="Rewrite", text="hello world", context=None)
    rendered = p.render()
    assert "Instruction: Rewrite" in rendered
    assert "hello world" in rendered


def test_prompt_render_includes_context_when_present():
    p = build_prompt(instruction="Rewrite", text="hello", context="the doc")
    rendered = p.render()
    assert "Document context" in rendered
    assert "the doc" in rendered


def test_prompt_render_omits_context_when_absent():
    p = build_prompt(instruction="Rewrite", text="hello", context=None)
    rendered = p.render()
    assert "Document context" not in rendered


def test_provider_exposes_model_name():
    assert provider().model == MODEL_NAME


# ── rewrite ────────────────────────────────────────────────────────────────────

def test_rewrite_empty_returns_empty():
    assert provider().rewrite(_prompt("")) == ""


def test_rewrite_whitespace_only_returns_empty():
    assert provider().rewrite(_prompt("   ")) == ""


def test_rewrite_capitalizes_first_letter_of_sentence():
    result = provider().rewrite(_prompt("hello world."))
    assert result[0].isupper()


def test_rewrite_normalizes_extra_whitespace():
    result = provider().rewrite(_prompt("hello   world."))
    assert "  " not in result


def test_rewrite_preserves_multiple_sentences():
    text = "first sentence. second sentence."
    result = provider().rewrite(_prompt(text))
    assert "First sentence." in result
    assert "Second sentence." in result


def test_rewrite_single_word():
    result = provider().rewrite(_prompt("hello"))
    assert result == "Hello"


# ── summarize ─────────────────────────────────────────────────────────────────

def test_summarize_empty_returns_empty():
    assert provider().summarize(_prompt("")) == ""


def test_summarize_whitespace_only_returns_empty():
    assert provider().summarize(_prompt("   ")) == ""


def test_summarize_single_sentence():
    result = provider().summarize(_prompt("This is one sentence."))
    assert "This is one sentence." in result


def test_summarize_respects_max_sentences():
    text = "Sentence one. Sentence two. Sentence three. Sentence four."
    result = provider().summarize(_prompt(text), max_sentences=2)
    parts = [p for p in result.split("\n\n") if p.strip()]
    assert len(parts) == 2


def test_summarize_default_max_is_three():
    text = "A. B. C. D. E."
    result = provider().summarize(_prompt(text))
    parts = [p for p in result.split("\n\n") if p.strip()]
    assert len(parts) <= 3


def test_summarize_no_sentence_boundary_falls_back_to_words():
    text = "no sentence boundaries here at all whatsoever"
    result = provider().summarize(_prompt(text))
    assert len(result) > 0
    assert result == text


def test_summarize_max_sentences_larger_than_available():
    text = "Just one sentence."
    result = provider().summarize(_prompt(text), max_sentences=10)
    assert "Just one sentence." in result
