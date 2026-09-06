"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const diff = require("../revision-diff.js");
const revision = require("../revision-review.js");
const contract = require("../contract.js");

function paragraph(id, text) { return { id, text }; }
function pkg(version, content, extra = {}) {
  return {
    schemaVersion: 1,
    type: "review_ready_chapter",
    bookId: "book-001",
    chapterId: "chapter_0001",
    chapterNumber: 1,
    chapterVersion: version,
    status: "REVIEW_READY",
    title: "The Book He Never Asked For",
    exportedAt: "2026-08-28T10:00:00.000Z",
    content,
    ...extra
  };
}

test("independent reviser change with rationale attaches revisionReason", () => {
  const before = pkg(1, [
    paragraph("p001", "The orphanage waited in fog."),
    paragraph("p002", "Kael woke early.")
  ]);
  const after = pkg(2, [
    paragraph("p001", "The orphanage nestled among the surrounding roots and paths."),
    paragraph("p002", "Kael woke early.")
  ], {
    reviserNotes: [{
      id: "rn-geo",
      note: "Clarified the orphanage's position relative to the surrounding roots and paths so the opening geography is easier to visualize.",
      afterParagraphIds: ["p001"]
    }]
  });
  assert.equal(contract.validateReviewReadyPackage(after).valid, true);
  const model = diff.buildRevisionReviewModel(before, after, { annotations: [] });
  const additional = model.changes.filter((change) => change.origin === "additional_revision");
  assert.equal(additional.length, 1);
  assert.match(additional[0].revisionReason, /orphanage's position/);
  assert.equal(additional[0].ownerReviews.length, 0);
});

test("owner-note-driven changes keep Owner attribution and do not absorb reviserNotes", () => {
  const quote = "Kael woke early.";
  const before = pkg(1, [paragraph("p001", quote), paragraph("p002", "Later.")]);
  const after = pkg(2, [paragraph("p001", "Kael rose before dawn."), paragraph("p002", "Later.")], {
    reviserNotes: [{
      id: "rn-extra",
      note: "Should not attach to an owner-linked change.",
      afterParagraphIds: ["p001"]
    }]
  });
  const ownerReview = {
    annotations: [{
      id: "ann-1",
      paragraphId: "p001",
      selectedText: quote,
      selectionStart: 0,
      selectionEnd: quote.length,
      category: "wording",
      comment: "Change the waking line.",
      status: "open",
      requiresCanonChange: false
    }]
  };
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  const ownerCard = model.changes.find((change) => change.origin === "owner_requested");
  assert.ok(ownerCard);
  assert.equal(ownerCard.ownerReviews[0].id, "ann-1");
  assert.equal(ownerCard.revisionReason, null);
});

test("legacy independent change without rationale still renders metadata only", () => {
  const before = pkg(1, [paragraph("p001", "Old line.")]);
  const after = pkg(2, [paragraph("p001", "New line.")]);
  assert.equal(Object.hasOwn(after, "reviserNotes"), false);
  assert.equal(contract.validateReviewReadyPackage(after).valid, true);
  const model = diff.buildRevisionReviewModel(before, after, { annotations: [] });
  assert.equal(model.changes[0].origin, "additional_revision");
  assert.equal(model.changes[0].revisionReason, null);
  const layout = revision.revisionComparisonLayout();
  assert.match(layout.additionalNote, /independently by the reviser/);
  assert.equal(layout.labels.reviserReason, "Reviser reason");
});

test("reviserNotes afterQuote matching attaches without inventing reasons client-side", () => {
  const before = pkg(1, [paragraph("p001", "Fog covered the yard.")]);
  const afterText = "Soft light cut between the rootways around the yard.";
  const after = pkg(2, [paragraph("p001", afterText)], {
    reviserNotes: [{
      id: "rn-quote",
      note: "Added environmental grounding for the reader's first look at the yard.",
      afterQuote: "rootways around the yard"
    }]
  });
  const model = diff.buildRevisionReviewModel(before, after, { annotations: [] });
  assert.equal(model.changes[0].revisionReason, "Added environmental grounding for the reader's first look at the yard.");
});

test("missing rationale does not crash model or UI script contracts", () => {
  const before = pkg(1, [paragraph("p001", "A")]);
  const after = pkg(2, [paragraph("p001", "B"), paragraph("p002", "C")]);
  const model = diff.buildRevisionReviewModel(before, after, null);
  assert.ok(model.changes.every((change) => change.revisionReason === null || typeof change.revisionReason === "string"));
  const script = fs.readFileSync(require.resolve("../reader.js"), "utf8");
  assert.match(script, /revisionReason/);
  assert.match(script, /reviserReason|Reviser reason/);
  assert.doesNotMatch(script, /invent.*rationale|derive.*reason from the diff/i);
});

test("optional reviserNotes does not require package migration for legacy fixtures", () => {
  const demoPath = require("path").join(__dirname, "..", "content", "books", "demo-book", "review", "chapter_0001_v1.json");
  const source = JSON.parse(fs.readFileSync(demoPath, "utf8"));
  assert.equal(contract.validateReviewReadyPackage(source).valid, true);
  const withNotes = {
    ...source,
    reviserNotes: [{ id: "rn-1", note: "Reduced repetition in the opening.", afterParagraphIds: [source.content[0].id] }]
  };
  assert.equal(contract.validateReviewReadyPackage(withNotes).valid, true);
});

test("reviserNotes do not change packageFingerprint identity", async () => {
  const api = require("../review-api.js");
  const before = pkg(2, [paragraph("p001", "Same content.")]);
  const withNotes = {
    ...before,
    reviserNotes: [{ id: "rn-1", note: "Clarified spatial grounding.", afterParagraphIds: ["p001"] }]
  };
  const left = await api.packageIdentity(before);
  const right = await api.packageIdentity(withNotes);
  assert.equal(left.packageFingerprint, right.packageFingerprint);
});
