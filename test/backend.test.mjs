import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { requireOwner, requireWorker } from "../functions/_lib/auth.mjs";
import { validateOwnerReview } from "../functions/_lib/contract.mjs";
import { ApiError } from "../functions/_lib/errors.mjs";
import { MAX_BODY_BYTES, readJson } from "../functions/_lib/request.mjs";
import { ReviewQueueService } from "../functions/_lib/service.mjs";

const source = JSON.parse(fs.readFileSync(new URL("../content/books/demo-book/review/chapter_0001_v1.json", import.meta.url)));
const note = { id: "note-1", paragraphId: "p001", selectedText: source.content[0].text.substring(0, 3), selectionStart: 0, selectionEnd: 3, category: "wording", comment: "Revise this.", status: "open", requiresCanonChange: false };
const review = () => ({ schemaVersion: 1, type: "owner_review", source: "owner", bookId: source.bookId, chapterId: source.chapterId, chapterNumber: source.chapterNumber, chapterVersion: source.chapterVersion, reviewedAt: "2026-08-28T10:00:00.000Z", reviewStatus: "completed", annotations: [{ ...note }] });
const resultPackage = () => ({ ...source, chapterVersion: 2, exportedAt: "2026-08-28T11:00:00.000Z" });
const clone = (value) => JSON.parse(JSON.stringify(value));

class MemoryStore {
  constructor() { this.rows = []; }
  async byVersion(book, chapter, version) { return this.rows.find((row) => row.book_id === book && row.chapter_id === chapter && row.chapter_version === version) || null; }
  async byId(id) { return this.rows.find((row) => row.id === id) || null; }
  async create(job) { const row = { id: job.id, book_id: job.bookId, chapter_id: job.chapterId, chapter_number: job.chapterNumber, chapter_version: job.chapterVersion, status: "QUEUED", package_fingerprint: job.fingerprint, review_package_json: job.reviewJson, created_at: job.now, updated_at: job.now, worker_id: null, error_code: null, error_message: null }; this.rows.push(row); return row; }
  async next() { return this.rows.find((row) => row.status === "QUEUED") || null; }
  async transition(id, from, to, workerId, now, changes = {}) { const row = await this.byId(id); if (!row || row.status !== from || (from !== "QUEUED" && row.worker_id !== workerId)) return null; row.status = to; row.updated_at = now; if (to === "CLAIMED") row.worker_id = workerId; if (to === "REVISION_READY") row.result_package_json = changes.resultJson; if (to === "FAILED") { row.error_code = changes.errorCode; row.error_message = changes.errorMessage; } return row; }
}
function queue() { let id = 0; return new ReviewQueueService(new MemoryStore(), { now: () => "2026-08-28T12:00:00.000Z", uuid: () => `job-${++id}` }); }
async function expectApi(promise, status, code) { await assert.rejects(promise, (error) => error instanceof ApiError && error.status === status && error.code === code); }

