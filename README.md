# MaxQuill Web

MaxQuill Web is a static private-reader MVP for immersive serialized fiction.

## Current MVP

- Reading Mode with library, book details, responsive chapters, progress, and reader preferences
- Review Mode with stable paragraph IDs, text annotations, editing, navigation, and review completion
- Version-bound owner notes with local persistence and JSON Review Package export
- Continue Reading and per-chapter scroll restoration

## Local preview

Serve the repository root with a static HTTP server, for example `python -m http.server 8000`. A `file:` URL cannot load the JSON files because of browser security restrictions.

## Content structure

Book metadata lives in `content/<book-id>/book.json`; chapters with status, version, and stable paragraph IDs live in `content/<book-id>/chapters/`. The small static format is suitable for automated generation. Reading and review data remain in namespaced browser `localStorage` until a backend exists.

## Cloudflare Pages

Deploy the repository root with no framework preset, build command, output directory, or environment variables.

## Future

Backend and Book Repository integration are future work. See `docs/review-integration.md` for the intended owner-review handoff.
