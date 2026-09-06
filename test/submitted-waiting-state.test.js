"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const flow = require("../review-submit-flow.js");
const revision = require("../revision-review.js");
const reviewApi = require("../review-api.js");

const labels = reviewApi.STATUS_LABELS;

test("active unsubmitted review stays in reviewing modes", () => {
  assert.equal(flow.reviewWorkspaceMode({ review: { completed: false }, job: null }), "reviewing");
  assert.equal(flow.reviewWorkspaceMode({ review: { completed: true }, job: null }), "complete_unsubmitted");
  const active = revision.revisionViewState({
    hasRevisionPair: true, viewMode: "changes", jobStatus: null, workspaceMode: "reviewing",
    changeCount: 11, beforeVersion: 1, afterVersion: 2
  });
  assert.equal(active.showChanges, true);
  assert.equal(active.tabsHidden, false);
  assert.equal(active.showWaitingPanel, false);
  assert.match(active.changesLabel, /Changes \(11\)/);
});

test("successful submit switches to submitted waiting mode for QUEUED", () => {
  assert.equal(flow.reviewWorkspaceMode({ review: { completed: true }, job: { status: "QUEUED" } }), "submitted_waiting");
  const copy = flow.submittedWorkspaceCopy({
    job: { status: "QUEUED" }, chapterVersion: 2, beforeVersion: 1, afterVersion: 2, hasRevisionPair: true
  });
  assert.equal(copy.title, "Revision queued");
  assert.match(copy.summary, /Version 1 → Version 2/);
  assert.match(copy.nextLabel, /Preparing Version 3/);
  const view = revision.revisionViewState({
    hasRevisionPair: true, viewMode: "changes", jobStatus: "QUEUED", workspaceMode: "submitted_waiting",
    changeCount: 11, beforeVersion: 1, afterVersion: 2
  });
  assert.equal(view.showWaitingPanel, true);
  assert.equal(view.showChanges, false);
  assert.equal(view.tabsHidden, true);
  assert.equal(view.openRevisedHidden, true);
  assert.match(view.versionLabel, /submitted/i);
});

test("PROCESSING displays revision in progress and hides active controls metadata", () => {
  assert.equal(flow.reviewWorkspaceMode({ review: { completed: true }, job: { status: "PROCESSING" } }), "submitted_waiting");
  assert.equal(flow.reviewWorkspaceMode({ review: { completed: true }, job: { status: "CLAIMED" } }), "submitted_waiting");
  const copy = flow.submittedWorkspaceCopy({
    job: { status: "PROCESSING" }, chapterVersion: 2, beforeVersion: 1, afterVersion: 2, hasRevisionPair: true
  });
  assert.equal(copy.title, "Revision in progress");
  const ui = flow.reviewUiState({ completed: true }, { status: "PROCESSING" }, false, labels, {
    workspaceMode: "submitted_waiting", hasRevisionDecisions: true
  });
  assert.equal(ui.submitHidden, true);
  assert.equal(ui.finishHidden, true);
  assert.match(ui.completion, /submitted|progress|complete/i);
});

test("reload-oriented state remains waiting while QUEUED or PROCESSING", () => {
  for (const status of ["QUEUED", "PROCESSING"]) {
    const mode = flow.reviewWorkspaceMode({ review: { completed: true, packageFingerprint: "abc" }, job: { status, packageFingerprint: "abc" } });
    assert.equal(mode, "submitted_waiting");
    const view = revision.revisionViewState({
      hasRevisionPair: true, viewMode: "changes", jobStatus: status, workspaceMode: mode,
      inspectSubmitted: false, beforeVersion: 1, afterVersion: 2, changeCount: 11
    });
    assert.equal(view.showWaitingPanel, true);
    assert.equal(view.showChanges, false);
  }
});

test("submitted review can be opened read-only without mutation affordances", () => {
  const view = revision.revisionViewState({
    hasRevisionPair: true, viewMode: "changes", jobStatus: "QUEUED", workspaceMode: "submitted_waiting",
    inspectSubmitted: true, beforeVersion: 1, afterVersion: 2, changeCount: 11
  });
  assert.equal(view.readOnlyReview, true);
  assert.equal(view.showWaitingPanel, false);
  assert.equal(view.showChanges, true);
  assert.equal(view.tabsHidden, true);
  assert.match(view.submittedReviewLabel, /Back to Status|Submitted/);
  const session = revision.setInspectSubmitted(revision.defaultSession("a", "b"), true);
  assert.equal(session.inspectSubmitted, true);
  assert.equal(revision.normalizeSession(session, { packageFingerprint: "a", bookId: "demo-book", chapterId: "chapter_0001" }, { packageFingerprint: "b", bookId: "demo-book", chapterId: "chapter_0001" }).inspectSubmitted, true);
});

