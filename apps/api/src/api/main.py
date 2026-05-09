import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import markets, orders
from api.routes.intelligence import router as intelligence_router
from api.routes.markets import balance_router
from api.routes.prepare import router as prepare_router

load_dotenv()

app = FastAPI(
    title="Prediction Market Agent API",
    version="1.0.0",
    description=(
        "Agent-agnostic REST API for the Czech prediction-market dApp.  "
        "Free endpoints: market reads and calldata builders.  "
        "Paywalled endpoints (Phase 2): intelligence tools behind x402."
    ),
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
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

app.include_router(markets.router)
app.include_router(balance_router)
app.include_router(orders.router)
app.include_router(prepare_router)
app.include_router(intelligence_router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
