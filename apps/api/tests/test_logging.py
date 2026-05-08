"""Tests for `api.lib.logging`."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from io import StringIO

import pytest

from api.lib.logging import RedactingFilter, make_json_handler


@pytest.fixture
def isolated_logger() -> Iterator[tuple[logging.Logger, StringIO]]:
    """Logger with a string-stream JSON handler. Restored after the test."""
    handler = make_json_handler()
    stream = StringIO()
    handler.stream = stream  # type: ignore[attr-defined]

    logger = logging.getLogger("api.tests.logging")
    saved_handlers = logger.handlers
    saved_propagate = logger.propagate
    saved_level = logger.level

    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)

    yield logger, stream

    logger.handlers = saved_handlers
    logger.propagate = saved_propagate
    logger.setLevel(saved_level)


def test_emits_valid_json_with_renamed_fields(
    isolated_logger: tuple[logging.Logger, StringIO],
) -> None:
    logger, stream = isolated_logger
    logger.info("hello world", extra={"market_id": "0xabc"})

    payload = json.loads(stream.getvalue().strip())
    assert payload["msg"] == "hello world"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "api.tests.logging"
    assert payload["market_id"] == "0xabc"
    assert "ts" in payload


def test_authorization_extra_is_redacted(
    isolated_logger: tuple[logging.Logger, StringIO],
) -> None:
    logger, stream = isolated_logger
    logger.info("incoming request", extra={"authorization": "Bearer secret-xyz"})

    payload = json.loads(stream.getvalue().strip())
    assert payload["authorization"] == "[REDACTED]"


def test_query_string_token_is_redacted_in_message() -> None:
    record = logging.LogRecord(
        name="api.tests.logging",
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg="GET /chat?token=supersecret HTTP/1.1",
        args=None,
        exc_info=None,
    )
    assert RedactingFilter().filter(record) is True
    assert "supersecret" not in record.getMessage()
    assert "token=[REDACTED]" in record.getMessage()


def test_query_string_token_is_redacted_in_args() -> None:
    record = logging.LogRecord(
        name="api.tests.logging",
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg='%s "%s" %d',
        args=("127.0.0.1", "GET /chat?token=supersecret HTTP/1.1", 200),
        exc_info=None,
    )
    assert RedactingFilter().filter(record) is True
    assert "supersecret" not in record.getMessage()
    assert "token=[REDACTED]" in record.getMessage()
