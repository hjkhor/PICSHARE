CREATE TABLE IF NOT EXISTS events (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand_name TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  code_hash TEXT,
  active_version TEXT,
  staging_version TEXT,
  staging_name TEXT,
  staging_brand_name TEXT,
  staging_date TEXT,
  staging_code_hash TEXT,
  cleanup_version TEXT,
  expected_photos INTEGER NOT NULL DEFAULT 0,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  id TEXT NOT NULL,
  filename TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (slug, version, id)
);

CREATE TABLE IF NOT EXISTS faces (
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  PRIMARY KEY (slug, version, id)
);

CREATE INDEX IF NOT EXISTS faces_event ON faces (slug, version, id);
