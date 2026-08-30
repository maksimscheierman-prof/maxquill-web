# Review integration

```text
Book Architecture
    -> REVIEW_READY_PACKAGE
    -> MaxQuill
    -> OWNER_REVIEW_PACKAGE
    -> Architecture Import
```

MaxQuill is an external owner-review client. The book repository remains the canonical source of truth. MaxQuill does not change canon, revise or finalize chapters, update memory, publish, or reconcile annotations between versions.

## Review candidates

The reader loads Architecture schema-version-1 packages directly from `content/books/<book-id>/review/chapter_####_v#.json`. It validates the exact top-level and paragraph fields before rendering. Invalid packages are rejected without repair. Supplied paragraph IDs and order remain unchanged.

Demo links use `reader.html?book=demo-book&chapter=1&version=1`. Local annotations and jobs are keyed by book, chapter, version, and a deterministic SHA-256 fingerprint of the exact review-ready draft, so state never transfers automatically between drafts or versions.

## Owner review export

After Finish Review, MaxQuill constructs and validates an `OWNER_REVIEW_PACKAGE` containing only `schemaVersion`, `type`, `source`, chapter identity/version fields, `reviewedAt`, `reviewStatus`, and `annotations`. Each annotation contains only the contract-defined selection, category, comment, status, and canon-change fields. A download is blocked if its IDs, offsets, selected text, fields, or values fail validation.

The exported package returns to the Book Architecture for import and any owner-authorized revision. MaxQuill itself never writes to the book repository.

## Backend submission

After completion, the same contract-valid `OWNER_REVIEW_PACKAGE` is submitted through the authenticated Cloudflare Access browser session. The draft fingerprint travels separately in `X-MaxQuill-Package-Fingerprint`, leaving the owner-review contract exact. MaxQuill stores the returned job ID against that exact draft identity and restores queue status after a reload.

At `REVISION_READY`, the reader shows an explicit **Open revised version** action. It loads the exact stored result contract from `GET /api/jobs/:id/result`, validates its identity, computes the new package fingerprint, and opens a URL containing the new version and result-job reference. Reloads use that authenticated reference with a validated local cache fallback; review and job state remain isolated by version and fingerprint.
