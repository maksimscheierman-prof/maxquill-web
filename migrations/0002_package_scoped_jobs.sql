CREATE TABLE review_jobs_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL CHECK (chapter_number > 0),
  chapter_version INTEGER NOT NULL CHECK (chapter_version > 0),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'CLAIMED', 'PROCESSING', 'REVISION_READY', 'FAILED')),
  package_fingerprint TEXT NOT NULL,
  review_fingerprint TEXT NOT NULL,
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
  UNIQUE (book_id, chapter_id, chapter_version, package_fingerprint)
);

INSERT INTO review_jobs_v2 (
  id, book_id, chapter_id, chapter_number, chapter_version, status,
  package_fingerprint, review_fingerprint, review_package_json, result_package_json,
  created_at, updated_at, claimed_at, processing_started_at, completed_at, failed_at,
  error_code, error_message, attempt_count, worker_id
)
SELECT
  id, book_id, chapter_id, chapter_number, chapter_version, status,
  'legacy:' || package_fingerprint, package_fingerprint, review_package_json, result_package_json,
  created_at, updated_at, claimed_at, processing_started_at, completed_at, failed_at,
  error_code, error_message, attempt_count, worker_id
FROM review_jobs;

DROP TABLE review_jobs;
ALTER TABLE review_jobs_v2 RENAME TO review_jobs;
CREATE INDEX review_jobs_queue ON review_jobs (status, created_at);
