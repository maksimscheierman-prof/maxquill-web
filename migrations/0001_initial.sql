CREATE TABLE review_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL CHECK (chapter_number > 0),
  chapter_version INTEGER NOT NULL CHECK (chapter_version > 0),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'CLAIMED', 'PROCESSING', 'REVISION_READY', 'FAILED')),
  package_fingerprint TEXT NOT NULL,
  review_package_json TEXT NOT NULL,
  result_package_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  claimed_at TEXT,
  processing_started_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  UNIQUE (book_id, chapter_id, chapter_version)
);

CREATE INDEX review_jobs_queue ON review_jobs (status, created_at);
