"use strict";
const assert = require("node:assert/strict"), test = require("node:test"), api = require("../review-api.js"), contract = require("../contract.js");
const source = { schemaVersion: 1, type: "review_ready_chapter", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: 1, status: "REVIEW_READY", title: "One", exportedAt: "2026-08-28T10:00:00.000Z", content: [{ id: "p001", text: "Example paragraph." }] };
const review = () => ({ schemaVersion: 1, type: "owner_review", source: "owner", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: 1, reviewedAt: "2026-08-28T10:05:00.000Z", reviewStatus: "completed", annotations: [] });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("valid completed review submits exact package and returns a persistable queued job", async () => {
  let request; const pkg = review(); const job = await api.submitOwnerReview(pkg, source, async (url, options) => { request = { url, options }; return response(201, { jobId: "job-1", status: "QUEUED", bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1 }); }, contract);
  assert.equal(request.url, "/api/reviews"); assert.equal(request.options.method, "POST"); assert.deepEqual(JSON.parse(request.options.body), pkg); assert.equal(request.options.headers["Content-Type"], "application/json"); assert.equal(request.options.headers["X-MaxQuill-Package-Fingerprint"], job.packageFingerprint); assert.equal(job.status, "QUEUED"); assert.ok(job.submittedAt); assert.match(job.packageFingerprint, /^[a-f0-9]{64}$/); assert.equal(api.jobStorageKey(job), `maxquill.review-job.demo-book.chapter_0001.v1.${job.packageFingerprint}`);
});
test("invalid package performs no network request", async () => { let calls = 0; const pkg = review(); pkg.extra = true; await assert.rejects(api.submitOwnerReview(pkg, source, async () => { calls++; }, contract), (error) => error.kind === "validation"); assert.equal(calls, 0); });
for (const [status, kind, message] of [[401, "auth", "Cloudflare Access"], [403, "auth", "Cloudflare Access"], [409, "conflict", "different review"], [500, "rejected", "Safe failure"]]) test(`${status} submit has safe ${kind} UI error`, async () => { await assert.rejects(api.submitOwnerReview(review(), source, async () => response(status, { error: { message: "Safe failure" } }), contract), (error) => error.kind === kind && error.message.includes(message)); });
test("submit network failure retains caller state and permits another attempt", async () => { const pkg = review(); await assert.rejects(api.submitOwnerReview(pkg, source, async () => { throw new Error("socket details"); }, contract), (error) => error.kind === "submit-network" && !error.message.includes("socket")); assert.equal(pkg.reviewedAt, "2026-08-28T10:05:00.000Z"); });
test("stale FAILED package is isolated while the same package restores FAILED", async () => {
  const packageA = await api.packageIdentity(source), packageB = await api.packageIdentity({ ...source, title: "Replacement", content: [{ id: "p001", text: "Completely different draft." }] });
  const failedA = { jobId: "job-a", status: "FAILED", bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: packageA.packageFingerprint, submittedAt: "2026-08-28T10:06:00.000Z" };
  assert.deepEqual(api.normalizeJob(failedA, packageA), failedA);
  assert.equal(api.normalizeJob(failedA, packageB), null);
  assert.notEqual(api.jobStorageKey(packageA), api.jobStorageKey(packageB));
  assert.notEqual(api.reviewStorageKey(packageA), api.reviewStorageKey(packageB));
});
test("same package with QUEUED job survives reload and polling updates it", async () => {
  const identity = await api.packageIdentity(source), stored = { jobId: "job-1", status: "QUEUED", bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: identity.packageFingerprint, submittedAt: "2026-08-28T10:06:00.000Z" };
  assert.deepEqual(api.normalizeJob(stored, identity), stored);
  const job = await api.getReviewJob("job-1", identity, async (url, options) => { assert.equal(url, "/api/jobs/job-1"); assert.equal(options, undefined); return response(200, { ...stored, packageFingerprint: undefined, status: "PROCESSING" }); });
  assert.equal(job.status, "PROCESSING"); assert.equal(job.packageFingerprint, identity.packageFingerprint); assert.equal(api.normalizeJob({ ...stored, chapterVersion: 2 }, identity), null);
});
test("FAILED job exposes only the backend safe message", async () => { const job = await api.getReviewJob("job-1", source, async () => response(200, { jobId: "job-1", status: "FAILED", bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, error: { code: "REVISION_ERROR", message: "Safe failure." } })); assert.equal(job.status, "FAILED"); assert.equal(job.error.message, "Safe failure."); });
test("status network failure is distinct from submit failure", async () => { await assert.rejects(api.getReviewJob("job-1", source, async () => { throw new Error("private detail"); }), (error) => error.kind === "status-network" && error.message.startsWith("Status check failed")); });
test("REVISION_READY result loads the exact package and computes a new isolated identity", async () => {
  const revised = { ...source, chapterVersion: 2, title: "Revised", content: [{ id: "p001", text: "Revised paragraph." }] }, previous = await api.packageIdentity(source);
  let request; const loaded = await api.getReviewResult("job-1", previous, async (url, options) => { request = { url, options }; return response(200, revised); }, contract), loadedIdentity = await api.packageIdentity(loaded);
  assert.deepEqual(request, { url: "/api/jobs/job-1/result", options: undefined });
  assert.deepEqual(loaded, revised); assert.equal(Object.hasOwn(loaded, "packageFingerprint"), false); assert.match(loadedIdentity.packageFingerprint, /^[a-f0-9]{64}$/); assert.notEqual(loadedIdentity.packageFingerprint, previous.packageFingerprint);
  assert.notEqual(api.reviewStorageKey(loadedIdentity), api.reviewStorageKey(previous)); assert.equal(api.resultStorageKey("job-1"), "maxquill.result-package.job-1");
});
test("invalid and wrong-identity result packages are refused", async () => {
  const previous = await api.packageIdentity(source), invalid = { ...source, chapterVersion: 2, extra: true }, wrong = { ...source, bookId: "wrong-book", chapterVersion: 2 };
  await assert.rejects(api.getReviewResult("job-1", previous, async () => response(200, invalid), contract), (error) => error.kind === "validation");
  await assert.rejects(api.getReviewResult("job-1", previous, async () => response(200, wrong), contract), (error) => error.kind === "validation");
});
for (const status of [401, 409]) test(`result endpoint ${status} is surfaced safely`, async () => { await assert.rejects(api.getReviewResult("job-1", source, async () => response(status, { error: { message: "Safe result error." } }), contract), (error) => (status === 401 ? error.kind === "auth" : error.kind === "status")); });
