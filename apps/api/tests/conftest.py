"""Pytest config — set test-only env before any test module imports."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
