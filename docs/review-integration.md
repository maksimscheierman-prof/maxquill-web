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

At `REVISION_READY`, the source chapter still shows **Review Changes** to open the revised package. After that package loads, the review bar separates **Review Notes (N)** from **Changes (N)**, with **View Full Chapter** as a secondary action. Reloads use that authenticated result reference with a validated local cache fallback; review, job, and revision-session state remain isolated by version and package fingerprint.

## Post-revision review (V1)

A first Owner Review is chapter-based. After a successful revision, MaxQuill defaults to the **Changes** tab so the owner does not have to reread the whole chapter or the original notes list. The header shows the version relation (`Version 1 → Version 2`). The **Review Notes** tab remains available and opens the submitted original review, read-only.

This comparison is an internal MaxQuill model. It does not change `REVIEW_READY_PACKAGE`, `OWNER_REVIEW`, paragraph contracts, or queue states. Architecture still exports a newer full package with freshly assigned `p###` IDs; MaxQuill diffs paragraph text, not IDs, so offset-shifted identifiers do not mark unchanged passages as edited.

The changes-only view shows, for each detectable paragraph change:

- kind: changed, removed, inserted, or moved when exact text uniquely relocated
- Before / After passage with neighboring context
- the original owner comment, quote, and category when the source paragraph ID still links
- whether the change is owner-requested or an additional reviser edit

Owner comments whose source paragraph has no detectable text difference are listed separately as `Review item produced no detectable text change`. They are not treated as done.

**View Full Chapter** remains a secondary action. It opens the complete revised chapter and uses the existing annotation editor on the revised package. New comments and flags belong to the revised version; they do not mutate the submitted original review. Local Accept markers stay on the revision session for that fingerprint pair.

### Review actions in V1

- **Comment** and **Flag** reuse the existing owner-review annotation contract on the revised paragraph. Removals have no revised paragraph; comment from the full chapter if needed.
- **Accept** / **Accept All** are local session markers on this exact source/result fingerprint pair. They are not owner-review fields, not accept/reject of Architecture hunks, and are not submitted.
- Submitting a post-revision review still uses the existing `OWNER_REVIEW_PACKAGE` for the new version.

Intentionally deferred: per-hunk reject, transferring old annotations onto the new package, and any cross-version paragraph-ID stability in the public contract.
