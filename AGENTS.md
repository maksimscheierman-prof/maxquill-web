# Repository Agent Instructions

MaxQuill Web is the reader/review/application layer for serialized fiction. It is not a book workspace and not the reusable Book Architecture.

## Responsibility

This repository owns reader UX, mobile review UX, Owner Review submission, review-queue transport, review status display, package ingestion, Cloudflare/backend behavior, and MaxQuill-specific persistence and APIs.

## Boundaries

- Story canon, Style Bible, chapter lifecycle, and generic Book Architecture policy belong in the book and architecture repositories, not here.
- MaxQuill implements Architecture-owned review contracts. It does not invent canon, finalize chapters, update book memory, or publish.
- When an Architecture contract change requires MaxQuill support, update this application only as needed and keep the contract boundary explicit.
- Do not copy book lore into this application, and do not put MaxQuill implementation details into book canon.
