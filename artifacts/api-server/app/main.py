"""FastAPI entry point for the Purple Team backend."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import crowdstrike, exports, state
from .storage import load_version_store, start_database, stop_database

logger = logging.getLogger(__name__)


async def auto_sync_loop() -> None:
    while True:
        await crowdstrike.maybe_auto_sync()
        await asyncio.sleep(6 * 60 * 60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await start_database()
    await crowdstrike.init_stored_credentials()
    await load_version_store()
    await crowdstrike.maybe_auto_sync()
    task = asyncio.create_task(auto_sync_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await stop_database()


app = FastAPI(title="Purple Team API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error", exc_info=exc)
    return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)


@app.middleware("http")
async def request_limits(request: Request, call_next):
    is_state_request = request.url.path == "/api/state" or request.url.path.startswith("/api/state/")
    limit = 20 * 1024 * 1024 if is_state_request else 2 * 1024 * 1024
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > limit:
                return JSONResponse({"error": "Request body is too large."}, status_code=413)
        except ValueError:
            return JSONResponse({"error": "Invalid Content-Length header."}, status_code=400)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if len(await request.body()) > limit:
            return JSONResponse({"error": "Request body is too large."}, status_code=413)
    return await call_next(request)


@app.get("/api/healthz")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(crowdstrike.router, prefix="/api")
app.include_router(exports.router, prefix="/api")
app.include_router(state.router, prefix="/api")
