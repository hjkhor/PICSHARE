"""Serve one local event to the browser publisher; binds only to loopback."""

import argparse
import json
import mimetypes
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
DATA = PROJECT / "backend" / "data"
PHOTO_ID = re.compile(r"^[a-f0-9-]{36}$", re.IGNORECASE)


def load_event(slug: str):
    db_path = DATA / "app.db"
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        event = connection.execute(
            """SELECT e.name, e.slug, e.date, e.secret_code, p.brand_name
               FROM events e JOIN photographers p ON p.id = e.photographer_id
               WHERE e.slug = ?""",
            (slug,),
        ).fetchone()
        if not event:
            raise ValueError(f"No owned event with slug {slug!r}")
        rows = connection.execute(
            """SELECT id, original_file_name FROM photos
               WHERE event_id = (SELECT id FROM events WHERE slug = ?)
                 AND status = 'processed' ORDER BY created_at, id""",
            (slug,),
        ).fetchall()
        photos = {}
        total_bytes = 0
        for row in rows:
            photo_id = row["id"]
            if not PHOTO_ID.fullmatch(photo_id):
                continue
            preview = DATA / "uploads" / "indexes" / f"{photo_id}.jpg"
            thumb = DATA / "thumbnails" / f"{photo_id}.jpg"
            if not preview.is_file() or not thumb.is_file():
                continue
            size = preview.stat().st_size + thumb.stat().st_size
            if preview.stat().st_size > 1_700_000 or thumb.stat().st_size > 300_000:
                raise ValueError(f"Photo {photo_id} exceeds the per-photo upload limit")
            photos[photo_id] = {"id": photo_id, "filename": row["original_file_name"] or f"{photo_id}.jpg",
                                "preview": preview, "thumb": thumb}
            total_bytes += size
        if not photos:
            raise ValueError("No processed photos with local previews were found")
        manifest = {
            "name": event["name"], "slug": event["slug"], "date": event["date"],
            "brand_name": event["brand_name"] or "", "secret_code": event["secret_code"] or "",
            "photos": [{"id": p["id"], "filename": p["filename"]} for p in photos.values()],
            "total_bytes": total_bytes,
        }
        return manifest, photos
    finally:
        connection.close()


def make_handler(manifest, photos):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.client_address[0] not in {"127.0.0.1", "::1"}:
                self.send_error(403)
                return
            path = urlsplit(self.path).path
            if path == "/local/manifest":
                content = json.dumps(manifest).encode("utf-8")
                self.send_content(content, "application/json")
                return
            match = re.fullmatch(r"/local/photo/([a-fA-F0-9-]{36})/(preview|thumb)", path)
            if match:
                photo = photos.get(match.group(1))
                if photo:
                    self.send_file(photo[match.group(2)], "image/jpeg")
                    return
            assets = {
                "/": HERE / "publisher.html",
                "/publisher.js": HERE / ".publisher-cache" / "publisher.js",
                "/style.css": HERE / "public" / "style.css",
            }
            if path.startswith("/models/") and path.count("/") == 2:
                assets[path] = HERE / "public" / "models" / path.split("/")[-1]
            asset = assets.get(path)
            if asset and asset.is_file():
                content_type = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
                self.send_file(asset, content_type)
            else:
                self.send_error(404)

        def send_content(self, content, content_type):
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def send_file(self, path, content_type):
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with path.open("rb") as source:
                while chunk := source.read(64 * 1024):
                    self.wfile.write(chunk)

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Publish one PICSHARE event while this PC is on")
    parser.add_argument("--slug", required=True)
    args = parser.parse_args()
    event_manifest, event_photos = load_event(args.slug)
    server = ThreadingHTTPServer(("127.0.0.1", 4173), make_handler(event_manifest, event_photos))
    print(f"Serving {event_manifest['name']} ({len(event_photos)} photos) at http://127.0.0.1:4173", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
