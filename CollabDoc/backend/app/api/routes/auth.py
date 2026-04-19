from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.store import UserRecord, store
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterRequest, TokenResponse, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


def serialize_user(user: UserRecord) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        created_at=user.created_at.isoformat(),
    )


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    description=(
        "Creates a new user account with a bcrypt-hashed password. "
        "Username and email must both be unique across existing accounts; "
        "a duplicate returns 400. On success returns the public user profile."
    ),
)
def register(payload: RegisterRequest) -> UserRead:
    try:
        user = store.create_user(
            username=payload.username,
            email=payload.email,
            password_hash=hash_password(payload.password),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return serialize_user(user)


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Exchange credentials for a token pair",
    description=(
        "Verifies username/password and returns a short-lived access token "
        "(20 minutes) plus a refresh token (7 days). Returns 401 on any "
        "credential mismatch without distinguishing between unknown user and "
        "bad password."
    ),
)
def login(payload: LoginRequest) -> TokenResponse:
    user = store.find_user(payload.username)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Rotate tokens using a refresh token",
    description=(
        "Validates a refresh-type JWT and issues a brand-new access/refresh "
        "pair for the same user. Access tokens presented here are rejected "
        "(token type must be `refresh`). Returns 401 on expired, malformed, "
        "or wrong-type tokens."
    ),
)
def refresh(payload: RefreshRequest) -> TokenResponse:
    try:
        claims = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    if claims.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user = store.get_user(claims.get("sub", ""))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get(
    "/me",
    response_model=UserRead,
    summary="Return the authenticated user's profile",
    description=(
        "Resolves the bearer token to the owning user record. Used by the "
        "frontend on boot to hydrate auth state after a browser reload."
    ),
)
def me(current_user: UserRecord = Depends(get_current_user)) -> UserRead:
    return serialize_user(current_user)
