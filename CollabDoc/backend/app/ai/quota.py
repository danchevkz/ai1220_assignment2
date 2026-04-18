from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from .schemas import QuotaStatus


class QuotaExceededError(Exception):
    pass


@dataclass(slots=True)
class QuotaService:
    default_limit: int = 100
    _usage_by_user: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def check(self, user_id: str) -> QuotaStatus:
        used = self._usage_by_user[user_id]
        remaining = max(self.default_limit - used, 0)
        return QuotaStatus(
            allowed=used < self.default_limit,
            limit=self.default_limit,
            used=used,
            remaining=remaining,
        )

    def consume(self, user_id: str, amount: int = 1) -> QuotaStatus:
        status = self.check(user_id)
        if not status.allowed or amount > status.remaining:
            raise QuotaExceededError(f"Quota exceeded for user '{user_id}'.")
        self._usage_by_user[user_id] += amount
        return self.check(user_id)
