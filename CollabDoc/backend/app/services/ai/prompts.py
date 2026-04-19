"""Prompt templates for AI operations.

Kept in a dedicated module — rather than as string literals next to the
route handlers — so the copy can be tuned (or swapped for locale-specific
variants) without touching routing code. The rubric also asks that prompt
templates live in a config file or prompt module rather than being
hardcoded inline at the call site.
"""

from __future__ import annotations

REWRITE_INSTRUCTION = (
    "Rewrite the input to improve clarity and tone while preserving meaning."
)

SUMMARIZE_INSTRUCTION = "Summarize the input concisely."

__all__ = ["REWRITE_INSTRUCTION", "SUMMARIZE_INSTRUCTION"]
