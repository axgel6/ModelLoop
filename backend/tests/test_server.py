import json
import pytest
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server
from server import app, session_histories


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_sse_lines(tokens: list[str]) -> list[str]:
    # Build JSON strings mimicking Ollama SSE response: tokens map to content, ending with done=True.
    lines = []
    for token in tokens:
        lines.append(json.dumps({"message": {"content": token}}))
    lines.append(json.dumps({"message": {"content": ""}, "done": True}))
    return lines


def make_mock_stream(tokens: list[str]):
    # Return async context manager yielding SSE lines via aiter_lines() to mimic httpx AsyncClient.stream().
    lines = make_sse_lines(tokens)

    async def aiter_lines():
        for line in lines:
            yield line

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_lines = aiter_lines

    # Async context manager for `async with client.stream(...) as resp`
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_resp)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def make_mock_async_client(stream_cm=None, get_json=None):
    # Return async context manager wrapping mock httpx.AsyncClient, accepting stream_cm or get_json mocks.
    mock_client = MagicMock()

    if stream_cm is not None:
        mock_client.stream = MagicMock(return_value=stream_cm)

    if get_json is not None:
        mock_get_resp = MagicMock()
        mock_get_resp.raise_for_status = MagicMock()
        mock_get_resp.json = MagicMock(return_value=get_json)
        mock_client.get = AsyncMock(return_value=mock_get_resp)

    outer_cm = MagicMock()
    outer_cm.__aenter__ = AsyncMock(return_value=mock_client)
    outer_cm.__aexit__ = AsyncMock(return_value=False)
    return outer_cm


