import os
import io
import asyncio
import re
import requests
from urllib.parse import urlparse
from PIL import Image, ImageOps
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from cryptography.fernet import Fernet
from app.services.db import db
from googleapiclient.discovery import build
from app.core.config import get_settings

settings = get_settings()

class DriveService:
    def __init__(self):
        self._services = {}

    async def _get_service(self, photographer_id: str):
        row = await db.fetch_one("SELECT refresh_token FROM drive_connections WHERE photographer_id = ?", (photographer_id,))
        if not row or not settings.TOKEN_ENCRYPTION_KEY:
            raise ValueError("Photographer has not connected Google Drive")
        cached = self._services.get(photographer_id)
        if cached and cached[0] == row["refresh_token"]:
            return cached[1]
        token = Fernet(settings.TOKEN_ENCRYPTION_KEY.encode()).decrypt(row["refresh_token"].encode()).decode()
        creds = Credentials(None, refresh_token=token, token_uri="https://oauth2.googleapis.com/token",
                            client_id=settings.GOOGLE_CLIENT_ID, client_secret=settings.GOOGLE_CLIENT_SECRET,
                            scopes=["https://www.googleapis.com/auth/drive.readonly"])
        await asyncio.to_thread(creds.refresh, Request())
        service = build("drive", "v3", credentials=creds)
        self._services[photographer_id] = (row["refresh_token"], service)
        return service

    async def download_index_image(self, file_id: str, photographer_id: str, output_path: str):
        """Save a small local working image; leave the HD original in Drive."""
        service = await self._get_service(photographer_id)
        metadata = await asyncio.to_thread(
            service.files().get(fileId=file_id,
                                fields="thumbnailLink,imageMediaMetadata(width,height)").execute)
        dimensions = metadata.get("imageMediaMetadata") or {}
        original_size = (dimensions.get("width"), dimensions.get("height"))
        thumbnail_url = metadata.get("thumbnailLink")
        if thumbnail_url:
            parsed = urlparse(thumbnail_url)
            # Drive controls this URL, but limit server-side fetches to its image host.
            if parsed.scheme == "https" and parsed.hostname and (
                parsed.hostname == "googleusercontent.com" or
                parsed.hostname.endswith(".googleusercontent.com")
            ):
                preview_url = re.sub(r"=s\d+$", f"=s{settings.INDEX_MAX_DIMENSION}", thumbnail_url)
                try:
                    def fetch_preview():
                        response = requests.get(preview_url,
                                                headers={"Authorization": f"Bearer {service._http.credentials.token}"},
                                                timeout=30)
                        response.raise_for_status()
                        with Image.open(io.BytesIO(response.content)) as image:
                            image.load()
                            if max(image.size) < 640:
                                raise ValueError("Drive preview is too small for face indexing")
                            if image.format == "JPEG":
                                with open(output_path, "wb") as target:
                                    target.write(response.content)
                            else:
                                ImageOps.exif_transpose(image).convert("RGB").save(output_path, "JPEG", quality=85)
                    await asyncio.to_thread(fetch_preview)
                    return original_size
                except (requests.RequestException, OSError, ValueError) as error:
                    print(f"Drive preview unavailable for {file_id}; using original temporarily: {error}")

        content, _ = await self.download_file(file_id, photographer_id)
        def compress_original():
            with Image.open(io.BytesIO(content)) as image:
                source_size = image.size
                preview = ImageOps.exif_transpose(image)
                preview.thumbnail((settings.INDEX_MAX_DIMENSION, settings.INDEX_MAX_DIMENSION))
                preview.convert("RGB").save(output_path, "JPEG", quality=85)
                return source_size
        fallback_size = await asyncio.to_thread(compress_original)
        return original_size if all(original_size) else fallback_size

    async def download_file(self, file_id: str, photographer_id: str):
        service = await self._get_service(photographer_id)
        file_metadata = await asyncio.to_thread(service.files().get(fileId=file_id, fields="name").execute)
        from googleapiclient.http import MediaIoBaseDownload
        request = service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = await asyncio.to_thread(downloader.next_chunk)
        return fh.getvalue(), file_metadata.get("name", "photo.jpg")

    def get_folder_id_from_url(self, url: str):
        """Extracts folder ID from a variety of Google Drive URL formats."""
        if not url: return None
        import re
        # Support /folders/ID or ?id=ID formats
        match = re.search(r'folders/([a-zA-Z0-9-_]+)', url)
        if match: return match.group(1)
        match = re.search(r'id=([a-zA-Z0-9-_]+)', url)
        if match: return match.group(1)
        return url # Assume it's already an ID if no match

    async def list_files_recursive(self, folder_id: str, photographer_id: str):
        """Recursively lists all files in a folder and its subfolders with pagination support."""
        service = await self._get_service(photographer_id)
        
        all_files = []
        
        async def _walk(current_folder_id, folder_name="root"):
            print(f"Scanning Drive folder: {folder_name} ({current_folder_id})")
            query = f"'{current_folder_id}' in parents and trashed = false"
            page_token = None
            
            while True:
                try:
                    results = await asyncio.to_thread(service.files().list(
                        q=query,
                        spaces='drive',
                        fields="nextPageToken, files(id, name, mimeType, size)",
                        pageToken=page_token,
                        supportsAllDrives=True,
                        includeItemsFromAllDrives=True
                    ).execute)
                    
                    items = results.get('files', [])
                    print(f" - Found {len(items)} items in {folder_name}")
                    
                    for item in items:
                        if item['mimeType'] == 'application/vnd.google-apps.folder':
                            await _walk(item['id'], item['name'])
                        elif 'image/' in item['mimeType']:
                            all_files.append(item)
                    
                    page_token = results.get('nextPageToken')
                    if not page_token:
                        break
                except Exception as e:
                    print(f"Error scanning folder {current_folder_id}: {e}")
                    raise
                    
        await _walk(folder_id)
        return all_files

drive_service = DriveService()
