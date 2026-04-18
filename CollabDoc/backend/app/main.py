from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import ai, auth, documents
from app.core.config import settings
from app.websocket.collaboration import (
    collaboration_app,
    ensure_websocket_server_running,
    stop_websocket_server,
)


app = FastAPI(title=settings.app_name, version="0.1.0")

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


@app.on_event("startup")
async def startup() -> None:
    await ensure_websocket_server_running()


@app.on_event("shutdown")
async def shutdown() -> None:
    await stop_websocket_server()


@app.get("/health")
def health():
    return {"status": "ok"}