test("valid review queues and identical duplicate is idempotent", async () => { const service = queue(), first = await service.submit(review()), duplicate = await service.submit(review()); assert.equal(first.created, true); assert.equal(first.job.status, "QUEUED"); assert.equal(duplicate.created, false); assert.equal(duplicate.job.jobId, first.job.jobId); });
test("different review for the same version conflicts", async () => { const service = queue(); await service.submit(review()); const changed = review(); changed.annotations[0].comment = "Different."; await expectApi(service.submit(changed), 409, "REVIEW_VERSION_CONFLICT"); });
for (const [name, mutate] of [["unknown top-level field", (pkg) => { pkg.secret = "no"; }], ["invalid category", (pkg) => { pkg.annotations[0].category = "flag"; }], ["empty comment", (pkg) => { pkg.annotations[0].comment = " "; }], ["invalid schemaVersion", (pkg) => { pkg.schemaVersion = 2; }]]) test(`${name} is rejected`, async () => { const pkg = review(); mutate(pkg); assert.equal(validateOwnerReview(pkg).valid, false); await expectApi(queue().submit(pkg), 400, "INVALID_REVIEW_PACKAGE"); });
test("oversized bodies are rejected before parsing", async () => { const request = new Request("https://example.test/api/reviews", { method: "POST", headers: { "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) }, body: "{}" }); await expectApi(readJson(request), 413, "PAYLOAD_TOO_LARGE"); });
test("job lifecycle enforces atomic claim and valid transitions", async () => { const service = queue(), submitted = await service.submit(review()), id = submitted.job.jobId; assert.equal((await service.claim(id, { workerId: "worker-1" })).status, "CLAIMED"); await expectApi(service.claim(id, { workerId: "worker-2" }), 409, "INVALID_JOB_STATE"); assert.equal((await service.processing(id, { workerId: "worker-1" })).status, "PROCESSING"); assert.equal((await service.result(id, { workerId: "worker-1", reviewReadyPackage: resultPackage() })).status, "REVISION_READY"); await expectApi(service.processing(id, { workerId: "worker-1" }), 409, "INVALID_JOB_STATE"); });
test("claimed or processing jobs can fail, queued jobs cannot skip states", async () => { const service = queue(), id = (await service.submit(review())).job.jobId; await expectApi(service.processing(id, { workerId: "worker-1" }), 409, "INVALID_JOB_STATE"); await service.claim(id, { workerId: "worker-1" }); assert.equal((await service.fail(id, { workerId: "worker-1", errorCode: "REVISION_ERROR", errorMessage: "Safe failure." })).status, "FAILED"); await expectApi(service.processing(id, { workerId: "worker-1" }), 409, "INVALID_JOB_STATE"); });
test("worker identity cannot take over another worker's claim", async () => { const service = queue(), id = (await service.submit(review())).job.jobId; await service.claim(id, { workerId: "worker-1" }); await expectApi(service.processing(id, { workerId: "worker-2" }), 409, "INVALID_JOB_STATE"); });
test("owner auth rejects missing assertion and accepts verified Access identity", async () => { const request = new Request("https://example.test/api/reviews"); await expectApi(requireOwner(request, {}, async () => false), 401, "UNAUTHORIZED"); const asserted = new Request(request, { headers: { "cf-access-jwt-assertion": "signed" } }); await requireOwner(asserted, {}, async (token) => token === "signed"); });
test("worker auth rejects absent and wrong tokens", async () => { const url = "https://example.test/api/jobs/next"; await expectApi(requireWorker(new Request(url), { MAXQUILL_WORKER_TOKEN: "correct" }), 401, "UNAUTHORIZED"); await expectApi(requireWorker(new Request(url, { headers: { authorization: "Bearer wrong" } }), { MAXQUILL_WORKER_TOKEN: "correct" }), 403, "FORBIDDEN"); await requireWorker(new Request(url, { headers: { authorization: "Bearer correct" } }), { MAXQUILL_WORKER_TOKEN: "correct" }); });
test("owner credentials do not authorize worker routes", async () => { const request = new Request("https://example.test/api/jobs/next", { headers: { "cf-access-jwt-assertion": "owner" } }); await expectApi(requireWorker(request, { MAXQUILL_WORKER_TOKEN: "worker" }), 401, "UNAUTHORIZED"); });
test("all Pages Function route modules load", async () => {
  const modules = await Promise.all([
    import("../functions/api/reviews.js"), import("../functions/api/jobs/next.js"), import("../functions/api/jobs/[id].js"),
    import("../functions/api/jobs/[id]/claim.js"), import("../functions/api/jobs/[id]/processing.js"), import("../functions/api/jobs/[id]/result.js"), import("../functions/api/jobs/[id]/fail.js")
  ]);
  modules.forEach((module) => assert.equal(typeof module.onRequest, "function"));
});
