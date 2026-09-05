# MaxQuill backend V1

```text
Tablet -> MaxQuill -> POST OWNER_REVIEW_PACKAGE -> D1 QUEUED -> future local worker
```

The backend transports, validates, queues, and reports status. It never changes canon, revises or finalizes chapters, updates memory, accesses a book repository, or publishes content.

## Cloudflare layout

The reader remains static. Cloudflare Pages Functions handle only `/api/*`, with D1 available as `env.DB`. The migrations create `review_jobs`, its state constraint, draft-scoped uniqueness, and queue index, plus optional reader-feedback tables (`reader_invites`, `reader_reviewers`, `reader_comments`). Small owner and result packages are stored as JSON text. `POST /api/reviews` requires the exact draft fingerprint in `X-MaxQuill-Package-Fingerprint`.

The committed `wrangler.example.jsonc` is deliberately inactive. First download/compare the live Pages project configuration, then copy the example to ignored `wrangler.jsonc` and insert the real D1 ID. This prevents a placeholder ID from breaking the existing Git deployment.

## Endpoints

- `POST /api/reviews` — verified owner; validates and queues an owner review.
- `GET /api/jobs/:id` — verified owner; returns safe job status only.
- `GET /api/jobs/next` — worker; returns the oldest queued job or `{"job":null}`.
- `POST /api/jobs/:id/claim` — worker; atomically changes `QUEUED` to `CLAIMED`.
- `POST /api/jobs/:id/processing` — claiming worker; changes `CLAIMED` to `PROCESSING`.
- `POST /api/jobs/:id/result` — worker; validates a newer `REVIEW_READY_PACKAGE`. From `PROCESSING` this stores the package and changes the job to `REVISION_READY`. From `FAILED` this is allowed only when `error_code` is a result-delivery validation failure (`HTTP_400`, `INVALID_INPUT`, or `INVALID_RESULT_PACKAGE`); it does not start a second revision. An identical package against `REVISION_READY` is idempotent; a different package is rejected.
- `GET /api/jobs/:id/result` — verified owner; returns the exact stored `REVIEW_READY_PACKAGE` only after `REVISION_READY`. Earlier and failed states return `409`; corrupt or identity-mismatched stored data fails closed.
- `POST /api/jobs/:id/fail` — claiming worker; changes `CLAIMED` or `PROCESSING` to `FAILED` with safe error data.

### Reader feedback (parallel to OWNER_REVIEW)

Friend invites reuse package fingerprints and selection offsets. They never queue revision jobs or mutate owner reviews.

- `POST /api/invites` / `GET /api/invites?bookId=` — verified owner; create or list invites.
- `GET /api/invites/overview?bookId=` — verified owner; per-chapter reader comment stats.
- `GET /api/invites/comments?...` — verified owner; all comments for one draft fingerprint.
- `GET /api/invites/:token` — public; invite metadata + package URL for an active invite.
- `POST /api/invites/:token/join` — public; display name → reviewer session token.
- `GET|POST /api/reader/comments` — reader session Bearer; list or add fingerprint-bound comments.
- `POST /api/reader/finish` — reader session Bearer; mark reviewer finished.
- `POST /api/reader-comments/:id/resolve` — verified owner; resolve one reader comment.
- `/review/invite/:token` — redirects to `invite.html?token=...`.

Owner UI: `owner-feedback.html`. Reader UI: `invite.html`.

The backend stores the REVIEW_READY draft fingerprint separately from its own SHA-256 fingerprint of the canonical OWNER_REVIEW JSON. An identical review for the same draft returns the existing job. A different review for that exact draft returns `409`. A different draft fingerprint can create a separate job even when book, chapter, and version match. Existing pre-migration jobs remain preserved under isolated legacy identities.

## Authentication

Protect the private MaxQuill hostname with Cloudflare Access. Owner endpoints verify the Access JWT signature, issuer, audience, and expiry using `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`. Do not put a long-lived owner secret in browser JavaScript.

Worker endpoints additionally require `Authorization: Bearer <MAXQUILL_WORKER_TOKEN>`. Configure an Access service-token policy for the future worker as well, because Access remains the outer perimeter. Store `MAXQUILL_WORKER_TOKEN` as an encrypted Pages secret; never commit it.

## Local setup

```powershell
npx wrangler pages download config maxquill-web
npx wrangler d1 create maxquill-db
Copy-Item wrangler.example.jsonc wrangler.jsonc
# Insert the returned database_id and reconcile downloaded Pages settings.
npx wrangler d1 migrations apply maxquill-db --local
npx wrangler pages dev .
```

For local authenticated API testing, use Wrangler local variables with test-only credentials and Access settings in ignored `.dev.vars`. Never reuse production secrets locally.

## Production configuration

1. Create `maxquill-db` and bind it to the Pages project as `DB` for production and preview.
2. Apply migrations with `npx wrangler d1 migrations apply maxquill-db --remote` after reviewing the target account/database.
3. Configure `CF_ACCESS_TEAM_DOMAIN` (for example `https://team.cloudflareaccess.com`) and `CF_ACCESS_AUD` as Pages variables.
4. Configure `MAXQUILL_WORKER_TOKEN` as an encrypted Pages secret.
5. Create Access owner and future worker service-token policies, then redeploy.

The reader submits completed reviews directly and retains JSON export as a fallback.
