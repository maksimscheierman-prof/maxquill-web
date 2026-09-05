"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const diff = require("../revision-diff.js");
const revision = require("../revision-review.js");

function paragraph(id, text) { return { id, text }; }
function pkg(version, content, title = "Chapter") {
  return { schemaVersion: 1, type: "review_ready_chapter", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: version, status: "REVIEW_READY", title, exportedAt: "2026-08-28T10:00:00.000Z", content };
}
function note(id, paragraphId, selectedText, comment, category = "wording") {
  return { id, paragraphId, selectedText, selectionStart: 0, selectionEnd: selectedText.length, category, comment, status: "open", requiresCanonChange: false };
}

test("unchanged paragraph is not shown even when IDs shift", () => {
  const before = [paragraph("p001", "Alpha stays."), paragraph("p002", "Bravo stays."), paragraph("p003", "Charlie is removed.")];
  const after = [paragraph("p001", "Alpha stays."), paragraph("p002", "Bravo stays.")];
  const changes = diff.diffParagraphs(before, after);
  assert.deepEqual(changes.map((change) => change.kind), ["removed"]);
  assert.equal(changes[0].before.text, "Charlie is removed.");
  assert.equal(changes[0].after, null);
});

test("changed paragraph is shown as before and after", () => {
  const changes = diff.diffParagraphs(
    [paragraph("p001", "The lantern was dim."), paragraph("p002", "Unchanged close.")],
    [paragraph("p001", "The lantern burned low."), paragraph("p002", "Unchanged close.")]
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "changed");
  assert.equal(changes[0].before.text, "The lantern was dim.");
  assert.equal(changes[0].after.text, "The lantern burned low.");
  assert.ok(changes[0].inline.some((token) => token.type === "removed"));
  assert.ok(changes[0].inline.some((token) => token.type === "inserted"));
});

test("deleted paragraph is shown", () => {
  const changes = diff.diffParagraphs(
    [paragraph("p001", "Keep."), paragraph("p002", "Drop this sentence."), paragraph("p003", "Keep too.")],
    [paragraph("p001", "Keep."), paragraph("p002", "Keep too.")]
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "removed");
  assert.equal(changes[0].before.text, "Drop this sentence.");
});

test("inserted paragraph is shown", () => {
  const changes = diff.diffParagraphs(
    [paragraph("p001", "Keep."), paragraph("p002", "Keep too.")],
    [paragraph("p001", "Keep."), paragraph("p002", "A new beat arrives."), paragraph("p003", "Keep too.")]
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "inserted");
  assert.equal(changes[0].after.text, "A new beat arrives.");
  assert.equal(changes[0].before, null);
});

test("moved paragraph is labeled when the exact text is uniquely relocatable", () => {
  const changes = diff.diffParagraphs(
    [paragraph("p001", "Alpha."), paragraph("p002", "Bravo moves."), paragraph("p003", "Charlie."), paragraph("p004", "Delta.")],
    [paragraph("p001", "Alpha."), paragraph("p002", "Charlie."), paragraph("p003", "Delta."), paragraph("p004", "Bravo moves.")]
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "moved");
  assert.equal(changes[0].before.text, "Bravo moves.");
  assert.equal(changes[0].after.text, "Bravo moves.");
});

test("owner review item links to the resulting change", () => {
  const before = pkg(1, [paragraph("p001", "Nothing about him suggested power."), paragraph("p002", "The street stayed quiet.")]);
  const after = pkg(2, [paragraph("p001", "The street stayed quiet.")]);
  const ownerReview = { annotations: [note("ann-1", "p001", "Nothing about him suggested power.", "Remove the explicit sentence because it draws attention to hidden power.")] };
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  assert.equal(model.changes.length, 1);
  assert.equal(model.changes[0].origin, "owner_requested");
  assert.equal(model.changes[0].ownerReviews[0].id, "ann-1");
  assert.equal(model.changes[0].kind, "removed");
  assert.equal(model.unmatchedReviewItems.length, 0);
});

test("unrelated reviser change is still shown", () => {
  const before = pkg(1, [paragraph("p001", "Original open."), paragraph("p002", "Middle stays."), paragraph("p003", "Original close.")]);
  const after = pkg(2, [paragraph("p001", "Rewritten open."), paragraph("p002", "Middle stays."), paragraph("p003", "Original close."), paragraph("p004", "Unexpected extra beat.")]);
  const ownerReview = { annotations: [note("ann-1", "p001", "Original open.", "Sharpen the opening.")] };
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  assert.equal(model.summary.ownerRequested, 1);
  assert.equal(model.summary.additional, 1);
  const extra = model.changes.find((change) => change.origin === "additional_revision");
  assert.equal(extra.kind, "inserted");
  assert.equal(extra.after.text, "Unexpected extra beat.");
});

