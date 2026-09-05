"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const diff = require("../revision-diff.js");
const revision = require("../revision-review.js");
const reviewApi = require("../review-api.js");

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
  assert.equal(ready.tabsHidden, true);
  const reviewing = revision.revisionViewState({ hasRevisionPair: true, viewMode: "changes", jobStatus: null });
  assert.equal(reviewing.showChanges, true);
  assert.equal(reviewing.toggleLabel, "View Full Chapter");
  assert.equal(reviewing.togglePressed, false);
  const full = revision.revisionViewState({ hasRevisionPair: true, viewMode: "full", jobStatus: null });
  assert.equal(full.showChanges, false);
  assert.equal(full.showFullChapter, true);
  assert.equal(full.toggleLabel, "View Full Chapter");
  assert.equal(full.togglePressed, true);
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

test("sixteen owner annotations render as Review Notes, not sixteen reviews", () => {
  assert.equal(revision.reviewNotesLabel(16), "Review Notes (16)");
  assert.doesNotMatch(revision.reviewNotesLabel(16), /16 reviews/i);
  const view = revision.revisionViewState({ hasRevisionPair: true, viewMode: "changes", originalNoteCount: 16, changeCount: 7, currentNoteCount: 0, beforeVersion: 1, afterVersion: 2 });
  assert.equal(view.notesLabel, "Review Notes (16)");
  assert.equal(view.changesLabel, "Changes (7)");
  assert.equal(view.modeSwitchLabel, "Review");
  assert.doesNotMatch(view.notesLabel, /reviews/i);
  assert.equal(view.versionLabel, "Version 1 → Version 2");
});

test("Changes tab count reflects diff cards including unmatched review items", () => {
  const before = pkg(1, [paragraph("p001", "The lantern was dim."), paragraph("p002", "Unchanged close.")]);
  const after = pkg(2, [paragraph("p001", "The lantern burned low."), paragraph("p002", "Unchanged close.")]);
  const ownerReview = { annotations: [note("a1", "p001", "The lantern was dim.", "Please rewrite."), note("a2", "p002", "Unchanged close.", "Still looks off.")] };
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  assert.equal(model.changes.length, 1);
  assert.equal(model.unmatchedReviewItems.length, 1);
  assert.equal(revision.changeCardCount(model), 2);
  assert.equal(revision.revisionViewState({ hasRevisionPair: true, viewMode: "changes", changeCount: revision.changeCardCount(model) }).changesLabel, "Changes (2)");
});

test("REVISION_READY revised package defaults to Changes, not notes or full chapter", () => {
  const source = { bookId: "demo-book", chapterId: "chapter_0001", packageFingerprint: "src" };
  const result = { bookId: "demo-book", chapterId: "chapter_0001", packageFingerprint: "dst" };
  const session = revision.normalizeSession(null, source, result);
  assert.equal(session.viewMode, "changes");
  const view = revision.revisionViewState({ hasRevisionPair: true, viewMode: session.viewMode, jobStatus: "REVISION_READY", originalNoteCount: 16, changeCount: 4, beforeVersion: 1, afterVersion: 2 });
  assert.equal(view.showChanges, true);
  assert.equal(view.showOriginalNotes, false);
  assert.equal(view.showFullChapter, false);
  assert.equal(view.changesPressed, true);
  assert.equal(view.notesPressed, false);
  assert.equal(view.togglePressed, false);
  assert.equal(view.toggleLabel, "View Full Chapter");
  assert.equal(view.openRevisedHidden, true);
  const sourcePage = revision.revisionViewState({ hasRevisionPair: false, viewMode: "changes", jobStatus: "REVISION_READY", currentNoteCount: 16 });
  assert.equal(sourcePage.showChanges, false);
  assert.equal(sourcePage.tabsHidden, true);
  assert.equal(sourcePage.openRevisedHidden, false);
  assert.equal(sourcePage.noteCountLabel, "Review Notes (16)");
});

test("Review Notes tab opens original submitted review, not the revised package", () => {
  const before = pkg(1, [paragraph("p001", "Old.")]);
  const after = pkg(2, [paragraph("p001", "New.")]);
  const ownerReview = { annotations: Array.from({ length: 16 }, (_, index) => note(`n${index}`, "p001", "Old.", `Note ${index}`)) };
  const afterReview = { annotations: [note("v2", "p001", "New.", "Fresh comment")] };
  const display = revision.revisionDisplayState({ viewMode: "notes", beforePackage: before, afterPackage: after, ownerReview, afterReview });
  assert.equal(display.package.chapterVersion, 1);
  assert.equal(display.annotations.length, 16);
  assert.equal(display.readOnly, true);
  assert.equal(display.writesTo, "none");
  assert.equal(display.annotations[0].id, "n0");
  assert.notEqual(display.annotations, afterReview.annotations);
});

