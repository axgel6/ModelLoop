# HTTP client used to call the Ollama local API from this Flask backend.
import requests
import os
import uuid
from dotenv import load_dotenv
# Flask core app object + request reader + JSON response helper.
from flask import Flask, request, jsonify, make_response
# Enables cross-origin requests from the frontend dev server.
from flask_cors import CORS
# Rate limiting to prevent abuse
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Load environment variables from .env file
load_dotenv()

# Initialize Flask app
app = Flask(__name__)

# Configure CORS - restrict to specific origins
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)

# Configure rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["100 per hour"],
    storage_uri="memory://"
)

# Maximum allowed prompt length (characters)
MAX_PROMPT_LENGTH = 10000

# Per-session conversation history storage
# Key: session_id, Value: list of message dicts
session_histories: dict[str, list[dict]] = {}


def get_session_id():
    """Get or create a session ID from cookies"""
    return request.cookies.get("session_id")


def get_history_for_session():
    """Get conversation history for current session"""
    session_id = get_session_id()
    if session_id and session_id in session_histories:
        return session_histories[session_id]
    return []

# Configuration for Ollama API connection
# OLLAMA_BASE_URL: Address of the Ollama server (use env var for production)
# DEFAULT_MODEL: Fallback AI model if frontend doesn't send one
OLLAMA_BASE_URL = os.environ.get("OLLAMA_URL")
DEFAULT_MODEL = "dolphin3:latest"

# Headers to bypass ngrok's browser warning page
NGROK_HEADERS = {"ngrok-skip-browser-warning": "true"}


# POST /api/chat - Main chat endpoint that processes user messages
# Receives a JSON payload with a 'prompt' field from the frontend
@app.route("/api/chat", methods=["POST"])
@limiter.limit("20 per minute")  # Stricter limit for expensive chat endpoint
def chat():
    # Get or create session ID
    session_id = get_session_id()
    new_session = False
    if not session_id:
        session_id = str(uuid.uuid4())
        new_session = True
        session_histories[session_id] = []
    elif session_id not in session_histories:
        session_histories[session_id] = []
    
    history = session_histories[session_id]
    
    # Extract JSON data from the request
    data = request.json
    # Get the prompt text and remove leading/trailing whitespace
    prompt = data.get("prompt", "").strip()
    # Use requested model when provided, otherwise safely fall back to default.
    model = (data.get("model") or DEFAULT_MODEL).strip()
    
    # Validate that prompt is not empty
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400
    
    # Validate prompt length
    if len(prompt) > MAX_PROMPT_LENGTH:
        return jsonify({"error": f"Prompt exceeds maximum length of {MAX_PROMPT_LENGTH} characters"}), 400
    
    # Add user's message to conversation history
    history.append({"role": "user", "content": prompt})
    
    # Build the full conversation context including all previous messages
    # This gives the AI model awareness of the entire conversation history
    conversation = ""
    for message in history:
        role = message["role"]
        content = message["content"]
        if role == "user":
            # Format user messages as "User: [message]"
            conversation += f"User: {content}\n"
        else:
            # Format assistant messages as "Assistant: [message]"
            conversation += f"Assistant: {content}\n"
    # Add prompt prefix so the model knows to generate an assistant response
    conversation += "Assistant:"
    
    # Prepare the API request payload for Ollama
    PAYLOAD = {
        "model": model,              # Specify which model to use
        "prompt": conversation,      # Send full conversation context
        "stream": False              # Set to False for complete response (not streaming)
    }
    
    # Send request to Ollama API and handle potential errors
    try:
        # Make POST request to Ollama's generate endpoint
        response = requests.post(f"{OLLAMA_BASE_URL}/api/generate", json=PAYLOAD, headers=NGROK_HEADERS, timeout=120)
        # Raise an exception if response status is not successful (4xx, 5xx)
        response.raise_for_status()
        
        # Parse the JSON response from Ollama
        result = response.json()
        # Extract the generated response text and clean it up
        full_response = result.get("response", "").strip()
        
        # Add AI's response to conversation history for future context
        history.append({"role": "assistant", "content": full_response})
        
        # Build response with session cookie
        resp = make_response(jsonify({
            "response": full_response,
            "history": history
        }))
        
        # Set session cookie if new session
        if new_session:
            resp.set_cookie("session_id", session_id, httponly=True, samesite="Lax", max_age=86400)
        
        return resp
    # Catch any errors (network issues, API errors, etc.) and return error message
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# GET /api/history - Retrieve the full conversation history
# Used by frontend to fetch existing conversation data (if needed)
@app.route("/api/history", methods=["GET"])
def get_history():
    history = get_history_for_session()
    return jsonify({"history": history})


# DELETE /api/history - Clear all conversation history
# Resets the conversation back to empty state
@app.route("/api/history", methods=["DELETE"])
def clear_history():
    session_id = get_session_id()
    if session_id and session_id in session_histories:
        session_histories[session_id] = []
    return jsonify({"message": "History cleared"})

# GET /api/models - Get a list of models available on the Ollama server
@app.route("/api/models", methods=["GET"])
def get_models():
    try:
        # Make GET request to Ollama's tags endpoint to retrieve available models
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", headers=NGROK_HEADERS)
        response.raise_for_status()  # Raise an error if the request fails
        # Ollama returns model objects; frontend only needs model name strings.
        data = response.json()
        models = [item.get("name") for item in data.get("models", []) if item.get("name")]
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Entry point: Start the Flask development server
# DEBUG read from env (default False for production safety)
# port=5001: Server runs on http://localhost:5001
if __name__ == "__main__":
    debug_mode = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug_mode, port=5001)