test("no-change review item is detectable", () => {
  const before = pkg(1, [paragraph("p001", "The same paragraph remains."), paragraph("p002", "Also unchanged.")]);
  const after = pkg(2, [paragraph("p001", "The same paragraph remains."), paragraph("p002", "Also unchanged.")]);
  const ownerReview = { annotations: [note("ann-1", "p001", "The same paragraph remains.", "Cut this tell.")] };
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  assert.equal(model.changes.length, 0);
  assert.equal(model.unmatchedReviewItems.length, 1);
  assert.equal(model.unmatchedReviewItems[0].reason, "no_detectable_text_change");
  assert.equal(model.unmatchedReviewItems[0].annotation.id, "ann-1");
});

test("offset-shifted IDs do not mark the whole chapter as changed", () => {
  const before = [
    paragraph("p001", "Remove me."),
    paragraph("p002", "Stable one."),
    paragraph("p003", "Stable two."),
    paragraph("p004", "Stable three.")
  ];
  const after = [
    paragraph("p001", "Stable one."),
    paragraph("p002", "Stable two."),
    paragraph("p003", "Stable three.")
  ];
  const changes = diff.diffParagraphs(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "removed");
  assert.equal(changes[0].before.text, "Remove me.");
});

test("revision session does not inherit stale diff state from another package fingerprint", () => {
  const source = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: "aaa" };
  const first = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "bbb" };
  const second = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "ccc" };
  const stored = { sourceFingerprint: "aaa", resultFingerprint: "bbb", viewMode: "full", acceptedChangeIds: ["change-old"] };
  const restored = revision.normalizeSession(stored, source, first);
  const isolated = revision.normalizeSession(stored, source, second);
  assert.equal(restored.viewMode, "full");
  assert.deepEqual(restored.acceptedChangeIds, ["change-old"]);
  assert.equal(isolated.viewMode, "changes");
  assert.deepEqual(isolated.acceptedChangeIds, []);
  assert.notEqual(revision.sessionStorageKey(first), revision.sessionStorageKey(second));
});

test("same revised package restores accepted change and view mode", () => {
  const source = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: "src" };
  const result = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "dst" };
  const stored = { sourceFingerprint: "src", resultFingerprint: "dst", viewMode: "full", acceptedChangeIds: ["changed:p001:p001:0:0"] };
  const session = revision.normalizeSession(stored, source, result);
  assert.equal(session.viewMode, "full");
  assert.deepEqual(session.acceptedChangeIds, ["changed:p001:p001:0:0"]);
});

test("new package does not show old revision diff session", () => {
  const sourceA = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: "src-a" };
  const resultA = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "dst-a" };
  const sourceB = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "src-b" };
  const resultB = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 3, packageFingerprint: "dst-b" };
  const stale = revision.normalizeSession({ sourceFingerprint: "src-a", resultFingerprint: "dst-a", viewMode: "full", acceptedChangeIds: ["old"] }, sourceA, resultA);
  const fresh = revision.normalizeSession(stale, sourceB, resultB);
  assert.deepEqual(stale.acceptedChangeIds, ["old"]);
  assert.equal(fresh.viewMode, "changes");
  assert.deepEqual(fresh.acceptedChangeIds, []);
});

test("full chapter fallback is the non-changes view", () => {
  const ready = revision.revisionViewState({ hasRevisionPair: false, viewMode: "changes", jobStatus: "REVISION_READY" });
  assert.equal(ready.openRevisedHidden, false);
  assert.equal(ready.openRevisedLabel, "Review Changes");
  assert.equal(ready.toggleHidden, true);
  const reviewing = revision.revisionViewState({ hasRevisionPair: true, viewMode: "changes", jobStatus: null });
  assert.equal(reviewing.showChanges, true);
  assert.equal(reviewing.toggleLabel, "View Full Chapter");
  const full = revision.revisionViewState({ hasRevisionPair: true, viewMode: "full", jobStatus: null });
  assert.equal(full.showChanges, false);
  assert.equal(full.toggleLabel, "Review Changes");
});

test("source record isolation refuses a different job or chapter identity", () => {
  const sourcePackage = pkg(1, [paragraph("p001", "One.")]);
  const record = revision.createSourceRecord("job-1", { packageFingerprint: "fp1" }, sourcePackage, { schemaVersion: 1, type: "owner_review", source: "owner", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: 1, reviewedAt: "2026-08-28T10:05:00.000Z", reviewStatus: "completed", annotations: [] });
  assert.equal(revision.normalizeSourceRecord(record, { jobId: "job-1", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: 1 }).sourceFingerprint, "fp1");
  assert.equal(revision.normalizeSourceRecord(record, { jobId: "job-2" }), null);
  assert.equal(revision.sourceStorageKey("job-1"), "maxquill.revision-source.job-1");
});

test("accept tracking is local session state and does not alter the model ids", () => {
  const model = diff.buildRevisionReviewModel(
    pkg(1, [paragraph("p001", "Old.")]),
    pkg(2, [paragraph("p001", "New.")]),
    { annotations: [] }
  );
  const accepted = revision.applyAccepted(model, [model.changes[0].id]);
  assert.equal(accepted.changes[0].accepted, true);
  assert.equal(accepted.summary.accepted, 1);
  assert.equal(model.changes[0].accepted, false);
});
