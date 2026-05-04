# ModelLoop

A self-hosted AI chat interface powered by Ollama. Full-featured conversational AI with JWT authentication, real-time streaming, document RAG, web search integration, and multi-model support.

## Features

### Core Chat

- **Streaming responses** — Token-by-token SSE updates with no timeout
- **Conversation context** — Full message history per session
- **Multi-model support** — Switch models mid-session in preferences
- **System prompt customization** — Per-session instructions
- **Markdown rendering** — Code blocks with syntax highlighting
- **LaTeX math** — Inline (`$x^2$`) and block (`$$...$$`) math rendering

### Authentication & User Management

- **JWT + Refresh tokens** — 15-minute access, 30-day refresh rotation
- **Bcrypt password hashing** — Secure credential storage
- **Per-user isolation** — Separate chat history and documents
- **Refresh token rotation** — Automatic on every renewal
- **Guest mode** — Optional API-key protected anonymous access

### External Tools

- **Web search** — Real-time DuckDuckGo results (current events, news, prices, weather)
- **Current time** — UTC date/time + ISO8601 for time-dependent queries
- **Extensible** — Architecture supports adding custom tools

### Advanced Features

- **Document upload & RAG** — Upload files (10 MB limit), chunked embeddings, semantic search
- **Image support** — Upload images, vision model analysis with context preservation
- **Rate limiting** — IP-based protection against API abuse
- **Audit logging** — Compliance tracking for admin actions & events
- **Thinking models** — Auto-detect reasoning models (deepseek-r1, etc.)
- **Theme system** — Gruvbox Dark & Ocean Glass themes with persistent preferences
- **Keyboard shortcuts** — Esc to close modals, quick navigation

### Development

- **Multi-model inference** — Pluggable Ollama integration
- **Async-first** — PostgreSQL with SQLAlchemy async ORM
- **Rate limiting** — slowapi middleware
- **Centralized API client** — All HTTP calls through single auth layer
- **Auto-schema creation** — Database migrations on startup

---

## Project Structure

```
ModelLoop/
├── backend/
│   ├── server.py                    # FastAPI app, routes, SSE streaming
│   ├── auth.py                      # JWT tokens, password hashing, auth deps
│   ├── database.py                  # Async SQLAlchemy engine & session
│   ├── models.py                    # ORM: User, Chat, Message, Document, AuditLog
│   ├── requirements.txt
│   ├── tests/
│   │   ├── conftest.py
│   │   └── test_server.py
│   ├── actions/
│   │   ├── __init__.py              # Tool registry & executor
│   │   ├── web_search.py            # DuckDuckGo integration
│   │   └── get_time.py              # UTC time endpoint
│   └── .env                         # Config (JWT_SECRET, DATABASE_URL, OLLAMA_URL, etc.)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── api.ts               # Centralized HTTP client with auth
│   │   │   ├── Chat.tsx             # Main chat UI + streaming
│   │   │   ├── ChatInput.tsx        # Input field + file upload
│   │   │   ├── ChatPreferences.tsx  # Settings (model, system prompt, theme)
│   │   │   ├── DownPage.tsx         # Maintenance mode page
│   │   │   ├── History.tsx          # Chat history modal
│   │   │   ├── LandingPage.tsx      # Home/signup
│   │   │   ├── Login.tsx            # Login + register form
│   │   │   ├── TermsOfService.tsx   # Legal page
│   │   │   ├── haptics.ts           # Vibration feedback
│   │   │   ├── useEscapeKey.ts      # Keyboard shortcut hook
│   │   │   └── hooks/
│   │   │       ├── useChatSession.ts   # Conversation state management
│   │   │       ├── useChatSettings.ts  # Preferences (theme, model, prompt)
│   │   │       └── useChatUI.ts        # Modal/dropdown visibility
│   │   ├── App.tsx                  # Router & auth state
│   │   ├── App.css                  # Gruvbox dark theme
│   │   ├── index.css                # Fonts & resets
│   │   └── main.tsx                 # Entry point
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── .env                         # VITE_API_URL, VITE_API_KEY, VITE_IS_DOWN
├── screenshots/
└── README.md
```

