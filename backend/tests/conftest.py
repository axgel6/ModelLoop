import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server
from server import app, session_histories
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    # Create an async test client for the FastAPI app.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def reset_server_state():
    # Reset global server state before each test to prevent module-level globals from bleeding.
    session_histories.clear()
    server.cached_models.clear()
    yield
    session_histories.clear()
    server.cached_models.clear()