# Run PICSHARE on another laptop

This repository contains the app code. It deliberately excludes `.env` files,
Google credentials, the SQLite database, indexed photos, and face models.
Cloning it starts a fresh installation. The previous event is not transferred.

## Local app

1. Install Git and Docker Desktop, then clone your private PICSHARE repository.
2. In the repository root, copy `.env.example` to `.env` and
   `backend/.env.example` to `backend/.env`.
3. Fill in the Google OAuth web client ID and secret in `backend/.env` if you
   want Google sign-in or Drive sync. Set the authorized redirect URI in Google
   Cloud to exactly `http://localhost:8000/auth/google/callback`.
4. Generate a private JWT key and a Fernet key on that laptop:

   ```sh
   python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
   python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
   ```

   Put the first value in `SECRET_KEY` and the second in
   `TOKEN_ENCRYPTION_KEY` in `backend/.env`. Keep both private. If you later
   move an existing database, keep its original `TOKEN_ENCRYPTION_KEY` so its
   stored Drive connection can still be decrypted.
5. Start the app from the repository root:

   ```sh
   docker compose up -d --build
   ```

6. Open `http://localhost:3005/admin/login` and create a photographer account.
   Connect Google Drive and create a new event if needed.

Docker stores the local database and indexed images under `backend/data/`.
That folder is ignored by Git, so the other laptop starts without old events.

## Hosted future events

After a new local event has finished syncing, follow
[offline-host/README.md](offline-host/README.md) to publish its compressed
previews and selfie search to Cloudflare's free tier. Guests can then access
that published event while the laptop is off. Publishing requires Node.js,
Python 3, a signed-in Cloudflare account, and Cloudflare resources configured
in `offline-host/wrangler.jsonc`.
