from __future__ import annotations

from .schemas import RewriteRequest, SummarizeRequest


def build_rewrite_prompt(request: RewriteRequest) -> str:
    tone_clause = f"Tone: {request.tone}." if request.tone else "Tone: keep it natural and clear."
    meaning_clause = (
        "Preserve the original meaning and factual content."
        if request.preserve_meaning
        else "You may restructure aggressively if it improves readability."
    )
    instructions = request.instructions or "No extra instructions provided."
    return (
        "You are helping inside a collaborative document editor.\n"
        "Rewrite the text so it reads well in a shared workspace.\n"
        f"{tone_clause}\n"
        f"{meaning_clause}\n"
        f"User instructions: {instructions}\n"
        "Return only the rewritten text.\n\n"
        f"Text:\n{request.text}"
    )


def build_summary_prompt(request: SummarizeRequest) -> str:
    instructions = request.instructions or "Highlight only the most important ideas."
    return (
        "You are helping inside a collaborative document editor.\n"
        "Summarize the text for a teammate who needs a fast update.\n"
        f"Target length: {request.max_sentences} sentence(s).\n"
        f"Format: {request.format}.\n"
        f"User instructions: {instructions}\n"
        "Return only the summary.\n\n"
        f"Text:\n{request.text}"
    )
