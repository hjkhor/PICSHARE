# 📸 PICSHARE | AI-Powered Event Photography

**PICSHARE** is a high-performance, full-stack photo sharing platform that leverages offline face recognition to automatically match guests with their event photos. It streamlines the delivery of event photography by syncing images from Google Drive, indexing them via AI, and allowing guests to find all their photos instantly with just a single selfie.

![Project Status](https://img.shields.io/badge/Status-Beta-orange)
![License](https://img.shields.io/badge/License-MIT-blue)
![Stack](https://img.shields.io/badge/Stack-FastAPI%20|%20Next.js%20|%20InsightFace-green)

---

## ✨ Features

- 👤 **AI Face Matching**: Uses the **InsightFace** library for highly accurate, offline facial recognition.
- ☁️ **Google Drive Sync**: Automatically fetches and indexes images from specific Google Drive folders.
- 🚀 **FastAPI Backend**: High-performance Python backend with asynchronous database operations via `aiosqlite`.
- 🎨 **Modern Frontend**: Sleek, responsive Next.js dashboard and guest portal with Dark Mode support.
- 📱 **Guest Self-Service**: Guests upload a selfie and instantly receive a curated gallery of their photos.
- 🛠️ **Admin Dashboard**: Full control over events, guest management, and photo processing.
- 🔄 **Efficient Background Tasks**: Dedicated cron workers for periodic sync and recovery tasks.
- 📦 **Docker Ready**: Fully containerized setup for easy deployment.

---

## 🏗️ Architecture

### Tech Stack
- **Backend**: FastAPI (Python 3.8+)
- **Frontend**: Next.js 15 (React 19), TailwindCSS, Shadcn UI
- **AI/ML**: InsightFace (Context-Aware Face Recognition)
- **Database**: SQLite (via `aiosqlite` for async support)
- **Orchestration**: Docker & Docker Compose
- **Package Managers**: `pip` (Backend), `bun` (Frontend)

### Project Structure
```text
drive-photo-sharing/
├── backend/            # FastAPI Application
│   ├── app/            # Core logic, API routes, and Services
│   ├── data/           # SQLite DB, uploads, and cached models
│   └── cron_worker.py  # Background sync engine
├── frontend/           # Next.js Application
│   ├── src/app/        # App Router pages
│   └── components/     # UI Design System
└── docker-compose.yml  # Orchestration
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Docker & Docker Compose** (Recommended)
- **Google Cloud OAuth web application** (with Drive API enabled)
- **Python 3.8+** & **Bun** (for local development)

### 2. Configure Environment
1. **Google Drive Setup**: Follow the photographer OAuth setup below.

2. **Backend Config**:
   Create `backend/.env` using the following variables (defaults provided):

| Variable | Description | Default / Example |
|----------|-------------|---------|
| `FACE_SIMILARITY_THRESHOLD` | Face matching threshold (0.0-1.0) | `0.6` |
| `SECRET_KEY` | JWT secret key | `ThisIsMyLongSecretKeyForJWT` |
| `DB_PATH` | Path to SQLite database | `data/app.db` |


3. **Frontend Config**:
   Create `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_API_URL=/api
   ```

### 3. Run with Docker 🐳
```bash
# Start the entire stack
docker-compose up -d
```
The application will be available at:
- **Frontend**: `http://localhost:3005`
- **Backend API**: `http://localhost:8000`
- **Swagger Docs**: `http://localhost:8000/docs`

---

## 🛠️ Local Development

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Or .\venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend Setup
```bash
cd frontend
bun install
bun run dev
```

---

## 🔐 Security & License

- **Security**: Please refer to [SECURITY.md](SECURITY.md) for vulnerability reporting.
- **License**: Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.
- **Contributing**: Contributions are what make the open-source community an amazing place. Check out [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

**Built by [Yash Oswal](https://github.com/yashoswalyo) with ❤️**

## Photographer accounts and Google Drive

Photographers can register at `/admin/login` with email/password or enter their
name and brand and choose **Create account with Google**. Google registration
also connects Drive. Existing password accounts can use **Enable Google sign-in**
in the dashboard to link a Google identity explicitly; connecting a Drive account
alone does not turn that Drive account into a login method. After creating an
event, they can paste a Drive folder URL into it and start sync. The event link shown in the
dashboard opens the client selfie and matching flow. Each account sees only its
own events and uses its own Google Drive connection.

The homepage is for photographers; guests enter through a photographer's event
link. A guest enters their name and uploads one selfie, with no email address
required. The event page does not retain guest history in the browser; returning
guests can upload a new selfie to search again.

For Drive OAuth, enable the Google Drive API and Google OAuth consent screen in a
Google Cloud project. Create a **Web application** OAuth client and register the
exact backend callback URL (locally,
`http://localhost:8000/auth/google/callback`). Add these to `backend/.env`:

```env
GOOGLE_CLIENT_ID=your-web-client-id
GOOGLE_CLIENT_SECRET=your-web-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
FRONTEND_URL=http://localhost:3005
TOKEN_ENCRYPTION_KEY=generated-fernet-key
SECRET_KEY=long-random-private-value
```

Generate `TOKEN_ENCRYPTION_KEY` with `python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`.
Keep this key backed up: losing it disconnects all photographers' Drive tokens.
For a deployed site, use its HTTPS callback and frontend URLs. Google Drive
`drive.readonly` is a restricted scope; a public OAuth app will need Google's
verification before broad use. The backend stores each refresh token encrypted.
The app reads photos from the selected Drive folder and does not modify Drive.
For new Drive photos, indexing uses a compressed 1600-pixel preview stored locally.
Guest galleries use small thumbnails and the preview; the original HD file stays
in Drive and is fetched only when a guest downloads a photo or ZIP. If Drive
does not provide a usable preview, PICSHARE temporarily downloads the original,
creates the compact index image, and does not retain that HD copy locally.
Existing photos indexed before this change keep their current local originals.

Existing pre-account events remain in the database, unassigned and hidden. After
registering your account, you can explicitly assign selected old events with:

```bash
cd backend
python3 scripts/claim_legacy_events.py --email you@example.com --event-id EVENT_ID
```

Review each event and back up `backend/data/app.db` before claiming it. Existing
Drive photos will use the newly connected account's Drive permission, so that
Google account must be able to read the folder.

For a fresh installation on another laptop, see [SETUP_NEW_LAPTOP.md](SETUP_NEW_LAPTOP.md).
The optional free hosted event publisher is documented in [offline-host/README.md](offline-host/README.md).
