from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from jose import jwt

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    create_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_password_returns_non_plaintext():
    hashed = hash_password("secret")
    assert hashed != "secret"
    assert len(hashed) > 20


def test_verify_password_correct():
    hashed = hash_password("my-password")
    assert verify_password("my-password", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("my-password")
    assert verify_password("wrong-password", hashed) is False


def test_create_access_token_claims():
    token = create_access_token("user-123")
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"
    assert "iat" in payload
    assert "exp" in payload


def test_create_refresh_token_claims():
    token = create_refresh_token("user-456")
    payload = decode_token(token)
    assert payload["sub"] == "user-456"
    assert payload["type"] == "refresh"


def test_access_and_refresh_tokens_differ():
    access = create_access_token("u")
    refresh = create_refresh_token("u")
    assert access != refresh
    assert decode_token(access)["type"] != decode_token(refresh)["type"]


def test_access_token_expiry_within_bounds():
    before = int(datetime.now(UTC).timestamp())
    token = create_access_token("u")
    after = int(datetime.now(UTC).timestamp())
    payload = decode_token(token)
    expected_max_exp = after + settings.access_token_expire_minutes * 60
    assert payload["exp"] >= before + settings.access_token_expire_minutes * 60 - 5
    assert payload["exp"] <= expected_max_exp + 5


def test_decode_token_invalid_raises():
    with pytest.raises(ValueError, match="Invalid or expired token"):
        decode_token("this.is.garbage")


def test_decode_token_tampered_raises():
    token = create_access_token("u")
    tampered = token[:-4] + "XXXX"
    with pytest.raises(ValueError):
        decode_token(tampered)


def test_decode_token_expired_raises():
    token = create_token("u", "access", timedelta(seconds=-1))
    with pytest.raises(ValueError, match="Invalid or expired token"):
        decode_token(token)
