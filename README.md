# MaxQuill Web

MaxQuill Web is a static private-reader MVP for immersive serialized fiction.

## Current MVP

- Reading Mode with library, book details, responsive chapters, progress, and reader preferences
- Review Mode with stable paragraph IDs, text annotations, editing, navigation, and review completion
- Direct, validated Architecture `REVIEW_READY_PACKAGE` loading
- Version-bound owner notes and validated `OWNER_REVIEW_PACKAGE` export
- Continue Reading and per-chapter scroll restoration

## Local preview

Serve the repository root with a static HTTP server, for example `python -m http.server 8000`. A `file:` URL cannot load the JSON files because of browser security restrictions.

## Content structure

Demo book metadata lives in `content/demo-book/book.json`. Review candidates use the Architecture-owned contract at `content/books/<book-id>/review/chapter_####_v#.json`. MaxQuill preserves supplied paragraph IDs and stores review state in version-bound browser `localStorage`.

## Cloudflare Pages

Deploy the repository root with no framework preset, build command, output directory, or environment variables.

## Future

MaxQuill is an external owner-review client; the book repository remains the canonical source of truth. See `docs/review-integration.md` for the contract-exact handoff.
