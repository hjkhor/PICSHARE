import uuid
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from app.api.auth import get_current_photographer
from pydantic import BaseModel, Field
from typing import List, Optional
from app.services.db import db

router = APIRouter(prefix="/events", tags=["events"],)

class EventCreate(BaseModel):
    name: str
    slug: str
    date: datetime
    drive_folder_url: Optional[str] = None
    secret_code: Optional[str] = None

class EventResponse(BaseModel):
    id: str = Field(alias="_id")
    name: str
    slug: str
    date: datetime
    drive_folder_url: Optional[str] = None
    secret_code: Optional[str] = None
    created_at: datetime
    sync_status: str = "idle" # idle, syncing, completed, error
    last_sync_at: Optional[datetime] = None

    class Config:
        populate_by_name = True

class PublicEventResponse(BaseModel):
    id: str = Field(alias="_id")
    name: str
    slug: str
    date: datetime
    is_protected: bool
    created_at: datetime
    brand_name: Optional[str] = None

    class Config:
        populate_by_name = True

def format_event(row):
    if not row: return None
    d = dict(row)
    # Map 'id' to '_id' for frontend compatibility
    d["_id"] = d.pop("id")
    
    # Handle ISO strings to datetime objects for Pydantic
    if d.get("date"):
        d["date"] = datetime.fromisoformat(d["date"])
    if d.get("created_at"):
        d["created_at"] = datetime.fromisoformat(d["created_at"])
    if d.get("last_sync_at"):
        d["last_sync_at"] = datetime.fromisoformat(d["last_sync_at"])
    
    # Add protection flag
    d["is_protected"] = bool(d.get("secret_code"))
    return d

@router.get("/public/list", response_model=List[PublicEventResponse])
async def list_public_events():
    rows = await db.fetch_all("SELECT e.*, p.brand_name FROM events e JOIN photographers p ON p.id = e.photographer_id ORDER BY e.date DESC")
    return [format_event(row) for row in rows]

@router.get("/public/{slug}", response_model=PublicEventResponse)
async def get_public_event(slug: str):
    row = await db.fetch_one("SELECT e.*, p.brand_name FROM events e JOIN photographers p ON p.id = e.photographer_id WHERE e.slug = ?", (slug,))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return format_event(row)

class CodeVerify(BaseModel):
    slug: str
    code: str

@router.post("/verify")
async def verify_event_code(data: CodeVerify):
    row = await db.fetch_one("SELECT * FROM events WHERE slug = ? AND photographer_id IS NOT NULL", (data.slug,))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    
    event = format_event(row)
    if event.get("secret_code") and event["secret_code"] != data.code:
        raise HTTPException(status_code=401, detail="Invalid secret code")
    
    return {"status": "success", "event": {k: v for k, v in event.items() if k != "secret_code"}}

