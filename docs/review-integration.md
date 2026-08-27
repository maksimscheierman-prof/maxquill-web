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

Demo links use `reader.html?book=demo-book&chapter=1&version=1`. Local annotations use `maxquill.review.<bookId>.<chapterId>.v<chapterVersion>`, so notes never transfer automatically between versions.

## Owner review export

After Finish Review, MaxQuill constructs and validates an `OWNER_REVIEW_PACKAGE` containing only `schemaVersion`, `type`, `source`, chapter identity/version fields, `reviewedAt`, `reviewStatus`, and `annotations`. Each annotation contains only the contract-defined selection, category, comment, status, and canon-change fields. A download is blocked if its IDs, offsets, selected text, fields, or values fail validation.

The exported package returns to the Book Architecture for import and any owner-authorized revision. MaxQuill itself never writes to the book repository.
