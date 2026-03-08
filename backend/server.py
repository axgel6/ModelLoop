import requests
import os
import uuid
import json
from dotenv import load_dotenv
from flask import Flask, request, jsonify, make_response, Response, stream_with_context
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv()

app = Flask(__name__)

# CORS configuration for frontend access
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)

IS_PRODUCTION = os.environ.get("FLASK_DEBUG", "false").lower() != "true"

# Rate limiting to prevent API abuse
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["100 per hour"],
    storage_uri="memory://"
)

# Configuration
MAX_PROMPT_LENGTH = 10000
OLLAMA_BASE_URL = os.environ.get("OLLAMA_URL")
DEFAULT_MODEL = "dolphin3:latest"
NGROK_HEADERS = {"ngrok-skip-browser-warning": "true"}  # Bypass ngrok browser warning

# In-memory session storage (session_id -> message history)
session_histories: dict[str, list[dict]] = {}


# Get existing session or create new one. Returns (session_id, history, is_new)
def get_or_create_session():
    session_id = request.cookies.get("session_id")
    is_new = False
    if not session_id:
        session_id = str(uuid.uuid4())
        is_new = True
        session_histories[session_id] = []
    elif session_id not in session_histories:
        session_histories[session_id] = []
    return session_id, session_histories[session_id], is_new


# Build conversation string from message history for Ollama prompt format
def build_conversation(history: list[dict]) -> str:
    parts = []
    for msg in history:
        prefix = "User" if msg["role"] == "user" else "Assistant"
        parts.append(f"{prefix}: {msg['content']}")
    parts.append("Assistant:")  # Prompt model to respond
    return "\n".join(parts)


# Set session cookie on response
def set_session_cookie(response, session_id: str):
    response.set_cookie(
        "session_id",
        session_id,
        httponly=True,
        samesite="None" if IS_PRODUCTION else "Lax",
        secure=IS_PRODUCTION,
        max_age=86400  # 24 hours
    )


# POST /api/chat/stream - Stream chat responses using Server-Sent Events (SSE)
@app.route("/api/chat/stream", methods=["POST"])
@limiter.limit("20 per minute")
def chat_stream():
    session_id, history, is_new = get_or_create_session()
    
    data = request.json
    prompt = data.get("prompt", "").strip()
    model = (data.get("model") or DEFAULT_MODEL).strip()
    
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400
    if len(prompt) > MAX_PROMPT_LENGTH:
        return jsonify({"error": f"Prompt exceeds maximum length of {MAX_PROMPT_LENGTH} characters"}), 400
    
    # Build conversation with new user message (don't modify history yet)
    temp_history = history + [{"role": "user", "content": prompt}]
    conversation = build_conversation(temp_history)
    
    def generate():
        full_response = ""
        success = False
        
        try:
            with requests.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": model, "prompt": conversation, "stream": True},
                headers=NGROK_HEADERS,
                stream=True,
                timeout=120
            ) as response:
                response.raise_for_status()
                
                # Stream tokens as they arrive
                for line in response.iter_lines():
                    if line:
                        try:
                            chunk = json.loads(line)
                            token = chunk.get("response", "")
                            if token:
                                full_response += token
                                yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                            if chunk.get("done"):
                                success = True
                                break
                        except json.JSONDecodeError:
                            continue
            
            # Only persist to history after successful completion
            if success and full_response.strip():
                history.append({"role": "user", "content": prompt})
                history.append({"role": "assistant", "content": full_response.strip()})
                yield f"data: {json.dumps({'type': 'done', 'history': history})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': 'Empty response from model'})}\n\n"
                
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    response = Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )
    
    if is_new:
        set_session_cookie(response, session_id)
    
    return response


# GET /api/history - Retrieve conversation history for current session
@app.route("/api/history", methods=["GET"])
def get_history():
    _, history, _ = get_or_create_session()
    return jsonify({"history": history})


# DELETE /api/history - Clear conversation history for current session
@app.route("/api/history", methods=["DELETE"])
def clear_history():
    session_id = request.cookies.get("session_id")
    if session_id and session_id in session_histories:
        session_histories[session_id] = []
    return jsonify({"message": "History cleared"})


# GET /api/models - Fetch available models from Ollama server
@app.route("/api/models", methods=["GET"])
def get_models():
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", headers=NGROK_HEADERS)
        response.raise_for_status()
        data = response.json()
        models = [m.get("name") for m in data.get("models", []) if m.get("name")]
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    debug_mode = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    port = int(os.environ.get("PORT", 5001))
    app.run(debug=debug_mode, host="0.0.0.0", port=port)