test("REVISION_READY produces New Revision Ready CTA for next version", () => {
  assert.equal(flow.reviewWorkspaceMode({ review: { completed: true }, job: { status: "REVISION_READY" } }), "revision_ready");
  const copy = flow.submittedWorkspaceCopy({
    job: { status: "REVISION_READY" }, chapterVersion: 2, beforeVersion: 1, afterVersion: 2, hasRevisionPair: true
  });
  assert.match(copy.title, /Version 3 is ready|New revision ready/);
  assert.equal(copy.ctaLabel, "Review Version 3");
  const view = revision.revisionViewState({
    hasRevisionPair: true, viewMode: "changes", jobStatus: "REVISION_READY", workspaceMode: "revision_ready",
    beforeVersion: 1, afterVersion: 2
  });
  assert.equal(view.showWaitingPanel, true);
  assert.equal(view.openRevisedHidden, false);
  assert.equal(view.openRevisedLabel, "Review Version 3");
  assert.equal(view.nextVersion, 3);
});

test("FAILED produces failure state without active review workspace", () => {
  assert.equal(flow.reviewWorkspaceMode({ review: { completed: true }, job: { status: "FAILED" } }), "revision_failed");
  const copy = flow.submittedWorkspaceCopy({
    job: { status: "FAILED" }, chapterVersion: 2, beforeVersion: 1, afterVersion: 2, hasRevisionPair: true,
    errorMessage: "Reviser unavailable."
  });
  assert.equal(copy.title, "Revision failed");
  assert.match(copy.detail, /Reviser unavailable/);
  const view = revision.revisionViewState({
    hasRevisionPair: true, viewMode: "changes", jobStatus: "FAILED", workspaceMode: "revision_failed",
    beforeVersion: 1, afterVersion: 2, changeCount: 11
  });
  assert.equal(view.showWaitingPanel, true);
  assert.equal(view.showChanges, false);
  assert.equal(view.tabsHidden, true);
});

test("stale package fingerprints do not share submitted workspace mode", () => {
  const left = flow.reviewWorkspaceMode({ review: { completed: true }, job: { status: "QUEUED", packageFingerprint: "1".repeat(64) } });
  const right = flow.reviewWorkspaceMode({ review: { completed: false }, job: null });
  assert.equal(left, "submitted_waiting");
  assert.equal(right, "reviewing");
  const isolated = revision.normalizeSession(
    { sourceFingerprint: "old", resultFingerprint: "old2", viewMode: "changes", acceptedChangeIds: ["x"], inspectSubmitted: true },
    { packageFingerprint: "new", bookId: "demo-book", chapterId: "chapter_0001" },
    { packageFingerprint: "new2", bookId: "demo-book", chapterId: "chapter_0001" }
  );
  assert.equal(isolated.inspectSubmitted, false);
  assert.deepEqual(isolated.acceptedChangeIds, []);
});

test("reader wires waiting panel, read-only banner, and hides active queue after submit", () => {
  const html = fs.readFileSync(require.resolve("../reader.html"), "utf8");
  const script = fs.readFileSync(require.resolve("../reader.js"), "utf8");
  const css = fs.readFileSync(require.resolve("../styles.css"), "utf8");
  assert.match(script, /reviewWorkspaceMode/);
  assert.match(script, /submittedWorkspaceCopy/);
  assert.match(script, /renderSubmittedWaiting/);
  assert.match(script, /Submitted Review — Read Only|revision-readonly-banner/);
  assert.match(script, /isSubmittedLocked|reviewMutationsAllowed/);
  assert.match(require("fs").readFileSync(require.resolve("../review-submit-flow.js"), "utf8"), /Preparing Version|Revision queued|Revision in progress/);
  assert.match(script, /renderSubmittedWaiting/);
  assert.match(css, /\.revision-waiting-panel/);
  assert.match(css, /data-revision-view=waiting/);
  assert.match(html, /id="open-revised-version"/);
});

test("source-page REVISION_READY still exposes an open CTA without a revision pair", () => {
  const view = revision.revisionViewState({
    hasRevisionPair: false, viewMode: "changes", jobStatus: "REVISION_READY",
    workspaceMode: "revision_ready", afterVersion: 1
  });
  assert.equal(view.openRevisedHidden, false);
  assert.equal(view.openRevisedLabel, "Review Version 2");
  assert.equal(view.showWaitingPanel, true);
});
