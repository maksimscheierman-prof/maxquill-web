"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), test = require("node:test"), vm = require("node:vm"), flow = require("../review-submit-flow.js"), contract = require("../contract.js");
const source = { schemaVersion: 1, type: "review_ready_chapter", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: 1, status: "REVIEW_READY", title: "One", exportedAt: "2026-08-28T10:00:00.000Z", content: [{ id: "p001", text: "Example paragraph." }] };
const review = { schemaVersion: 1, type: "owner_review", source: "owner", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: 1, reviewedAt: "2026-08-28T10:05:00.000Z", reviewStatus: "completed", annotations: [] };

test("browser submit path has bound root and POSTs without ReferenceError", async () => {
  let request; const context = { MaxQuillReviewContract: contract, fetch: async (url, options) => { request = { url, options }; return { ok: true, status: 201, json: async () => ({ jobId: "job-1", status: "QUEUED", bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1 }) }; }, crypto, Date, setTimeout, clearTimeout };
  context.globalThis = context; vm.runInNewContext(fs.readFileSync(require.resolve("../review-api.js"), "utf8"), context);
  const job = await context.MaxQuillReviewApi.submitOwnerReview(review, source);
  assert.equal(job.status, "QUEUED"); assert.equal(request.url, "/api/reviews"); assert.deepEqual(JSON.parse(request.options.body), review);
});

function options(api) {
  const events = [], state = { panelOpen: true, error: null, job: null, success: null };
  return { state, events, value: { api, buildPackage: () => review, sourcePackage: source, persistJob(job) { state.job = job; events.push("persist"); }, async refreshJobStatus() { events.push("refresh"); }, startPolling() { events.push("poll"); }, setSubmitting(value) { events.push(value ? "submitting" : "idle"); }, showError(message) { state.error = message; }, showSuccess(title, detail) { state.success = { title, detail }; events.push("success"); }, closePanel() { state.panelOpen = false; events.push("close"); }, formatError(error) { return error.message; } } };
}
test("actual reader submit flow persists, confirms, closes, and restores queued status", async () => { const setup = options({ submitOwnerReview: async () => ({ jobId: "job-1", status: "QUEUED" }) }); const job = await flow.submit(setup.value); assert.equal(job.status, "QUEUED"); assert.deepEqual(setup.state.success, { title: "Review submitted", detail: "Queued for revision" }); assert.equal(setup.state.panelOpen, false); assert.deepEqual(setup.events, ["submitting", "persist", "success", "close", "refresh", "poll", "idle"]); });
test("submit failure keeps panel open, preserves review, and permits retry", async () => { const setup = options({ submitOwnerReview: async () => { throw new Error("Submit failed"); } }); assert.equal(await flow.submit(setup.value), null); assert.equal(setup.state.panelOpen, true); assert.equal(setup.state.job, null); assert.equal(setup.state.error, "Submit failed"); assert.deepEqual(review.annotations, []); assert.deepEqual(setup.events, ["submitting", "idle"]); });
test("idempotent existing job response follows the normal success path", async () => { const existing = { jobId: "job-existing", status: "PROCESSING" }; const setup = options({ submitOwnerReview: async () => existing }); assert.equal(await flow.submit(setup.value), existing); assert.equal(setup.state.job.jobId, "job-existing"); assert.equal(setup.state.panelOpen, false); });