---

## Getting Started

### Prerequisites

- **Python 3.10+** (backend)
- **Node.js 18+** (frontend)
- **PostgreSQL 14+** (database)
- **Ollama** (local or remote inference)

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file (see Environment Variables section below)
cp .env.example .env
# Edit .env with your settings

# Run server
python server.py
```

Server starts on `http://localhost:8000` by default.

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env if needed (VITE_API_URL defaults to localhost)

# Start dev server
npm run dev
```

Frontend runs on `http://localhost:5173` by default.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable                  | Required | Default                 | Description                                                                 |
| ------------------------- | -------- | ----------------------- | --------------------------------------------------------------------------- |
| `JWT_SECRET`              | ✓        | —                       | Secret key for signing JWT tokens (use `openssl rand -hex 32`)              |
| `DATABASE_URL`            | ✓        | —                       | PostgreSQL connection: `postgresql+asyncpg://user:pass@host:5432/modelloop` |
| `OLLAMA_URL`              | ✓        | —                       | Ollama service URL: `http://localhost:11434`                                |
| `ALLOWED_ORIGINS`         | ✓        | `http://localhost:5173` | Comma-separated CORS whitelist                                              |
| `DEFAULT_MODEL`           | —        | `llama3.2:latest`       | Default chat model name                                                     |
| `VISION_MODEL`            | —        | `gemma3:4b-it-qat`      | Model for image analysis                                                    |
| `EMBED_MODEL`             | —        | `nomic-embed-text`      | Model for document embeddings (RAG)                                         |
| `THINKING_MODELS`         | —        | `deepseek-r1`           | Comma-separated substring list for auto-enabling reasoning                  |
| `JWT_EXPIRE_MINUTES`      | —        | `15`                    | Access token lifetime                                                       |
| `JWT_REFRESH_EXPIRE_DAYS` | —        | `30`                    | Refresh token lifetime                                                      |
| `JWT_ALGORITHM`           | —        | `HS256`                 | Token signing algorithm                                                     |
| `API_KEY`                 | —        | —                       | Optional key for guest endpoint (`POST /api/v1/guest/chat`)                 |
| `APP_ENV`                 | —        | `development`           | Set to `production` for strict mode                                         |

### Frontend (`frontend/.env`)

| Variable       | Default                 | Description                            |
| -------------- | ----------------------- | -------------------------------------- |
| `VITE_API_URL` | `http://localhost:8000` | Backend API base URL                   |
| `VITE_API_KEY` | —                       | Optional API key for guest requests    |
| `VITE_IS_DOWN` | `false`                 | Set to `true` to show maintenance page |

---

## Database Setup

### Create PostgreSQL Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE modelloop;
CREATE USER modelloop_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE modelloop TO modelloop_user;
\q
```

Update `DATABASE_URL` in `.env`:

```
postgresql+asyncpg://modelloop_user:secure_password@localhost:5432/modelloop
```

**Schema auto-creates on first startup** — no manual migrations needed.

---

## Ollama Setup

### Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Visit https://ollama.ai for Windows
```

### Pull Models

```bash
# Default chat model
ollama pull llama3.2:latest

# Vision model (for image analysis)
ollama pull gemma3:4b-it-qat

# Embedding model (for RAG)
ollama pull nomic-embed-text

# Reasoning model (optional)
ollama pull deepseek-r1
```

### Run Ollama Service

```bash
# Starts on port 11434
ollama serve

# Or if Ollama is already installed as a service, it auto-starts
```

---

## API Overview

### Authentication

- `POST /api/v1/auth/register` — Create account (email + password)
- `POST /api/v1/auth/login` — Get access + refresh tokens
- `POST /api/v1/auth/refresh` — Exchange refresh token for new pair
- `POST /api/v1/auth/logout` — Revoke refresh token

### Chats

