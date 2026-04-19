from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import ai, auth, documents
from app.core.config import settings
from app.websocket.collaboration import (
    collaboration_app,
    ensure_websocket_server_running,
    stop_websocket_server,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await ensure_websocket_server_running()
    try:
        yield
    finally:
        await stop_websocket_server()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(documents.router, prefix=settings.api_prefix)
app.include_router(ai.router, prefix=settings.api_prefix)
app.mount("/ws", collaboration_app)


@app.get("/health")
def health():
    return {"status": "ok"}