@router.post("", response_model=EventResponse)
@router.post("/", response_model=EventResponse)
async def create_event(event: EventCreate, user=Depends(get_current_photographer)):
    # Check if slug exists
    existing = await db.fetch_one("SELECT id FROM events WHERE slug = ?", (event.slug,))
    if existing:
        raise HTTPException(status_code=400, detail="Slug already exists")
    
    event_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    
    await db.execute("""
        INSERT INTO events (id, photographer_id, name, slug, date, drive_folder_url, secret_code, sync_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        event_id,
        user["id"],
        event.name, 
        event.slug, 
        event.date.isoformat(), 
        event.drive_folder_url,
        event.secret_code,
        "idle", 
        created_at
    ))
    
    row = await db.fetch_one("SELECT * FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    return format_event(row)

@router.get("", response_model=List[EventResponse])
@router.get("/", response_model=List[EventResponse])
async def list_events(user=Depends(get_current_photographer)):
    rows = await db.fetch_all("SELECT * FROM events WHERE photographer_id = ? ORDER BY created_at DESC", (user["id"],))
    return [format_event(row) for row in rows]

@router.put("/{event_id}", response_model=EventResponse)
async def update_event(event_id: str, event_data: dict, user=Depends(get_current_photographer)):
    # event_data comes as a dict from frontend
    existing = await db.fetch_one("SELECT id FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")
    
    if not event_data:
        raise HTTPException(status_code=400, detail="No data to update")

    # Build update query dynamically
    fields = []
    params = []
    for key, value in event_data.items():
        # Map frontend _id back to id if necessary, but usually we don't update ID
        if key not in {"name", "date", "drive_folder_url", "secret_code"}: continue
        
        fields.append(f"{key} = ?")
        if isinstance(value, datetime):
            params.append(value.isoformat())
        else:
            params.append(value)
    
    if not fields:
        raise HTTPException(status_code=400, detail="No editable fields")
    params.extend([event_id, user["id"]])
    query = f"UPDATE events SET {', '.join(fields)} WHERE id = ? AND photographer_id = ?"
    
    await db.execute(query, params)
    
    updated = await db.fetch_one("SELECT * FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    return format_event(updated)

@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: str, user=Depends(get_current_photographer)):
    row = await db.fetch_one("SELECT * FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return format_event(row)

@router.get("/{event_id}/storage")
async def get_event_storage(event_id: str, user=Depends(get_current_photographer)):
    """Get storage usage information for an event"""
    import os
    import shutil
    from app.core.config import get_settings
    
    settings = get_settings()
    
    # Check if event exists
    event = await db.fetch_one("SELECT * FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Calculate storage used by this event
    event_storage = 0
    
    # 1. Calculate photos storage
    photos = await db.fetch_all("SELECT * FROM photos WHERE event_id = ?", (event_id,))
    for photo in photos:
        photo_id = photo["id"]
        
        # Check original photo files
        for ext in ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG', 'webp', 'WEBP']:
            original_path = os.path.join(settings.UPLOAD_ROOT, f"{photo_id}.{ext}")
            if os.path.exists(original_path):
                event_storage += os.path.getsize(original_path)
        
        # Check thumbnail files
        index_path = os.path.join(settings.INDEX_ROOT, f"{photo_id}.jpg")
        if os.path.exists(index_path):
            event_storage += os.path.getsize(index_path)
        thumbnail_path = photo.get("thumbnail_path")
        if thumbnail_path and os.path.exists(thumbnail_path):
            event_storage += os.path.getsize(thumbnail_path)
    
    # 2. Calculate guest selfies storage
    guests = await db.fetch_all("SELECT * FROM guests WHERE event_id = ?", (event_id,))
    for guest in guests:
        selfie_path = guest.get("selfie_path")
        if selfie_path and os.path.exists(selfie_path):
            event_storage += os.path.getsize(selfie_path)
    
    # 3. Get system storage information
    try:
        # Get disk usage for the data directory
        data_path = os.path.dirname(settings.DB_PATH)
        if not os.path.exists(data_path):
            data_path = "."
        
        disk_usage = shutil.disk_usage(data_path)
        total_storage = disk_usage.total
        free_storage = disk_usage.free
        used_storage = disk_usage.used
    except Exception as e:
        print(f"Error getting disk usage: {e}")
        total_storage = 0
        free_storage = 0
        used_storage = 0
    
    return {
        "event_id": event_id,
        "event_storage_bytes": event_storage,
        "event_storage_mb": round(event_storage / (1024 * 1024), 2),
        "event_storage_gb": round(event_storage / (1024 * 1024 * 1024), 2),
        "total_storage_bytes": total_storage,
        "total_storage_gb": round(total_storage / (1024 * 1024 * 1024), 2),
        "free_storage_bytes": free_storage,
        "free_storage_gb": round(free_storage / (1024 * 1024 * 1024), 2),
        "used_storage_bytes": used_storage,
        "used_storage_gb": round(used_storage / (1024 * 1024 * 1024), 2),
        "photo_count"   : len(photos),
        "guest_count": len(guests)
    }

@router.delete("/{event_id}")
async def delete_event(event_id: str, user=Depends(get_current_photographer)):
    """Delete an event and all associated data (photos, faces, guests, files)"""
    import os
    import shutil
    from app.core.config import get_settings
    
    settings = get_settings()
    
    # Check if event exists
    event = await db.fetch_one("SELECT * FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    try:
        # Get all photos for this event to delete their files
        photos = await db.fetch_all("SELECT * FROM photos WHERE event_id = ?", (event_id,))
        
        for photo in photos:
            photo_id = photo["id"]
            
            # Delete original photo files (try multiple extensions)
            for ext in ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG', 'webp', 'WEBP']:
                original_path = os.path.join(settings.UPLOAD_ROOT, f"{photo_id}.{ext}")
                if os.path.exists(original_path):
                    try:
                        os.remove(original_path)
                    except Exception as e:
                        print(f"Error deleting original {original_path}: {e}")
            
            # Delete thumbnail files
            index_path = os.path.join(settings.INDEX_ROOT, f"{photo_id}.jpg")
            if os.path.exists(index_path):
                os.remove(index_path)
            thumbnail_path = photo.get("thumbnail_path")
            if thumbnail_path and os.path.exists(thumbnail_path):
                try:
                    os.remove(thumbnail_path)
                except Exception as e:
                    print(f"Error deleting thumbnail {thumbnail_path}: {e}")
        
        # Get all guests for this event to delete their selfies
        guests = await db.fetch_all("SELECT * FROM guests WHERE event_id = ?", (event_id,))
        
        for guest in guests:
            selfie_path = guest.get("selfie_path")
            if selfie_path and os.path.exists(selfie_path):
                try:
                    os.remove(selfie_path)
                except Exception as e:
                    print(f"Error deleting selfie {selfie_path}: {e}")
        
        # Delete from database (in correct order due to foreign keys)
        await db.execute("DELETE FROM faces WHERE event_id = ?", (event_id,))
        await db.execute("DELETE FROM photos WHERE event_id = ?", (event_id,))
        await db.execute("DELETE FROM guests WHERE event_id = ?", (event_id,))
        await db.execute("DELETE FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
        
        return {
            "message": "Event deleted successfully",
            "deleted_photos": len(photos),
            "deleted_guests": len(guests)
        }
        
    except Exception as e:
        print(f"Error deleting event {event_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting event: {str(e)}")
