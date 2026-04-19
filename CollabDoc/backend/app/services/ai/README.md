# `app/services/ai/`

LLM provider abstraction consumed by `app/api/routes/ai.py`.

`provider.py` ships a deterministic `MockLLMProvider` (capitalises sentence
starts for rewrite; takes the first N sentences for summarize) so the full
AI flow — streaming, cancel, per-paragraph partial acceptance, history — can
be demoed and tested offline without an external API key.

Swapping in a real LLM is a single-file change: implement `rewrite(text) ->
str` and `summarize(text, max_sentences) -> str` on a new class and replace
the module-level `provider = MockLLMProvider()` binding. The router never
touches SDK specifics.
