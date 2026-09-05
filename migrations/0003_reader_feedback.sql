-- Invite-based friend reader feedback (parallel to OWNER_REVIEW / review_jobs).
-- Does not alter review_jobs or the OWNER_REVIEW contract.

CREATE TABLE reader_invites (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL CHECK (chapter_number > 0),
  chapter_version INTEGER NOT NULL CHECK (chapter_version > 0),
  package_fingerprint TEXT NOT NULL,
  package_title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX reader_invites_book_chapter
  ON reader_invites (book_id, chapter_id, chapter_version, package_fingerprint);

CREATE TABLE reader_reviewers (
  id TEXT PRIMARY KEY NOT NULL,
  invite_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (invite_id) REFERENCES reader_invites(id)
);

CREATE INDEX reader_reviewers_invite ON reader_reviewers (invite_id);

CREATE TABLE reader_comments (
  id TEXT PRIMARY KEY NOT NULL,
  invite_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_version INTEGER NOT NULL CHECK (chapter_version > 0),
  package_fingerprint TEXT NOT NULL,
  paragraph_id TEXT NOT NULL,
  selection_start INTEGER NOT NULL CHECK (selection_start >= 0),
  selection_end INTEGER NOT NULL CHECK (selection_end > 0),
  selected_text TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invite_id) REFERENCES reader_invites(id),
  FOREIGN KEY (reviewer_id) REFERENCES reader_reviewers(id),
  CHECK (selection_end > selection_start)
);

CREATE INDEX reader_comments_invite_fingerprint
  ON reader_comments (invite_id, package_fingerprint, paragraph_id, selection_start);
CREATE INDEX reader_comments_book_chapter_fingerprint
  ON reader_comments (book_id, chapter_id, chapter_version, package_fingerprint);
