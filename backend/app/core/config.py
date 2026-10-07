from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/auth/google/callback"
    FRONTEND_URL: str = "http://localhost:3005"
    TOKEN_ENCRYPTION_KEY: str = ""
    GOOGLE_CREDENTIALS_FILE: str = "credentials.json"


    FACE_SIMILARITY_THRESHOLD: float = 0.6

    SECRET_KEY: str = "ThisIsMyLongSecretKeyForJWT"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    DB_PATH: str = "data/app.db"
    UPLOAD_ROOT: str = "data/uploads/originals"
    INDEX_ROOT: str = "data/uploads/indexes"
    INDEX_MAX_DIMENSION: int = 1600
    THUMBNAIL_ROOT: str = "data/thumbnails"
    FACE_MODEL_ROOT: str = "data/insightface"
    GUEST_SELFIES_DIR: str = "data/uploads/selfies"
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings():
    return Settings()
