import os
import shutil
import uuid
import json
import asyncio
import io
from typing import List
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends, Query
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image
from app.core.config import get_settings
from app.services.db import db
from app.api.auth import get_current_photographer, optional_user
from app.services.drive_service import drive_service
from app.services.face_service import face_service
from app.services.thumbnail_service import thumbnail_service

router = APIRouter(prefix="/photos", tags=["photos"])
settings = get_settings()

os.makedirs(settings.UPLOAD_ROOT, exist_ok=True)
os.makedirs(settings.INDEX_ROOT, exist_ok=True)
os.makedirs(settings.THUMBNAIL_ROOT, exist_ok=True)



async def require_owned_event(event_id: str, user_id: str):
    row = await db.fetch_one("SELECT id FROM events WHERE id = ? AND photographer_id = ?", (event_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")

async def authorize_photo(photo_id: str, guest_id: str | None, user):
    row = await db.fetch_one("SELECT p.*, e.photographer_id FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ?", (photo_id,))
    if not row or not row["photographer_id"]:
        raise HTTPException(status_code=404, detail="Photo not found")
    if user and user["id"] == row["photographer_id"]:
        return row
    if guest_id:
        guest = await db.fetch_one("SELECT matched_photo_ids FROM guests WHERE id = ? AND event_id = ?", (guest_id, row["event_id"]))
        if guest and photo_id in json.loads(guest["matched_photo_ids"] or "[]"):
            return row
    raise HTTPException(status_code=404, detail="Photo not found")

def format_photo(row):
    if not row: return None
    d = dict(row)
    d["_id"] = d.pop("id")
    if d.get("created_at"):
        d["created_at"] = datetime.fromisoformat(d["created_at"])
    return d


async def process_photo(photo_id: str,
                        event_id: str,
                        event_slug: str,
                        original_path: str,
                        filename: str,
                        drive_file_id: str = None,
                        original_dimensions: tuple[int | None, int | None] | None = None):
    try:

        # 2. Generate Thumbnail
        thumb_path = os.path.join(settings.THUMBNAIL_ROOT, f"{photo_id}.jpg")
        await asyncio.to_thread(thumbnail_service.generate_thumbnail,
                                original_path, thumb_path)

        # 3. Extract faces
        faces_data = await asyncio.to_thread(face_service.get_embeddings,
                                             original_path)

        # 4. Get image size
        def get_image_size(path):
            with Image.open(path) as img:
                return img.size

        width, height = original_dimensions if original_dimensions and all(original_dimensions) else await asyncio.to_thread(get_image_size, original_path)

        # Reprocessing an interrupted photo must not duplicate partial face rows.
        await db.execute("DELETE FROM faces WHERE photo_id = ?", (photo_id,))
        for f in faces_data:
            face_id = str(uuid.uuid4())
            embedding_json = json.dumps(f["embedding"].tolist(
            ) if hasattr(f["embedding"], "tolist") else f["embedding"])
            bbox_json = json.dumps({
                "x": f["bbox"][0],
                "y": f["bbox"][1],
                "w": f["bbox"][2] - f["bbox"][0],
                "h": f["bbox"][3] - f["bbox"][1]
            })

            await db.execute(
                """
                INSERT INTO faces (id, photo_id, event_id, embedding_vector, bounding_box, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (face_id, photo_id, event_id, embedding_json, bbox_json,
                  datetime.utcnow().isoformat()))

        await db.execute(
            """
            UPDATE photos SET
                drive_file_id = ?, thumbnail_path = ?, width = ?, height = ?,
                faces_count = ?, status = ?
            WHERE id = ?
            """, (drive_file_id, thumb_path, width, height, len(faces_data),
                  "processed", photo_id))

    except Exception as e:
        print(f"Error processing photo {photo_id}: {e}")
        await db.execute("UPDATE photos SET status = ? WHERE id = ?",
                         ("error", photo_id))


@router.post("/upload")
async def upload_photos(background_tasks: BackgroundTasks,
                        event_id: str,
                        files: List[UploadFile] = File(...),
                        user=Depends(get_current_photographer)):
    row = await db.fetch_one("SELECT slug FROM events WHERE id = ? AND photographer_id = ?",
                             (event_id, user["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    event_slug = row["slug"]

    processed_count = 0
    for file in files:
        photo_id = str(uuid.uuid4())
        file_ext = file.filename.split(".")[-1]
        original_path = os.path.join(settings.UPLOAD_ROOT,
                                     f"{photo_id}.{file_ext}")

        with open(original_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        await db.execute(
            """
            INSERT INTO photos (id, event_id, original_file_name, status, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (photo_id, event_id, file.filename, "pending",
              datetime.utcnow().isoformat()))

        background_tasks.add_task(process_photo, photo_id, event_id,
                                  event_slug, original_path, file.filename)
        processed_count += 1

    return {
        "message": f"Successfully started processing {processed_count} photos",
        "event_id": event_id
    }


async def run_sync_task(event_id: str):
    try:
        row = await db.fetch_one("SELECT * FROM events WHERE id = ?",
                                 (event_id, ))
        if not row or not row.get("drive_folder_url"):
            print(
                f"Sync failed: Event {event_id} not found or no drive_folder_url"
            )
            return
        event = dict(row)

        await db.execute("UPDATE events SET sync_status = ? WHERE id = ?",
                         ("syncing", event_id))

        folder_id = drive_service.get_folder_id_from_url(
            event["drive_folder_url"])
        print(f"Starting sync for folder: {folder_id}")

        files_to_sync = await drive_service.list_files_recursive(folder_id, event["photographer_id"])
        print(f"Found {len(files_to_sync)} files in Drive total")

        new_files = []
        pending_photos = []
        for f in files_to_sync:
            existing = await db.fetch_one(
                "SELECT id, status FROM photos WHERE event_id = ? AND drive_file_id = ?", (event_id, f["id"]))
            if not existing:
                new_files.append(f)
            elif existing["status"] == "pending":
                photo_id :str = existing["id"]
                index_path = os.path.join(settings.INDEX_ROOT, f"{photo_id}.jpg")
                pending_photos.append((photo_id, index_path, f))
            else:
                print(f"Skipping already synced file: {f['name']}")

        print(f"Identified {len(pending_photos)} pending photos to index")
        print(f"Identified {len(new_files)} new photos to index")

        # Pre-register all new photos
        inserted_items = []
        for f in new_files:
            photo_id = str(uuid.uuid4())
            index_path = os.path.join(settings.INDEX_ROOT, f"{photo_id}.jpg")

            await db.execute(
                """
                INSERT INTO photos (id, event_id, original_file_name, drive_file_id, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (photo_id, event_id, f['name'], f["id"], "pending",
                  datetime.utcnow().isoformat()))
            inserted_items.append((photo_id, index_path, f))

        # download and process
        for photo_id, index_path, f in pending_photos + inserted_items:
            try:
                print(f"Indexing Drive preview: {f['name']}")
                original_dimensions = await drive_service.download_index_image(
                    f["id"], event["photographer_id"], index_path)

                await process_photo(photo_id,
                                    event_id,
                                    event["slug"],
                                    index_path,
                                    f["name"],
                                    drive_file_id=f["id"],
                                    original_dimensions=original_dimensions)
            except Exception as loop_err:
                print(f"Error processing synced photo {f['name']}: {loop_err}")
                if os.path.exists(index_path):
                    os.remove(index_path)
                await db.execute("UPDATE photos SET status = ? WHERE id = ?",
                                 ("error", photo_id))

        await db.execute(
            """
            UPDATE events SET sync_status = ?, last_sync_at = ? WHERE id = ?
        """, ("completed", datetime.utcnow().isoformat(), event_id))
        print(f"Sync completed successfully for event: {event_id}")
    except Exception as e:
        print(f"Sync task fatal error: {e}")
        await db.execute("UPDATE events SET sync_status = ? WHERE id = ?",
                         ("error", event_id))


@router.post("/sync/{event_id}")
async def start_sync(event_id: str, background_tasks: BackgroundTasks, user=Depends(get_current_photographer)):
    row = await db.fetch_one(
        "SELECT drive_folder_url, sync_status FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")

    if not row["drive_folder_url"]:
        raise HTTPException(status_code=400,
                            detail="Drive folder URL not configured")
    if row["sync_status"] == "syncing":
        raise HTTPException(status_code=409, detail="Sync is already in progress")
    connection = await db.fetch_one("SELECT photographer_id FROM drive_connections WHERE photographer_id = ?", (user["id"],))
    if not connection:
        raise HTTPException(status_code=400, detail="Connect Google Drive first")

    await db.execute("UPDATE events SET sync_status = 'syncing' WHERE id = ?", (event_id,))
    background_tasks.add_task(run_sync_task, event_id)
    return {"message": "Sync started in background"}


@router.get("/status/{event_id}")
async def get_event_status(event_id: str, user=Depends(get_current_photographer)):
    row = await db.fetch_one("SELECT * FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    event = dict(row)

    res = await db.fetch_one(
        "SELECT COUNT(*) as total FROM photos WHERE event_id = ?",
        (event_id, ))
    total = res["total"]

    res = await db.fetch_one(
        "SELECT COUNT(*) as pending FROM photos WHERE event_id = ? AND status = 'pending'",
        (event_id, ))
    pending = res["pending"]

    res = await db.fetch_one(
        "SELECT COUNT(*) as processed FROM photos WHERE event_id = ? AND status = 'processed'",
        (event_id, ))
    processed = res["processed"]

    res = await db.fetch_one(
        "SELECT COUNT(*) as errors FROM photos WHERE event_id = ? AND status = 'error'",
        (event_id, ))
    errors = res["errors"]

    res = await db.fetch_one(
        "SELECT SUM(faces_count) as total_faces FROM photos WHERE event_id = ?",
        (event_id, ))
    total_faces = res["total_faces"] or 0

    return {
        "event_id": event_id,
        "sync_status": event.get("sync_status", "idle"),
        "last_sync_at": event.get("last_sync_at"),
        "total": total,
        "pending": pending,
        "processed": processed,
        "errors": errors,
        "total_faces": total_faces,
        "progress": (processed / total * 100) if total > 0 else 0
    }


@router.get("/event/{event_id}/gallery")
async def get_event_photos(event_id: str, page: int = 1, limit: int = 100, user=Depends(get_current_photographer)):
    """Get all photos for an event with pagination"""
    await require_owned_event(event_id, user["id"])
    offset = (page - 1) * limit
    
    # Get total count
    count_result = await db.fetch_one(
        "SELECT COUNT(*) as total FROM photos WHERE event_id = ?",
        (event_id,)
    )
    total = count_result["total"]
    
    # Get photos
    photos = await db.fetch_all(
        """
        SELECT id, original_file_name, thumbnail_path, width, height, 
               faces_count, status, created_at, drive_file_id
        FROM photos 
        WHERE event_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """,
        (event_id, limit, offset)
    )
    
    return {
        "photos": [dict(p) for p in photos],
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": (total + limit - 1) // limit
    }


@router.delete("/delete/{photo_id}")
async def delete_photo(photo_id: str, user=Depends(get_current_photographer)):
    """Delete a single photo and its associated data"""
    photo = await db.fetch_one("SELECT p.* FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ? AND e.photographer_id = ?", (photo_id, user["id"]))
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    try:
        # Delete original photo files
        for ext in ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG', 'webp', 'WEBP']:
            original_path = os.path.join(settings.UPLOAD_ROOT, f"{photo_id}.{ext}")
            if os.path.exists(original_path):
                try:
                    os.remove(original_path)
                except Exception as e:
                    print(f"Error deleting original {original_path}: {e}")
        index_path = os.path.join(settings.INDEX_ROOT, f"{photo_id}.jpg")
        if os.path.exists(index_path):
            os.remove(index_path)
        
        # Delete thumbnail
        thumbnail_path = photo.get("thumbnail_path")
        if thumbnail_path and os.path.exists(thumbnail_path):
            try:
                os.remove(thumbnail_path)
            except Exception as e:
                print(f"Error deleting thumbnail {thumbnail_path}: {e}")
        
        # Delete from database
        await db.execute("DELETE FROM faces WHERE photo_id = ?", (photo_id,))
        await db.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
        
        return {"message": "Photo deleted successfully"}
    except Exception as e:
        print(f"Error deleting photo {photo_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting photo: {str(e)}")


@router.post("/delete/bulk")
async def delete_photos_bulk(photo_ids: List[str], user=Depends(get_current_photographer)):
    """Delete multiple photos and their associated data"""
    deleted_count = 0
    errors = []
    
    for photo_id in photo_ids:
        try:
            photo = await db.fetch_one("SELECT p.* FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ? AND e.photographer_id = ?", (photo_id, user["id"]))
            if not photo:
                errors.append(f"Photo {photo_id} not found")
                continue
            
            # Delete original photo files
            for ext in ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG', 'webp', 'WEBP']:
                original_path = os.path.join(settings.UPLOAD_ROOT, f"{photo_id}.{ext}")
                if os.path.exists(original_path):
                    try:
                        os.remove(original_path)
                    except Exception as e:
                        print(f"Error deleting original {original_path}: {e}")
            index_path = os.path.join(settings.INDEX_ROOT, f"{photo_id}.jpg")
            if os.path.exists(index_path):
                os.remove(index_path)
            
            # Delete thumbnail
            thumbnail_path = photo.get("thumbnail_path")
            if thumbnail_path and os.path.exists(thumbnail_path):
                try:
                    os.remove(thumbnail_path)
                except Exception as e:
                    print(f"Error deleting thumbnail {thumbnail_path}: {e}")
            
            # Delete from database
            await db.execute("DELETE FROM faces WHERE photo_id = ?", (photo_id,))
            await db.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
            deleted_count += 1
        except Exception as e:
            errors.append(f"Error deleting photo {photo_id}: {str(e)}")
            print(f"Error in bulk delete for {photo_id}: {e}")
    
    return {
        "message": f"Deleted {deleted_count} photos",
        "deleted_count": deleted_count,
        "errors": errors
    }


@router.get("/original/{photo_id}")
async def get_original(photo_id: str, guest_id: str | None = None, user=Depends(optional_user)):
    row = await authorize_photo(photo_id, guest_id, user)
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    photo = dict(row)

    local_path = None
    for ext in ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG', 'webp']:
        path = os.path.join(settings.UPLOAD_ROOT, f"{photo_id}.{ext}")
        if os.path.exists(path):
            local_path = path
            break

    if local_path:
        return FileResponse(local_path)

    if photo.get("drive_file_id"):
        try:
            content, filename = await drive_service.download_file(
                photo["drive_file_id"], photo["photographer_id"])
            if content:
                return StreamingResponse(io.BytesIO(content),
                                         media_type="image/jpeg")
        except Exception as e:
            print(f"Drive fetch error: {e}")

    raise HTTPException(status_code=404, detail="Original file not found")


@router.get("/thumbnail/{photo_id}")
async def get_thumbnail(photo_id: str, guest_id: str | None = None, user=Depends(optional_user)):
    row = await authorize_photo(photo_id, guest_id, user)
    if not row or not row["thumbnail_path"]:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    if not os.path.exists(row["thumbnail_path"]):
        raise HTTPException(status_code=404,
                            detail="Thumbnail file not found on disk")

    return FileResponse(row["thumbnail_path"])


@router.get("/preview/{photo_id}")
async def get_preview(photo_id: str, guest_id: str | None = None, user=Depends(optional_user)):
    row = await authorize_photo(photo_id, guest_id, user)
    index_path = os.path.join(settings.INDEX_ROOT, f"{photo_id}.jpg")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="image/jpeg")
    if row["thumbnail_path"] and os.path.exists(row["thumbnail_path"]):
        return FileResponse(row["thumbnail_path"], media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Preview not found")


@router.get("/download/{photo_id}")
async def download_photo(photo_id: str, guest_id: str | None = None, user=Depends(optional_user)):
    row = await authorize_photo(photo_id, guest_id, user)
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not row["drive_file_id"]:
        for ext in ["jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG", "WEBP"]:
            path = os.path.join(settings.UPLOAD_ROOT, f"{photo_id}.{ext}")
            if os.path.exists(path):
                return FileResponse(path, filename=row.get("original_file_name") or f"{photo_id}.{ext}")
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        content, filename = await drive_service.download_file(
            row["drive_file_id"], row["photographer_id"])
        if content is None:
            raise HTTPException(status_code=500,
                                detail="Failed to download from Drive")

        return StreamingResponse(io.BytesIO(content),
                                 media_type="application/octet-stream",
                                 headers={
                                     "Content-Disposition":
                                     f"attachment; filename={filename}"
                                 })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
