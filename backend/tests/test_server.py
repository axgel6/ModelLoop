import pytest
from unittest.mock import Mock, patch


class TestHistoryEndpoints:
    """Tests for /api/history endpoints."""

    def test_get_history_empty(self, client):
        """GET /api/history returns empty history for new session."""
        response = client.get("/api/history")
        assert response.status_code == 200
        assert response.json == {"history": []}

    def test_clear_history(self, client):
        """DELETE /api/history clears session history."""
        response = client.delete("/api/history")
        assert response.status_code == 200
        assert response.json == {"message": "History cleared"}


class TestChatEndpoint:
    """Tests for /api/chat endpoint."""

    def test_chat_empty_prompt(self, client):
        """POST /api/chat rejects empty prompt."""
        response = client.post("/api/chat", json={"prompt": ""})
        assert response.status_code == 400
        assert response.json == {"error": "Prompt is required"}

    def test_chat_whitespace_prompt(self, client):
        """POST /api/chat rejects whitespace-only prompt."""
        response = client.post("/api/chat", json={"prompt": "   "})
        assert response.status_code == 400
        assert response.json == {"error": "Prompt is required"}

    def test_chat_prompt_too_long(self, client):
        """POST /api/chat rejects prompt exceeding max length."""
        long_prompt = "a" * 10001
        response = client.post("/api/chat", json={"prompt": long_prompt})
        assert response.status_code == 400
        assert "exceeds maximum length" in response.json["error"]

    @patch("server.requests.post")
    def test_chat_success(self, mock_post, client):
        """POST /api/chat returns response from Ollama."""
        mock_response = Mock()
        mock_response.json.return_value = {"response": "Hello! How can I help?"}
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response

        response = client.post("/api/chat", json={"prompt": "Hello"})
        
        assert response.status_code == 200
        data = response.json
        assert data["response"] == "Hello! How can I help?"
        assert len(data["history"]) == 2
        assert data["history"][0] == {"role": "user", "content": "Hello"}
        assert data["history"][1] == {"role": "assistant", "content": "Hello! How can I help?"}

    @patch("server.requests.post")
    def test_chat_sets_session_cookie(self, mock_post, client):
        """POST /api/chat sets session cookie on first request."""
        mock_response = Mock()
        mock_response.json.return_value = {"response": "Hi"}
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response

        response = client.post("/api/chat", json={"prompt": "Hello"})
        
        assert response.status_code == 200
        assert "session_id" in response.headers.get("Set-Cookie", "")

    @patch("server.requests.post")
    def test_chat_preserves_history(self, mock_post, client):
        """POST /api/chat maintains conversation history across requests."""
        mock_response = Mock()
        mock_response.json.return_value = {"response": "Response 1"}
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response

        # First request
        response1 = client.post("/api/chat", json={"prompt": "Message 1"})
        assert response1.status_code == 200
        
        # Extract cookie for subsequent request
        cookies = response1.headers.get("Set-Cookie", "")
        
        # Second request with same session
        mock_response.json.return_value = {"response": "Response 2"}
        response2 = client.post(
            "/api/chat",
            json={"prompt": "Message 2"},
            headers={"Cookie": cookies.split(";")[0]}
        )
        
        assert response2.status_code == 200
        assert len(response2.json["history"]) == 4

    @patch("server.requests.post")
    def test_chat_ollama_error(self, mock_post, client):
        """POST /api/chat handles Ollama API errors."""
        mock_post.side_effect = Exception("Connection refused")

        response = client.post("/api/chat", json={"prompt": "Hello"})
        
        assert response.status_code == 500
        assert "Connection refused" in response.json["error"]

    @patch("server.requests.post")
    def test_chat_custom_model(self, mock_post, client):
        """POST /api/chat uses custom model when provided."""
        mock_response = Mock()
        mock_response.json.return_value = {"response": "Hi"}
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response

        client.post("/api/chat", json={"prompt": "Hello", "model": "llama3:latest"})
        
        call_args = mock_post.call_args
        assert call_args[1]["json"]["model"] == "llama3:latest"


class TestModelsEndpoint:
    """Tests for /api/models endpoint."""

    @patch("server.requests.get")
    def test_get_models_success(self, mock_get, client):
        """GET /api/models returns list of available models."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "models": [
                {"name": "llama3:latest"},
                {"name": "dolphin3:latest"}
            ]
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        response = client.get("/api/models")
        
        assert response.status_code == 200
        assert response.json == {"models": ["llama3:latest", "dolphin3:latest"]}

    @patch("server.requests.get")
    def test_get_models_empty(self, mock_get, client):
        """GET /api/models handles empty model list."""
        mock_response = Mock()
        mock_response.json.return_value = {"models": []}
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        response = client.get("/api/models")
        
        assert response.status_code == 200
        assert response.json == {"models": []}

    @patch("server.requests.get")
    def test_get_models_error(self, mock_get, client):
        """GET /api/models handles Ollama API errors."""
        mock_get.side_effect = Exception("Connection refused")

        response = client.get("/api/models")
        
        assert response.status_code == 500
        assert "Connection refused" in response.json["error"]
