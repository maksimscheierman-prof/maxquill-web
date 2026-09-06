"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const flow = require("../review-submit-flow.js");
const revision = require("../revision-review.js");
const reviewApi = require("../review-api.js");

function paragraph(id, text) { return { id, text }; }
function pkg(version, content, title = "Chapter") {
  return {
    schemaVersion: 1, type: "review_ready_chapter", bookId: "demo-book", chapterId: "chapter_0001",
    chapterNumber: 1, chapterVersion: version, status: "REVIEW_READY", title,
    exportedAt: "2026-08-28T10:00:00.000Z", content
  };
}

function tenChangeModel() {
  const changes = Array.from({ length: 10 }, (_, index) => {
    const id = `additional:changed:p${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      kind: "changed",
      origin: "additional_revision",
      ownerReviews: [],
      before: paragraph(`p${String(index + 1).padStart(3, "0")}`, `Old ${index + 1}.`),
      after: paragraph(`p${String(index + 1).padStart(3, "0")}`, `New ${index + 1}.`),
      sourceOwnerNoteId: null
    };
  });
  return {
    beforeVersion: 1,
    afterVersion: 2,
    titleChange: null,
    changes,
    unmatchedReviewItems: [],
    summary: { total: 10, ownerRequested: 0, additional: 10, unmatched: 0 }
  };
}

test("review with 3 OPEN items shows correct progress count", () => {
  const model = tenChangeModel();
  const accepted = model.changes.slice(0, 7).map((change) => change.id);
  const progress = revision.reviewDecisionProgress(model, { acceptedChangeIds: accepted }, []);
  assert.equal(progress.total, 10);
  assert.equal(progress.resolved, 7);
  assert.equal(progress.unresolved, 3);
  assert.equal(progress.allDecided, false);
  assert.equal(progress.firstUnresolvedId, model.changes[7].id);
  const state = flow.reviewUiState({ completed: false }, null, false, reviewApi.STATUS_LABELS, {
    progress,
    hasRevisionDecisions: true,
    packageEligible: true
  });
  assert.equal(state.progressLabel, "Review progress: 7 / 10 decisions complete");
  assert.match(state.progressDetail, /3 changes still need a decision/);
  assert.match(state.submitDisabledReason, /3 changes still need a decision/);
  assert.equal(state.submitDisabled, true);
  assert.equal(state.showJumpToOpen, true);
});

test("finish review feedback for unresolved items is actionable", () => {
  const model = tenChangeModel();
  const progress = revision.reviewDecisionProgress(model, { acceptedChangeIds: model.changes.slice(0, 7).map((c) => c.id) }, []);
  const feedback = revision.finishReviewFeedback(progress);
  assert.equal(feedback.title, "Review incomplete");
  assert.match(feedback.detail, /3 changes still need Accept, Comment, or Flag/);
  assert.equal(feedback.firstUnresolvedId, model.changes[7].id);
  assert.equal(revision.finishReviewFeedback({ ...progress, unresolved: 0, allDecided: true, unresolvedIds: [] }), null);
});

test("submit disabled reason says review is incomplete while open items remain", () => {
  const progress = { total: 10, resolved: 7, unresolved: 3, allDecided: false, firstUnresolvedId: "c8", unresolvedIds: ["c8", "c9", "c10"] };
  assert.match(flow.submitDisabledReason({
    reviewCompleted: false, submitting: false, job: null, progress, hasRevisionDecisions: true, packageEligible: true
  }), /still need a decision/);
});

test("all items resolved but not finished asks to Finish Review", () => {
  const progress = { total: 10, resolved: 10, unresolved: 0, allDecided: true, firstUnresolvedId: null, unresolvedIds: [] };
  const state = flow.reviewUiState({ completed: false }, null, false, reviewApi.STATUS_LABELS, {
    progress, hasRevisionDecisions: true, packageEligible: true
  });
  assert.equal(state.completion, "All changes reviewed");
  assert.match(state.completionDetail, /Finish Review to lock your decisions/);
  assert.match(state.submitDisabledReason, /Finish Review to lock your decisions/);
  assert.equal(state.submitDisabled, true);
  assert.equal(state.showJumpToOpen, false);
});

test("successful Finish changes UI to Review complete and enables submit", () => {
  const progress = { total: 10, resolved: 10, unresolved: 0, allDecided: true, firstUnresolvedId: null, unresolvedIds: [] };
  const state = flow.reviewUiState({ completed: true, packageFingerprint: "abc" }, null, false, reviewApi.STATUS_LABELS, {
    progress, hasRevisionDecisions: true, packageEligible: true
  });
  assert.equal(state.completion, "Review complete");
  assert.match(state.completionDetail, /All changes have been reviewed/);
  assert.equal(state.submitDisabled, false);
  assert.equal(state.showSubmitReason, false);
  assert.equal(state.submitText, "Submit for Revision");
});

test("existing revision job gives a different reason and hides submit", () => {
  const progress = { total: 10, resolved: 10, unresolved: 0, allDecided: true, firstUnresolvedId: null, unresolvedIds: [] };
  const state = flow.reviewUiState({ completed: true }, { status: "QUEUED" }, false, reviewApi.STATUS_LABELS, {
    progress, hasRevisionDecisions: true, packageEligible: true
  });
  assert.equal(state.submitHidden, true);
  assert.equal(state.queue, "Queued");
  assert.match(state.submitDisabledReason, /revision job already exists/);
  assert.equal(state.showSubmitReason, false);
});

test("stale package eligibility blocks submit with package mismatch reason", () => {
  const reason = flow.submitDisabledReason({
    reviewCompleted: true, submitting: false, job: null,
    progress: { total: 1, resolved: 1, unresolved: 0, allDecided: true },
    hasRevisionDecisions: true, packageEligible: false
  });
  assert.match(reason, /no longer matches the current package/);
});

test("accepted comment and flag states all count as resolved decisions", () => {
  const model = tenChangeModel();
  const ids = model.changes.map((change) => change.id);
  const annotations = [
    { id: "n1", revisionChangeId: ids[0], status: "open", category: "wording", comment: "Tighten.", selectedText: "New 1.", selectionStart: 0, selectionEnd: 6, paragraphId: "p001", requiresCanonChange: false, revisionFeedbackKind: "comment" },
    { id: "n2", revisionChangeId: ids[1], status: "open", category: "other", comment: "Flagged for revision.", selectedText: "New 2.", selectionStart: 0, selectionEnd: 6, paragraphId: "p002", requiresCanonChange: false, revisionFeedbackKind: "flag" }
  ];
  const progress = revision.reviewDecisionProgress(model, { acceptedChangeIds: ids.slice(2) }, annotations);
  assert.equal(progress.resolved, 10);
  assert.equal(progress.unresolved, 0);
  assert.equal(revision.changesReviewResolved(model, { acceptedChangeIds: ids.slice(2) }, annotations), true);
  assert.equal(revision.isResolvedDecisionState("accepted"), true);
  assert.equal(revision.isResolvedDecisionState("needs_revision"), true);
  assert.equal(revision.isResolvedDecisionState("flagged"), true);
  assert.equal(revision.isResolvedDecisionState("unresolved"), false);
});

test("reader wires progress UI, finish feedback, and jump-to-open affordances", () => {
  const html = fs.readFileSync(require.resolve("../reader.html"), "utf8");
  const script = fs.readFileSync(require.resolve("../reader.js"), "utf8");
  const css = fs.readFileSync(require.resolve("../styles.css"), "utf8");
  assert.match(html, /id="review-progress-label"/);
  assert.match(html, /id="review-progress-detail"/);
  assert.match(html, /id="submit-disabled-reason"/);
  assert.match(html, /id="jump-first-open"/);
  assert.match(script, /reviewDecisionProgress/);
  assert.match(script, /finishReviewFeedback/);
  assert.match(script, /jumpToFirstOpenChange|jumpToUnresolvedChange/);
  assert.match(script, /submitDisabledReason|showSubmitReason/);
  assert.match(script, /packageFingerprint === reviewIdentity\.packageFingerprint/);
  assert.match(require("fs").readFileSync(require.resolve("../revision-review.js"), "utf8"), /Review incomplete/);
  assert.match(script, /is-open[\s\S]{0,20}OPEN|OPEN/);
  assert.match(css, /\.revision-decision-badge\.is-open/);
  assert.match(css, /\.submit-disabled-reason/);
  assert.match(css, /\.review-progress-label/);
  assert.match(css, /@media\(max-width:30rem\)[\s\S]*submit-disabled-reason/);
});

test("reload-oriented progress helpers remain stable for partial and completed reviews", () => {
  const model = tenChangeModel();
  const partial = revision.reviewDecisionProgress(model, { acceptedChangeIds: model.changes.slice(0, 4).map((c) => c.id) }, []);
  assert.equal(partial.resolved, 4);
  assert.equal(partial.unresolved, 6);
  const complete = revision.reviewDecisionProgress(model, { acceptedChangeIds: model.changes.map((c) => c.id) }, []);
  assert.equal(complete.allDecided, true);
  const finished = flow.reviewUiState({ completed: true }, null, false, reviewApi.STATUS_LABELS, {
    progress: complete, hasRevisionDecisions: true, packageEligible: true
  });
  assert.equal(finished.completion, "Review complete");
  assert.equal(finished.submitDisabled, false);
});
