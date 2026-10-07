import aiosqlite
import os
import json
import uuid
from datetime import datetime
from app.core.config import get_settings

settings = get_settings()


class Database:
    connection: aiosqlite.Connection = None

    async def connect(self):
        self.connection = await aiosqlite.connect(settings.DB_PATH)
        self.connection.row_factory = aiosqlite.Row
        await self._init_tables()

    async def disconnect(self):
        if self.connection:
            await self.connection.close()

    async def _init_tables(self):
        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS photographers (
                id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL, brand_name TEXT NOT NULL,
                password_hash TEXT NOT NULL, google_sub TEXT UNIQUE,
                created_at TEXT NOT NULL
            )
        """)
        photographer_columns = [row[1] for row in await (await self.connection.execute("PRAGMA table_info(photographers)")).fetchall()]
        if "google_sub" not in photographer_columns:
            await self.connection.execute("ALTER TABLE photographers ADD COLUMN google_sub TEXT")
        await self.connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_photographers_google_sub ON photographers (google_sub)"
        )
        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS oauth_login_tickets (
                token_hash TEXT PRIMARY KEY,
                photographer_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (photographer_id) REFERENCES photographers(id)
            )
        """)
        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS drive_connections (
                photographer_id TEXT PRIMARY KEY, google_email TEXT,
                refresh_token TEXT NOT NULL, connected_at TEXT NOT NULL,
                FOREIGN KEY (photographer_id) REFERENCES photographers(id)
            )
        """)
        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                photographer_id TEXT,
                name TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                date TEXT NOT NULL,
                drive_folder_url TEXT,
                secret_code TEXT,
                sync_status TEXT DEFAULT 'idle',
                last_sync_at TEXT,
                created_at TEXT NOT NULL
            )
        """)

        columns = [row[1] for row in await (await self.connection.execute("PRAGMA table_info(events)")).fetchall()]
        if "photographer_id" not in columns:
            await self.connection.execute("ALTER TABLE events ADD COLUMN photographer_id TEXT")
        # Existing events are retained, but are not silently assigned to a new account.
        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                original_file_name TEXT,
                drive_file_id TEXT,
                thumbnail_path TEXT,
                width INTEGER,
                height INTEGER,
                faces_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events (id)
            )
        """)

        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS faces (
                id TEXT PRIMARY KEY,
                photo_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                embedding_vector TEXT NOT NULL,
                bounding_box TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (photo_id) REFERENCES photos (id),
                FOREIGN KEY (event_id) REFERENCES events (id)
            )
        """)

        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS guests (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT,
                selfie_path TEXT,
                status TEXT DEFAULT 'processing',
                match_count INTEGER DEFAULT 0,
                matched_photo_ids TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events (id)
            )
        """)
        await self.connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_photos_event ON photos (event_id)")
        await self.connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_photos_drive ON photos (drive_file_id)"
        )
        await self.connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_faces_event ON faces (event_id)")
        await self.connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_guests_event ON guests (event_id)")
        await self.connection.commit()

    # Helper methods to make API migration easier
    async def fetch_one(self, query, params=()):
        async with self.connection.execute(query, params) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def fetch_all(self, query, params=()):
        async with self.connection.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def execute(self, query, params=()):
        await self.connection.execute(query, params)
        await self.connection.commit()

    async def execute_returning_one(self, query, params=()):
        async with self.connection.execute(query, params) as cursor:
            row = await cursor.fetchone()
        await self.connection.commit()
        return dict(row) if row else None


db = Database()


async def connect_to_db():
    await db.connect()


async def close_db_connection():
    await db.disconnect()
