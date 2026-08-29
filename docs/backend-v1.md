# MaxQuill backend V1

```text
Tablet -> MaxQuill -> POST OWNER_REVIEW_PACKAGE -> D1 QUEUED -> future local worker
```

The backend transports, validates, queues, and reports status. It never changes canon, revises or finalizes chapters, updates memory, accesses a book repository, or publishes content.

## Cloudflare layout

The reader remains static. Cloudflare Pages Functions handle only `/api/*`, with D1 available as `env.DB`. The migrations create `review_jobs`, its state constraint, draft-scoped uniqueness, and queue index. Small owner and result packages are stored as JSON text. `POST /api/reviews` requires the exact draft fingerprint in `X-MaxQuill-Package-Fingerprint`.

The committed `wrangler.example.jsonc` is deliberately inactive. First download/compare the live Pages project configuration, then copy the example to ignored `wrangler.jsonc` and insert the real D1 ID. This prevents a placeholder ID from breaking the existing Git deployment.

## Endpoints

- `POST /api/reviews` — verified owner; validates and queues an owner review.
- `GET /api/jobs/:id` — verified owner; returns safe job status only.
- `GET /api/jobs/next` — worker; returns the oldest queued job or `{"job":null}`.
- `POST /api/jobs/:id/claim` — worker; atomically changes `QUEUED` to `CLAIMED`.
- `POST /api/jobs/:id/processing` — claiming worker; changes `CLAIMED` to `PROCESSING`.
- `POST /api/jobs/:id/result` — claiming worker; validates a newer `REVIEW_READY_PACKAGE` and changes `PROCESSING` to `REVISION_READY`.
- `POST /api/jobs/:id/fail` — claiming worker; changes `CLAIMED` or `PROCESSING` to `FAILED` with safe error data.

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
