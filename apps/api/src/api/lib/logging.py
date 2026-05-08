"""Structured JSON logging configured for stdout.

`setup_logging()` wires the root logger and the `uvicorn.*` loggers to a single
handler that emits one JSON object per record. A redaction filter masks values
of common credential headers and known sensitive query-string params before the
record reaches the formatter.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from typing import Any

from pythonjsonlogger.json import JsonFormatter

_SENSITIVE_KEYS: frozenset[str] = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "api-key",
        "x-auth-token",
    }
)

_QUERY_REDACT_RE = re.compile(
    r"([?&](?:key|token|api_key|access_token|password)=)[^&\s\"']+",
    re.IGNORECASE,
)

_REDACTED = "[REDACTED]"


class RedactingFilter(logging.Filter):
    """Mask credential-shaped fields in the record before formatting."""

    def filter(self, record: logging.LogRecord) -> bool:
        for key in list(record.__dict__):
            if key.lower() in _SENSITIVE_KEYS:
                record.__dict__[key] = _REDACTED

        if isinstance(record.msg, str):
            record.msg = _QUERY_REDACT_RE.sub(r"\1" + _REDACTED, record.msg)

        if record.args and isinstance(record.args, tuple):
            redacted_args: tuple[Any, ...] = tuple(
                _QUERY_REDACT_RE.sub(r"\1" + _REDACTED, a)
                if isinstance(a, str)
                else a
                for a in record.args
            )
            record.args = redacted_args

        return True


def make_json_handler() -> logging.Handler:
    """Return a stdout handler with JSON formatter and redaction attached."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={
                "asctime": "ts",
                "levelname": "level",
                "name": "logger",
                "message": "msg",
            },
        )
    )
    handler.addFilter(RedactingFilter())
    return handler


def setup_logging() -> None:
    """Replace handlers on the root and `uvicorn.*` loggers with a JSON handler."""
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = logging.getLevelNamesMapping().get(level_name, logging.INFO)

    handler = make_json_handler()
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = [handler]
        lg.propagate = False
        lg.setLevel(level)
