"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), test = require("node:test"), vm = require("node:vm"), flow = require("../review-submit-flow.js"), reviewApi = require("../review-api.js"), contract = require("../contract.js");
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

test("rendered submit button click gives immediate feedback and issues exactly one POST", async () => {
  class SubmitButton extends EventTarget {
    constructor() { super(); this.textContent = "Submit for Revision"; this.disabled = false; this.hidden = false; }
    click() { this.dispatchEvent(new Event("click", { cancelable: true })); }
  }
  const button = new SubmitButton(), ui = { completed: true, submitting: false, job: null }, requests = [];
  function render() { button.hidden = Boolean(ui.job); button.disabled = !ui.completed || ui.submitting; button.textContent = ui.submitting ? "Submitting..." : "Submit for Revision"; }
  const api = { submitOwnerReview(pkg, sourcePackage) { return reviewApi.submitOwnerReview(pkg, sourcePackage, async (url, requestOptions) => { requests.push({ url, requestOptions }); await new Promise((resolve) => setTimeout(resolve, 5)); return { ok: true, status: 201, json: async () => ({ jobId: "job-touch", status: "QUEUED", bookId: source.bookId, chapterId: source.chapterId, chapterVersion: source.chapterVersion }) }; }, contract); } };
  const setup = options(api); setup.value.persistJob = (job) => { ui.job = job; setup.state.job = job; };
  const handler = flow.createSubmitHandler({ submitAction: () => flow.submit({ ...setup.value, setSubmitting() {} }), setSubmitting(value) { ui.submitting = value; render(); }, showUnexpectedError(message) { setup.state.error = message; } });
  button.addEventListener("click", handler); render();
  assert.equal(button.textContent, "Submit for Revision"); assert.equal(button.disabled, false);
  button.click(); button.click();
  assert.equal(button.textContent, "Submitting..."); assert.equal(button.disabled, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/reviews"); assert.equal(requests[0].requestOptions.method, "POST"); assert.deepEqual(JSON.parse(requests[0].requestOptions.body), review); assert.equal(ui.job.status, "QUEUED"); assert.equal(button.hidden, true);
});

test("unexpected async submit error is visible and re-enables retry", async () => {
  const states = [], errors = [], handler = flow.createSubmitHandler({ submitAction: async () => { throw new Error("private stack detail"); }, setSubmitting(value) { states.push(value); }, showUnexpectedError(message) { errors.push(message); } });
  handler({ preventDefault() {} }); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(states, [true, false]); assert.deepEqual(errors, ["Could not submit review."]);
});

test("finish review shows a clean submit CTA without a not-submitted status", () => {
  const state = flow.reviewUiState({ completed: true }, null, false, reviewApi.STATUS_LABELS);
  assert.equal(state.completion, "Review complete"); assert.equal(state.submittedHidden, true); assert.equal(state.submitted, ""); assert.equal(state.queueHidden, true); assert.equal(state.submitHidden, false); assert.equal(state.submitDisabled, false); assert.equal(state.submitText, "Submit for Revision");
});

test("existing Submit/Queue/Revision flow is not broken", () => {
  const state = flow.reviewUiState({ completed: true }, { status: "QUEUED" }, false, reviewApi.STATUS_LABELS);
  assert.equal(state.submitText, "Submit for Revision");
  assert.equal(state.queue, "Queued");
  assert.equal(state.submitted, "Submitted");
  assert.equal(state.readerStatus, "Submitted · Queued");
  assert.equal(state.submitHidden, true);
  assert.equal(reviewApi.STATUS_LABELS.REVISION_READY, "Revision ready");
  assert.equal(reviewApi.STATUS_LABELS.FAILED, "Failed");
  assert.equal(reviewApi.STATUS_LABELS.PROCESSING, "Processing");
});

test("reader exposes revision tabs, Review Notes labeling, and full-chapter fallback", () => {
  const html = fs.readFileSync(require.resolve("../reader.html"), "utf8"), script = fs.readFileSync(require.resolve("../reader.js"), "utf8"), css = fs.readFileSync(require.resolve("../styles.css"), "utf8");
  assert.match(html, /id="open-revised-version" hidden>Review Changes/);
  assert.match(html, /id="toggle-revision-view" hidden>View Full Chapter/);
  assert.match(html, /id="tab-review-notes"[^>]*>Review Notes \(0\)/);
  assert.match(html, /id="tab-revision-changes"[^>]*>Changes \(0\)/);
  assert.match(html, /id="open-note-count">Review Notes \(0\)/);
  assert.match(html, /id="open-review-panel">Review Notes/);
  assert.doesNotMatch(html, /Read Review/);
  assert.match(html, /src="revision-diff.js"/);
  assert.match(html, /src="revision-review.js"/);
  assert.match(script, /MaxQuillRevisionReview\.revisionViewState/);
  assert.match(script, /setRevisionView\("notes"\)/);
  assert.match(script, /setRevisionView\("changes"\)/);
  assert.match(script, /setRevisionView\("full"\)/);
  assert.match(script, /showingOriginalNotes\(\)/);
  assert.match(script, /comment-chapter-title/);
  assert.match(script, /target: "chapter_title"/);
  assert.doesNotMatch(script, /Review \(\$\{review\.annotations\.length\}/);
  assert.match(script, /getReviewResult\(reviewJob\.jobId, reviewIdentity\)/);
  assert.match(script, /version=\$\{result\.chapterVersion\}&resultJob=/);
  assert.match(script, /persistRevisionSource\(reviewJob\.jobId\)/);
  assert.match(script, /attachRevisionContext\(resultJob, sourcePackage\)/);
  assert.match(css, /\.review-bar \.open-revision-button\{min-height:3\.15rem/);
  assert.match(css, /\.review-tabs\{/);
  assert.match(css, /\.revision-change\{/);
  assert.match(css, /\.chapter-title-review\{/);
  assert.match(script, /"New Version"/);
  assert.match(script, /"Old Version"/);
  assert.match(script, /"Owner Review Note"/);
  assert.match(script, /appendSide\(pair, "New Version"/);
  assert.match(script, /appendSide\(pair, "Old Version"/);
  assert.match(script, /revision-owner-anchor/);
  assert.match(script, /revision-kind-badge/);
  assert.doesNotMatch(script, /Change \$\{index \+ 1\} ·/);
  assert.match(css, /\.revision-pair\{display:grid;grid-template-columns:1fr 1fr/);
  assert.match(css, /@media\(max-width:48rem\)\{[\s\S]*?\.revision-pair\{grid-template-columns:1fr\}/);
  assert.match(css, /\.revision-owner-note\{/);
  assert.match(css, /\.revision-owner-anchor\{/);
});

test("revision comparison layout prefers New left / Old right with stacked mobile order", () => {
  const layout = require("../revision-review.js").revisionComparisonLayout();
  assert.deepEqual(layout.desktopColumns, ["new", "old"]);
  assert.deepEqual(layout.mobileStack, ["new", "old", "ownerNote"]);
  assert.equal(layout.kindBadgeSecondary, true);
});