test("View Full Chapter opens the revised chapter", () => {
  const before = pkg(1, [paragraph("p001", "Old.")]);
  const after = pkg(2, [paragraph("p001", "New.")]);
  const display = revision.revisionDisplayState({ viewMode: "full", beforePackage: before, afterPackage: after, ownerReview: { annotations: [note("n1", "p001", "Old.", "x")] }, afterReview: { annotations: [] } });
  assert.equal(display.package.chapterVersion, 2);
  assert.equal(display.package, after);
  assert.equal(display.readOnly, false);
  assert.equal(display.writesTo, "afterReview");
  const view = revision.revisionViewState({ hasRevisionPair: true, viewMode: "full", beforeVersion: 1, afterVersion: 2 });
  assert.equal(view.showFullChapter, true);
  assert.equal(view.showChanges, false);
  assert.equal(view.togglePressed, true);
  assert.equal(view.toggleLabel, "View Full Chapter");
});

test("switching tabs does not mix package, review, or accept state", () => {
  const source = { bookId: "demo-book", chapterId: "chapter_0001", packageFingerprint: "src" };
  const result = { bookId: "demo-book", chapterId: "chapter_0001", packageFingerprint: "dst" };
  const session = revision.normalizeSession({ sourceFingerprint: "src", resultFingerprint: "dst", viewMode: "changes", acceptedChangeIds: ["change-1"] }, source, result);
  const notes = revision.setViewMode(session, "notes");
  const full = revision.setViewMode(notes, "full");
  const back = revision.setViewMode(full, "changes");
  assert.equal(notes.sourceFingerprint, "src");
  assert.equal(notes.resultFingerprint, "dst");
  assert.deepEqual(notes.acceptedChangeIds, ["change-1"]);
  assert.equal(full.viewMode, "full");
  assert.deepEqual(full.acceptedChangeIds, ["change-1"]);
  assert.equal(back.viewMode, "changes");
  const before = pkg(1, [paragraph("p001", "Old.")]);
  const after = pkg(2, [paragraph("p001", "New.")]);
  const ownerReview = { annotations: [note("v1", "p001", "Old.", "Original")] };
  const afterReview = { annotations: [note("v2", "p001", "New.", "New flag")] };
  const notesDisplay = revision.revisionDisplayState({ viewMode: "notes", beforePackage: before, afterPackage: after, ownerReview, afterReview });
  const changeDisplay = revision.revisionDisplayState({ viewMode: "changes", beforePackage: before, afterPackage: after, ownerReview, afterReview });
  assert.equal(notesDisplay.writesTo, "none");
  assert.equal(notesDisplay.annotations[0].id, "v1");
  assert.equal(changeDisplay.writesTo, "afterReview");
  assert.equal(changeDisplay.annotations[0].id, "v2");
  assert.notEqual(
    reviewApi.reviewStorageKey({ bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: "src" }),
    reviewApi.reviewStorageKey({ bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "dst" })
  );
  assert.notEqual(revision.sessionStorageKey({ bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "dst" }), reviewApi.reviewStorageKey({ bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "dst" }));
});

test("old package does not inherit tab or diff state from a new package", () => {
  const sourceA = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: "src-a" };
  const resultA = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "dst-a" };
  const sourceB = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "src-b" };
  const resultB = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 3, packageFingerprint: "dst-b" };
  const storedNew = { sourceFingerprint: "src-b", resultFingerprint: "dst-b", viewMode: "notes", acceptedChangeIds: ["new-change"] };
  const oldRestored = revision.normalizeSession(storedNew, sourceA, resultA);
  const newRestored = revision.normalizeSession(storedNew, sourceB, resultB);
  assert.equal(oldRestored.viewMode, "changes");
  assert.deepEqual(oldRestored.acceptedChangeIds, []);
  assert.equal(newRestored.viewMode, "notes");
  assert.deepEqual(newRestored.acceptedChangeIds, ["new-change"]);
  assert.notEqual(revision.sessionStorageKey(resultA), revision.sessionStorageKey(resultB));
});

test("reload of same revised package restores selected tab and accepts", () => {
  const source = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: "src" };
  const result = { bookId: "demo-book", chapterId: "chapter_0001", chapterVersion: 2, packageFingerprint: "dst" };
  const stored = { sourceFingerprint: "src", resultFingerprint: "dst", viewMode: "notes", acceptedChangeIds: ["changed:p001:p001:0:0"] };
  const session = revision.normalizeSession(stored, source, result);
  assert.equal(session.viewMode, "notes");
  assert.deepEqual(session.acceptedChangeIds, ["changed:p001:p001:0:0"]);
  assert.equal(revision.normalizeSession({ ...stored, viewMode: "changes" }, source, result).viewMode, "changes");
  assert.equal(revision.normalizeSession({ ...stored, viewMode: "full" }, source, result).viewMode, "full");
});