- `GET /api/v1/chats` — List user's chats (newest first)
- `POST /api/v1/chats` — Create new chat
- `GET /api/v1/chats/{id}` — Fetch chat with all messages
- `PATCH /api/v1/chats/{id}` — Update chat title
- `DELETE /api/v1/chats/{id}` — Delete conversation

### Messaging

- `POST /api/v1/chats/{id}/messages` — Send message (SSE streaming)
- `GET /api/v1/chats/{id}/messages` — Get message history
- `DELETE /api/v1/chats/{id}/messages/{id}` — Delete message

### Documents (RAG)

- `POST /api/v1/chats/{id}/documents` — Upload file (multipart, 10 MB max)
- `GET /api/v1/chats/{id}/documents` — List documents in chat
- `DELETE /api/v1/chats/{id}/documents/{id}` — Delete document

### Guest Access

- `POST /api/v1/guest/chat` — Anonymous chat (requires `X-API-Key` header)

---

## Architecture Highlights

### Backend

- **FastAPI** — Modern async Python framework
- **SQLAlchemy** — Async ORM with PostgreSQL
- **Uvicorn** — ASGI server with auto-reload
- **slowapi** — Rate limiting middleware
- **SSE Streaming** — Real-time token delivery
- **CORS Middleware** — Configurable origin allowlist

### Frontend

- **React 18** — UI library
- **TypeScript** — Type-safe code
- **Vite** — Fast bundler & dev server
- **React Router** — Client-side routing
- **Markdown-It** — Markdown rendering
- **Local Storage** — Persistent preferences (theme, model, system prompt)

### Security

- JWT tokens with configurable expiration
- Bcrypt password hashing (14 rounds)
- Refresh token rotation on every renewal
- IP-based rate limiting
- CORS + CSRF protection
- Audit logging for compliance
- Optional production hardening

---

## Deployment

### Local Development

```bash
# Terminal 1: Backend
cd backend
source .venv/bin/activate
python server.py

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: Ollama (if not running as service)
ollama serve
```

### Production Checklist

- [ ] Set `APP_ENV=production` in backend .env
- [ ] Use strong `JWT_SECRET` (`openssl rand -hex 32`)
- [ ] Configure `ALLOWED_ORIGINS` with your domain
- [ ] Use external PostgreSQL (not local dev DB)
- [ ] Set up Ollama on dedicated hardware or cloud
- [ ] Use HTTPS (reverse proxy with nginx/Caddy)
- [ ] Configure `VITE_API_URL` to production backend URL
- [ ] Enable rate limiting in slowapi config
- [ ] Review audit logs periodically
- [ ] Keep models & dependencies updated

### Docker (Optional)

```dockerfile
# backend/Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "server.py"]
```

---

## Development

### Running Tests

```bash
cd backend
pytest tests/
```

### Code Style

- Backend: Follow PEP 8 (use `black`, `ruff`)
- Frontend: ESLint config provided

### Extending with Custom Tools

1. Create file in `backend/actions/my_tool.py`
2. Define `DEFINITION` (OpenAI function schema)
3. Define `KEYWORDS` (trigger terms)
4. Define `execute(arguments: dict) -> str`
5. Register in `backend/actions/__init__.py`

---

## Screenshots

![Screenshot of the sign in page](screenshots/sign-in.png)
![Screenshot of the landing page](screenshots/landing-page.png)
![Screenshot of the chat page](screenshots/chat.png)
![Screenshot of a chat between the AI Assistant and the user](screenshots/ai-user-chat.png)
![Screenshot of the chat preferences menu](screenshots/chat-preferences.png)
![Screenshot of another chat between AI Assistant and the user with math help](screenshots/ai-user-chat-2.png)

---

## License

This project is licensed under the **AGPL v3 with Personal Commercial Exemption**.

**Terms:**

- Non-commercial use permitted (personal projects, education)
- You must provide attribution
- Any modifications must be shared under the same license (copy-left)
- Commercial use is NOT permitted without explicit written permission

For the full legal text, see [LICENSE](LICENSE).

## Contributing

Contributions welcome! Please open an issue or submit a PR.

## Support

For issues or questions, open a GitHub issue.
