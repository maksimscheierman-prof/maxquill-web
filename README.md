# MaxQuill Web

MaxQuill Web is a static private-reader MVP for immersive serialized fiction.

## Current MVP

- Library, book details, JSON-backed chapters, and responsive reader
- Persistent reader preferences, reading progress, read status, and scroll restoration
- Continue Reading from the library and book page

## Local preview

Serve the repository root with a static HTTP server, for example `python -m http.server 8000`. A `file:` URL cannot load the JSON files because of browser security restrictions.

## Content structure

Book metadata lives in `content/<book-id>/book.json`; chapters live in `content/<book-id>/chapters/`. The small static format is suitable for automated generation.

## Cloudflare Pages

Deploy the repository root with no framework preset, build command, output directory, or environment variables.

## Future

Design a publishing pipeline that exports finalized chapters from a book repository into this static content structure.
