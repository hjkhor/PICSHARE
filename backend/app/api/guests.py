import asyncio
import os
import shutil
import uuid
import json
import numpy as np
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Response, Depends
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import io
import zipfile
from app.services.db import db
from app.api.auth import get_current_photographer
from app.services.drive_service import drive_service
from app.services.face_service import face_service
from app.core.config import get_settings

router = APIRouter(prefix="/guests", tags=["guests"])
settings = get_settings()

os.makedirs(settings.GUEST_SELFIES_DIR, exist_ok=True)


async def process_guest_request(request_id: str, event_id: str, selfie_path: str):
    try:
        # 1. Extract face embedding
        faces = await asyncio.to_thread(face_service.get_embeddings,
                                        selfie_path)
        if not faces:
            await db.execute(
                "UPDATE guests SET status = ?, error = ? WHERE id = ?",
                ("error", "No face detected in selfie", request_id))
            return

        guest_embedding = faces[0]["embedding"]

        # 3. Match against stored faces

        matches = []
        rows = await db.fetch_all(
            "SELECT photo_id, embedding_vector FROM faces WHERE event_id = ?",
            (event_id, ))
        for face_row in rows:
            # Embedding is stored as JSON string
            stored_embedding = np.array(
                json.loads(face_row["embedding_vector"]))
            score = await asyncio.to_thread(face_service.compute_similarity,
                                            guest_embedding, stored_embedding)
            if score >= settings.FACE_SIMILARITY_THRESHOLD:
                matches.append({
                    "photo_id": face_row["photo_id"],
                    "score": score
                })

        # Deduplicate and sort
        unique_matches = {}
        for m in matches:
            p_id = m["photo_id"]
            if p_id not in unique_matches or m["score"] > unique_matches[p_id][
                    "score"]:
                unique_matches[p_id] = m

        sorted_matches = sorted(unique_matches.values(),
                                key=lambda x: x["score"], 
                                reverse=True)[:50000]
        matched_photo_ids = [m["photo_id"] for m in sorted_matches]

        # 4. Final Update
        await db.execute(
            """
            UPDATE guests SET 
                status = ?, match_count = ?, matched_photo_ids = ? 
            WHERE id = ?
        """, ("completed", len(matched_photo_ids),
              json.dumps(matched_photo_ids), request_id))

    except Exception as e:
        print(f"Error processing guest request {request_id}: {e}")
        await db.execute(
            "UPDATE guests SET status = ?, error = ? WHERE id = ?",
            ("error", str(e), request_id))
    finally:
        # The upload is needed only while extracting and matching this request.
        try:
            os.remove(selfie_path)
        except FileNotFoundError:
            pass
        except OSError as e:
            print(f"Could not remove guest selfie {request_id}: {e}")
        await db.execute("UPDATE guests SET selfie_path = NULL WHERE id = ?",
                         (request_id, ))


