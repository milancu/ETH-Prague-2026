import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from api.lib.x402_mcp import mcp_x402_middleware
from api.lib.x402_server import get_middleware, is_paywall_enabled
from api.mcp.server import mcp as mcp_server
from api.routes import comments, markets, orders
from api.routes.chat import limiter
from api.routes.chat import router as chat_router
from api.routes.dice import router as dice_router
from api.routes.ens_discovery import router as ens_discovery_router
from api.routes.ens_gateway import router as ens_gateway_router
from api.routes.intelligence import router as intelligence_router
from api.routes.markets import balance_router
from api.routes.prepare import router as prepare_router

load_dotenv()

# Build the FastMCP ASGI sub-app once so session_manager is created before
# the lifespan runs.
_mcp_sub_app = mcp_server.streamable_http_app()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    from api.indexer.ens_bridge import ENSBridge, is_bridge_enabled

    ens_task = None
    if is_bridge_enabled():
        bridge = ENSBridge()
        ens_task = asyncio.create_task(bridge.run())

    async with mcp_server.session_manager.run():
        yield

    if ens_task is not None:
        ens_task.cancel()


app = FastAPI(
    title="Prediction Market Agent API",
    version="1.0.0",
    description=(
        "Agent-agnostic REST API for the Czech prediction-market dApp.  "
        "Free endpoints: market reads and calldata builders.  "
        "Paywalled endpoints (paywall:x402): intelligence tools — "
        "pay $0.50–$0.75 USDC on Base mainnet per call."
    ),
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173")
_ALLOWED_ORIGINS = [o.strip() for o in _cors_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def mcp_trailing_slash(request: Request, call_next: object) -> Response:
    """Rewrite /mcp → /mcp/ so MCP clients that omit the slash connect."""
    from collections.abc import Awaitable, Callable

    _call_next: Callable[[Request], Awaitable[Response]] = call_next  # type: ignore[assignment]
    if request.url.path == "/mcp":
        request.scope["path"] = "/mcp/"
    return await _call_next(request)


@app.middleware("http")
async def x402_paywall(
    request: Request,
    call_next: object,
) -> Response:
    """x402 inbound paywall for /v1/intelligence/* routes.

    Skipped entirely if X402_IN_WALLET_ADDRESS is not set so the app starts
    cleanly in dev without a funded wallet configured.
    """
    from collections.abc import Awaitable, Callable

    _call_next: Callable[[Request], Awaitable[Response]] = call_next  # type: ignore[assignment]
    if not is_paywall_enabled():
        return await _call_next(request)
    return await get_middleware()(request, _call_next)


@app.middleware("http")
async def x402_mcp_paywall(
    request: Request,
    call_next: object,
) -> Response:
    """x402 inbound paywall for paywalled MCP tool calls on POST /mcp.

    Peeks at the JSON-RPC body to identify the tool name, then enforces the
    same x402 challenge/verify/settle flow as the REST paywall.  Skipped if
    X402_IN_WALLET_ADDRESS is not set.
    """
    from collections.abc import Awaitable, Callable

    _call_next: Callable[[Request], Awaitable[Response]] = call_next  # type: ignore[assignment]
    return await mcp_x402_middleware(request, _call_next)


app.include_router(markets.router)
app.include_router(balance_router)
app.include_router(orders.router)
app.include_router(comments.router)
app.include_router(prepare_router)
app.include_router(dice_router)
app.include_router(intelligence_router)
app.include_router(chat_router)
app.include_router(ens_gateway_router)
app.include_router(ens_discovery_router)

# Mount FastMCP at /mcp — streamable HTTP transport (modern MCP standard).
# Clients connect to http://<host>/mcp or /mcp/.
app.mount("/mcp", _mcp_sub_app)


@app.get("/v1/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Serve integration docs + SKILL.md at /v1/integrations/*
# ---------------------------------------------------------------------------

_INTEGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "integrations")


@app.get("/v1/integrations", tags=["meta"])
def list_integrations() -> dict[str, list[str]]:
    """List available integration guides."""
    norm = os.path.normpath(_INTEGRATIONS_DIR)
    if not os.path.isdir(norm):
        return {"guides": []}
    files = sorted(f for f in os.listdir(norm) if f.endswith(".md"))
    return {"guides": files}


@app.get("/v1/integrations/{filename}", tags=["meta"])
def get_integration(filename: str) -> Response:
    """Serve an integration guide as plain Markdown."""
    from fastapi import HTTPException

    if not filename.endswith(".md"):
        raise HTTPException(404, "not found")
    safe = os.path.basename(filename)
    path = os.path.normpath(os.path.join(_INTEGRATIONS_DIR, safe))
    if not os.path.isfile(path):
        raise HTTPException(404, f"{safe} not found")
    with open(path) as f:
        content = f.read()
    return Response(content=content, media_type="text/markdown; charset=utf-8")
