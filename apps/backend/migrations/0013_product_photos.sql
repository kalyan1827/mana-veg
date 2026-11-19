CREATE TABLE IF NOT EXISTS product_photos (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created INTEGER NOT NULL
);