@router.post("/request")
async def guest_request(background_tasks: BackgroundTasks,
                        event_slug: str = Form(...),
                        name: str = Form(...),
                        secret_code: str = Form(None),
                        selfie: UploadFile = File(...)):
    name = name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Please enter your name")
    row = await db.fetch_one(
        "SELECT id, secret_code FROM events WHERE slug = ? AND photographer_id IS NOT NULL", (event_slug, ))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")

    event_id = row["id"]
    expected_code = row["secret_code"]

    if expected_code and expected_code != secret_code:
        raise HTTPException(status_code=401, detail="Invalid secret code")

    request_id = str(uuid.uuid4())
    file_ext = selfie.filename.split(".")[-1]
    selfie_path = os.path.join(settings.GUEST_SELFIES_DIR,
                               f"{request_id}.{file_ext}")

    with open(selfie_path, "wb") as buffer:
        shutil.copyfileobj(selfie.file, buffer)

    await db.execute(
        """
        INSERT INTO guests (id, event_id, name, email, phone, selfie_path, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (request_id, event_id, name, "", None, selfie_path, "processing",
          datetime.utcnow().isoformat()))

    background_tasks.add_task(process_guest_request, request_id, event_id,
                              selfie_path)
    return {
        "message": "Your photos are being processed.",
        "request_id": request_id
    }


@router.get("/status/{request_id}")
async def get_guest_request_status(request_id: str):
    row = await db.fetch_one("SELECT g.* FROM guests g JOIN events e ON e.id = g.event_id WHERE g.id = ? AND e.photographer_id IS NOT NULL",
                             (request_id, ))
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    return {
        "status": row.get("status"),
        "match_count": row.get("match_count", 0),
        "error": row.get("error")
    }


@router.get("/event/{event_id}")
async def get_event_guests(event_id: str, user=Depends(get_current_photographer)):
    """Get all guests who have joined a specific event"""
    event = await db.fetch_one("SELECT * FROM events WHERE id = ? AND photographer_id = ?", (event_id, user["id"]))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    rows = await db.fetch_all(
        """
        SELECT id, name, email, phone, selfie_path, status, match_count, created_at 
        FROM guests 
        WHERE event_id = ? 
        ORDER BY created_at DESC
        """, (event_id, ))

    guests = []
    for row in rows:
        guests.append({
            "id": row["id"],
            "name": row["name"],
            "email": row["email"],
            "phone": row.get("phone"),
            "selfie_path": row.get("selfie_path"),
            "status": row["status"],
            "match_count": row.get("match_count", 0),
            "created_at": row["created_at"],
            "gallery_link": f"/event/{event['slug']}/guest/{row['id']}"
        })

    return {"guests": guests, "total": len(guests)}


@router.get("/selfie/{guest_id}")
async def get_guest_selfie(guest_id: str, user=Depends(get_current_photographer)):
    """Serve the guest's selfie image for avatar display"""
    row = await db.fetch_one("SELECT g.selfie_path FROM guests g JOIN events e ON e.id = g.event_id WHERE g.id = ? AND e.photographer_id = ?",
                             (guest_id, user["id"]))
    if not row or not row.get("selfie_path"):
        raise HTTPException(status_code=404, detail="Selfie not found")

    selfie_path = row["selfie_path"]
    if not os.path.exists(selfie_path):
        raise HTTPException(status_code=404, detail="Selfie file not found")

    return FileResponse(selfie_path)


@router.delete("/{guest_id}")
async def delete_guest(guest_id: str, user=Depends(get_current_photographer)):
    """Delete a guest to allow them to rescan their face"""
    row = await db.fetch_one("SELECT g.selfie_path FROM guests g JOIN events e ON e.id = g.event_id WHERE g.id = ? AND e.photographer_id = ?",
                             (guest_id, user["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="Guest not found")

    # Delete the selfie file if it exists
    selfie_path = row.get("selfie_path")
    if selfie_path and os.path.exists(selfie_path):
        try:
            os.remove(selfie_path)
        except Exception as e:
            print(f"Error deleting selfie file: {e}")

    # Delete the guest from database
    await db.execute("DELETE FROM guests WHERE id = ?", (guest_id,))

    return {"message": "Guest deleted successfully"}


@router.get("/{request_id}/matches")
async def get_guest_matches(request_id: str, page: int = 1, limit: int = 50):
    row = await db.fetch_one("SELECT g.* FROM guests g JOIN events e ON e.id = g.event_id WHERE g.id = ? AND e.photographer_id IS NOT NULL",
                             (request_id, ))
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    photo_ids = json.loads(row.get("matched_photo_ids") or "[]")
    total_matches = len(photo_ids)

    start = (page - 1) * limit
    end = start + limit
    paged_ids = photo_ids[start:end]

    if not paged_ids:
        return {
            "guest_name":
            row.get("name"),
            "match_count":
            total_matches,
            "page":
            page,
            "limit":
            limit,
            "photos": [],
            "total_pages":
            (total_matches + limit - 1) // limit if total_matches > 0 else 0
        }

    # Fetch details
    placeholders = ",".join(["?"] * len(paged_ids))
    photo_rows = await db.fetch_all(
        f"SELECT * FROM photos WHERE event_id = ? AND id IN ({placeholders})", [row["event_id"], *paged_ids])

    fetched_photos = {}
    for p in photo_rows:
        fetched_photos[p["id"]] = {
            "id": p["id"],
            "filename": p.get("original_file_name"),
            "thumbnail_url": f"/photos/thumbnail/{p['id']}?guest_id={request_id}",
            "preview_url": f"/photos/preview/{p['id']}?guest_id={request_id}",
            "original_url": f"/photos/original/{p['id']}?guest_id={request_id}",
            "drive_file_id": p.get("drive_file_id")
        }

    photos = []
    for p_id in paged_ids:
        if p_id in fetched_photos:
            photos.append(fetched_photos[p_id])

    return {
        "guest_name": row.get("name"),
        "match_count": total_matches,
        "page": page,
        "limit": limit,
        "photos": photos,
        "total_pages": (total_matches + limit - 1) // limit
    }


@router.get("/{request_id}/download-zip")
async def download_guest_zip(request_id: str):
    row = await db.fetch_one("SELECT g.* FROM guests g JOIN events e ON e.id = g.event_id WHERE g.id = ? AND e.photographer_id IS NOT NULL", (request_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    photo_ids = json.loads(row.get("matched_photo_ids") or "[]")
    if not photo_ids:
        raise HTTPException(status_code=400, detail="No photos to download")

    event = await db.fetch_one("SELECT photographer_id FROM events WHERE id = ?", (row["event_id"],))
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        placeholders = ",".join(["?"] * len(photo_ids))
        photo_rows = await db.fetch_all(
            f"SELECT * FROM photos WHERE event_id = ? AND id IN ({placeholders})", [row["event_id"], *photo_ids])

        for p in photo_rows:
            local_path = None
            for ext in ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG', 'webp']:
                path = os.path.join(settings.UPLOAD_ROOT, f"{p['id']}.{ext}")
                if os.path.exists(path):
                    local_path = path
                    break

            if local_path:
                zip_file.write(local_path,
                               p.get("original_file_name", f"{p['id']}.jpg"))
            elif p.get("drive_file_id"):
                try:
                    content, filename = await drive_service.download_file(
                        p["drive_file_id"], event["photographer_id"])
                    if content:
                        zip_file.writestr(filename, content)
                except Exception as e:
                    print(f"Zip inclusion error for {p['id']}: {e}")

    zip_data = zip_buffer.getvalue()
    return Response(
        content=zip_data,
        media_type="application/x-zip-compressed",
        headers={
            "Content-Disposition": f"attachment; filename={row['name']}_photos.zip",
            "Content-Length": str(len(zip_data))
        })
