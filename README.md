# ModelLoop

A self-hosted AI chat interface powered by Ollama.

## Project Structure

```
ModelLoop/
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   └── package.json
├── backend/           # Flask API server
│   ├── server.py
│   └── .env
└── README.md
```

## Current Features

- Chat with conversation context
- Multiple model support
- Session-based history (per-user conversations)
- Rate limiting protection
- Code syntax highlighting
- Markdown rendering

## Getting Started

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install flask flask-cors flask-limiter python-dotenv requests
python server.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Features Coming Soon

- Streaming responses (token-by-token)
- Multiple user support
- Themes + custom branding
- Hardware specs display
- Custom Ollama server URL configuration
- Regenerate response
- Edit & resubmit messages
- Export chat history (Markdown/JSON)
- Pull/delete models from UI
- System prompt customization
- Dark/light mode toggle
- Temperature/parameter controls
- Keyboard shortcuts
- Image support