def collect_sse(content: bytes) -> list[dict]:
    # Parse raw SSE response bytes and return all data payloads as dicts.
    events = []
    for raw_line in content.decode("utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return events


# ---------------------------------------------------------------------------
# /api/history  (GET / DELETE)
# ---------------------------------------------------------------------------

@pytest.mark.anyio
class TestHistoryEndpoints:
    # Tests for /api/history endpoints.

    async def test_get_history_empty(self, client):
        # GET /api/history returns empty history for a new session.
        response = await client.get("/api/history")
        assert response.status_code == 200
        assert response.json() == {"history": []}

    async def test_clear_history(self, client):
        # DELETE /api/history clears session history.
        response = await client.delete("/api/history")
        assert response.status_code == 200
        assert response.json() == {"message": "History cleared"}

    async def test_clear_history_actually_empties_store(self, client):
        # DELETE /api/history removes messages previously stored in the session.
        # Step 1: make a GET so the server issues a session cookie
        get_resp = await client.get("/api/history")
        session_id = get_resp.cookies.get("session_id")

        # Step 2: inject a history entry directly into the store
        if session_id:
            session_histories[session_id] = [{"role": "user", "content": "hi"}]

        # Step 3: clear via the API
        await client.delete("/api/history")

        # Step 4: confirm history is now empty
        check = await client.get("/api/history")
        assert check.json()["history"] == []


# ---------------------------------------------------------------------------
# /api/chat/stream  (POST) — validation
# ---------------------------------------------------------------------------

@pytest.mark.anyio
class TestChatStreamValidation:
    # Input-validation tests — server rejects bad input before streaming.

    async def test_empty_prompt_rejected(self, client):
        response = await client.post("/api/chat/stream", json={"prompt": ""})
        assert response.status_code == 422  # Pydantic min_length=1 validation

    async def test_prompt_too_long_rejected(self, client):
        response = await client.post("/api/chat/stream", json={"prompt": "a" * 10_001})
        assert response.status_code == 400
        assert "exceeds maximum length" in response.json()["detail"]


# ---------------------------------------------------------------------------
# /api/chat/stream  (POST) — streaming behavior
# ---------------------------------------------------------------------------

@pytest.mark.anyio
class TestChatStreamBehaviour:
    # Streaming-behavior tests for /api/chat/stream.

    async def test_stream_emits_token_events(self, client):
        # Each Ollama token is forwarded as a 'token' SSE event.
        stream_cm = make_mock_stream(["Hello", ", ", "world!"])
        with patch("server.httpx.AsyncClient", return_value=make_mock_async_client(stream_cm=stream_cm)):
            response = await client.post("/api/chat/stream", json={"prompt": "Hi"})

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        events = collect_sse(response.content)
        token_events = [e for e in events if e.get("type") == "token"]
        assert [e["token"] for e in token_events] == ["Hello", ", ", "world!"]

    async def test_stream_emits_done_event(self, client):
        # A 'done' SSE event is emitted after all tokens are streamed.
        stream_cm = make_mock_stream(["Hi"])
        with patch("server.httpx.AsyncClient", return_value=make_mock_async_client(stream_cm=stream_cm)):
            response = await client.post("/api/chat/stream", json={"prompt": "Hello"})

        events = collect_sse(response.content)
        done_events = [e for e in events if e.get("type") == "done"]
        assert len(done_events) == 1

    async def test_done_event_contains_history(self, client):
        # The 'done' event carries the updated conversation history.
        stream_cm = make_mock_stream(["Sure thing!"])
        with patch("server.httpx.AsyncClient", return_value=make_mock_async_client(stream_cm=stream_cm)):
            response = await client.post("/api/chat/stream", json={"prompt": "Can you help?"})

        events = collect_sse(response.content)
        done = next(e for e in events if e.get("type") == "done")
        history = done["history"]

        assert history[-2] == {"role": "user", "content": "Can you help?"}
        assert history[-1]["role"] == "assistant"
        assert "Sure thing!" in history[-1]["content"]

    async def test_session_cookie_set_on_first_request(self, client):
        # A session_id cookie is issued on the first streaming request.
        stream_cm = make_mock_stream(["Hi"])
        with patch("server.httpx.AsyncClient", return_value=make_mock_async_client(stream_cm=stream_cm)):
            response = await client.post("/api/chat/stream", json={"prompt": "Hello"})

        assert "session_id" in response.cookies

    async def test_history_persists_across_requests(self, client):
        # Conversation history grows correctly over multiple turns.
        stream_cm1 = make_mock_stream(["Response 1"])
        with patch("server.httpx.AsyncClient", return_value=make_mock_async_client(stream_cm=stream_cm1)):
            await client.post("/api/chat/stream", json={"prompt": "Message 1"})

        # httpx AsyncClient test fixture automatically carries cookies between requests
        stream_cm2 = make_mock_stream(["Response 2"])
        with patch("server.httpx.AsyncClient", return_value=make_mock_async_client(stream_cm=stream_cm2)):
            response = await client.post("/api/chat/stream", json={"prompt": "Message 2"})

        events = collect_sse(response.content)
        done = next(e for e in events if e.get("type") == "done")
        # user1, assistant1, user2, assistant2
        assert len(done["history"]) == 4

    async def test_custom_model_forwarded_to_ollama(self, client):
        # The model field in the request body is forwarded to Ollama.
        stream_cm = make_mock_stream(["ok"])
        mock_client_cm = make_mock_async_client(stream_cm=stream_cm)

        with patch("server.httpx.AsyncClient", return_value=mock_client_cm):
            await client.post("/api/chat/stream", json={"prompt": "Hello", "model": "llama3:latest"})

        # Extract the json kwarg passed to .stream()
        mock_client = mock_client_cm.__aenter__.return_value
        call_kwargs = mock_client.stream.call_args[1]
        assert call_kwargs["json"]["model"] == "llama3:latest"

    async def test_custom_system_prompt_forwarded(self, client):
        # A custom system_prompt in the request is used as the system message.
        stream_cm = make_mock_stream(["ok"])
        mock_client_cm = make_mock_async_client(stream_cm=stream_cm)
        custom = "You are a pirate."

        with patch("server.httpx.AsyncClient", return_value=mock_client_cm):
            await client.post("/api/chat/stream", json={"prompt": "Hello", "system_prompt": custom})

        mock_client = mock_client_cm.__aenter__.return_value
        messages_sent = mock_client.stream.call_args[1]["json"]["messages"]
        assert messages_sent[0] == {"role": "system", "content": custom}

    async def test_ollama_connection_error_emits_error_event(self, client):
        # An Ollama connection failure produces an 'error' SSE event.
        # Make the outer AsyncClient context manager raise on __aenter__
        bad_cm = MagicMock()
        bad_cm.__aenter__ = AsyncMock(side_effect=Exception("Connection refused"))
        bad_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("server.httpx.AsyncClient", return_value=bad_cm):
            response = await client.post("/api/chat/stream", json={"prompt": "Hello"})

        events = collect_sse(response.content)
        error_events = [e for e in events if e.get("type") == "error"]
        assert len(error_events) == 1
        assert "Connection refused" in error_events[0]["error"]

    async def test_failed_stream_not_persisted_to_history(self, client):
        # A failed generation does not corrupt the session history.
        bad_cm = MagicMock()
        bad_cm.__aenter__ = AsyncMock(side_effect=Exception("timeout"))
        bad_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("server.httpx.AsyncClient", return_value=bad_cm):
            await client.post("/api/chat/stream", json={"prompt": "Hello"})

        history_resp = await client.get("/api/history")
        assert history_resp.json()["history"] == []


# ---------------------------------------------------------------------------
# /api/models  (GET)
# ---------------------------------------------------------------------------

@pytest.mark.anyio
class TestModelsEndpoint:
    # Tests for /api/models endpoint.

    async def test_get_models_success(self, client):
        # GET /api/models returns available model names.
        mock_cm = make_mock_async_client(get_json={
            "models": [{"name": "llama3:latest"}, {"name": "deepseek:latest"}]
        })
        with patch("server.httpx.AsyncClient", return_value=mock_cm):
            response = await client.get("/api/models")

        assert response.status_code == 200
        assert "llama3:latest" in response.json()["models"]
        assert "deepseek:latest" in response.json()["models"]

    async def test_get_models_empty(self, client):
        # GET /api/models handles an empty model list gracefully.
        mock_cm = make_mock_async_client(get_json={"models": []})
        with patch("server.httpx.AsyncClient", return_value=mock_cm):
            response = await client.get("/api/models")

        assert response.status_code == 200
        assert response.json()["models"] == []

    async def test_get_models_ollama_error_returns_500(self, client):
        # GET /api/models returns 500 when Ollama is unreachable and cache is empty.
        bad_cm = MagicMock()
        bad_cm.__aenter__ = AsyncMock(side_effect=Exception("Connection refused"))
        bad_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("server.httpx.AsyncClient", return_value=bad_cm):
            response = await client.get("/api/models")

        assert response.status_code == 500
        assert "Connection refused" in response.json()["detail"]

    async def test_get_models_returns_cache_on_error(self, client):
        # GET /api/models falls back to cached models when Ollama is unreachable.
        server.cached_models[:] = ["llama3:latest"]  # seed cache directly

        bad_cm = MagicMock()
        bad_cm.__aenter__ = AsyncMock(side_effect=Exception("timeout"))
        bad_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("server.httpx.AsyncClient", return_value=bad_cm):
            response = await client.get("/api/models")

        assert response.status_code == 200
        assert "llama3:latest" in response.json()["models"]