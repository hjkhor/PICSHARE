import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import events, photos, guests, auth
from app.services.db import connect_to_db, close_db_connection
from app.core.config import get_settings
from subprocess import Popen

@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_db()
    # A container restart must not strand a long Drive sync. This deployment
    # runs one API worker, so resume interrupted events in the background.
    interrupted = await photos.db.fetch_all(
        "SELECT id FROM events WHERE sync_status = 'syncing' AND photographer_id IS NOT NULL"
    )
    async def resume_syncs():
        for event in interrupted:
            await photos.run_sync_task(event["id"])
    resume_task = asyncio.create_task(resume_syncs()) if interrupted else None
    try:
        yield
    finally:
        if resume_task:
            resume_task.cancel()
            await asyncio.gather(resume_task, return_exceptions=True)
        await close_db_connection()

settings = get_settings()

app = FastAPI(title="Drive Photo Sharing API", lifespan=lifespan, redirect_slashes=False,)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length"],
    allow_credentials=True,
)


app.include_router(auth.router)
app.include_router(events.router)
app.include_router(photos.router)
app.include_router(guests.router)

@app.get("/")
def read_root():
    return {"message": "Drive Photo Sharing API is running"}
