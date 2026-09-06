"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const contract = require("../contract.js");
const ownerChange = require("../owner-change-review.js");
const diff = require("../revision-diff.js");
const revision = require("../revision-review.js");

const demoPath = path.join(__dirname, "..", "content", "books", "demo-book", "review", "chapter_0001_v1.json");
const source = JSON.parse(fs.readFileSync(demoPath, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

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

function owner(annotations) {
  return {
    schemaVersion: 1,
    type: "owner_review",
    source: "owner",
    bookId: source.bookId,
    chapterId: source.chapterId,
    chapterNumber: source.chapterNumber,
    chapterVersion: source.chapterVersion,
    reviewedAt: "2026-09-06T12:00:00.000Z",
    reviewStatus: "completed",
    annotations: clone(annotations)
  };
}

test("initial review HTML exposes Comment / Flag / Change actions", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "reader.html"), "utf8");
  assert.match(html, /data-selection-action="comment"/);
  assert.match(html, /data-selection-action="flag"/);
  assert.match(html, /data-selection-action="change"/);
  assert.match(html, /id="change-editor"/);
  assert.match(html, /id="annotation-replacement"/);
  assert.match(html, /Optional note/);
  assert.match(html, /owner-change-review\.js/);
});

test("Change editor helpers validate replacement and assess Owner Change", () => {
  const original = "Kael walked toward the bridge.";
  assert.equal(ownerChange.validateReplacement(original, "").valid, false);
  assert.equal(ownerChange.validateReplacement(original, original).valid, false);
  const ok = ownerChange.validateReplacement(original, "Kael ran for the root bridge, pulling Lyra behind him.");
  assert.equal(ok.valid, true);
  const assessment = ownerChange.assessOwnerChange({
    original,
    replacement: "Kael ran for the root bridge, pulling Lyra behind him.",
    surroundingBefore: "The path narrowed.",
    surroundingAfter: "Lyra kept pace."
  });
  assert.equal(assessment.status, "LOOKS_GOOD");
  assert.match(assessment.summary, /Looks good/i);
});

test("Owner Change persists separately from optional note and validates against package", () => {
  const paragraph = source.content[0];
  const selectedText = paragraph.text.substring(0, 24);
  const change = {
    id: "change-1",
    paragraphId: paragraph.id,
    selectedText,
    selectionStart: 0,
    selectionEnd: 24,
    category: "wording",
    comment: "Need the geography to feel continuous here.",
    status: "open",
    requiresCanonChange: false,
    annotationKind: "change",
    replacementText: "Kael ran for the root bridge, pulling Lyra behind him.",
    aiReview: { status: "LOOKS_GOOD", summary: "Looks good. The change keeps continuous geography." }
  };
  const result = contract.validateOwnerReviewPackage(owner([change]), source);
  assert.equal(result.valid, true, result.errors.join(" "));
  assert.equal(change.comment.includes("Kael ran"), false);
  assert.match(change.replacementText, /root bridge/);
  const empty = { ...change, id: "change-empty", replacementText: "   " };
  assert.equal(contract.validateOwnerReviewPackage(owner([empty]), source).valid, false);
  const same = { ...change, id: "change-same", replacementText: selectedText };
  assert.equal(contract.validateOwnerReviewPackage(owner([same]), source).valid, false);
  const other = clone(source);
  other.chapterVersion = 9;
  assert.equal(contract.validateOwnerReviewPackage(owner([change]), other).valid, false);
});

test("legacy COMMENT/FLAG reviews still validate without CHANGE fields", () => {
  const paragraph = source.content[0];
  const comment = {
    id: "c1",
    paragraphId: paragraph.id,
    selectedText: paragraph.text.substring(0, 3),
    selectionStart: 0,
    selectionEnd: 3,
    category: "wording",
    comment: "Tighten this.",
    status: "open",
    requiresCanonChange: false,
    annotationKind: "comment"
  };
  const flag = {
    ...comment,
    id: "f1",
    annotationKind: "flag",
    comment: "Flagged for revision."
  };
  assert.equal(contract.validateOwnerReviewPackage(owner([comment, flag]), source).valid, true);
  assert.equal(revision.ownerAnnotationKind(comment), "comment");
  assert.equal(revision.ownerAnnotationKind(flag), "flag");
  assert.equal(revision.ownerAnnotationBadge(comment), "COMMENT · WORDING");
});

test("revision review preserves Owner Change provenance and reviser adjustment", () => {
  const beforeText = "Kael walked toward the bridge.";
  const ownerText = "Kael runs for the root bridge, pulling Lyra behind him.";
  const afterText = "Kael ran for the root bridge, pulling Lyra behind him.";
  const before = pkg(1, [paragraph("p001", beforeText), paragraph("p002", "Later.")]);
  const after = pkg(2, [paragraph("p001", afterText), paragraph("p002", "Later.")], {
    reviserNotes: [{
      id: "adj-1",
      note: "Changed “runs” to “ran” to preserve past tense.",
      kind: "owner_change_adjustment",
      sourceOwnerNoteId: "ann-change",
      afterQuote: afterText
    }, {
      id: "rn-extra",
      note: "Independent polish elsewhere.",
      afterParagraphIds: ["p002"],
      kind: "independent"
    }]
  });
  const ownerReview = {
    annotations: [{
      id: "ann-change",
      paragraphId: "p001",
      selectedText: beforeText,
      selectionStart: 0,
      selectionEnd: beforeText.length,
      category: "wording",
      comment: "Need the geography to feel continuous here.",
      status: "open",
      requiresCanonChange: false,
      annotationKind: "change",
      replacementText: ownerText,
      aiReview: { status: "LOOKS_GOOD", summary: "Looks good. This preserves continuous geography." }
    }]
  };
  assert.equal(contract.validateReviewReadyPackage(after).valid, true);
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  const ownerCard = model.changes.find((change) => change.origin === "owner_requested");
  assert.ok(ownerCard);
  assert.equal(ownerCard.ownerReviews[0].annotationKind, "change");
  assert.equal(ownerCard.ownerReviews[0].replacementText, ownerText);
  assert.equal(ownerCard.ownerReviews[0].comment, "Need the geography to feel continuous here.");
  assert.equal(ownerCard.ownerReviews[0].aiReview.status, "LOOKS_GOOD");
  assert.match(ownerCard.reviserAdjustment, /past tense/);
  assert.equal(ownerCard.revisionReason, null);
  assert.equal(revision.ownerAnnotationKind(ownerCard.ownerReviews[0]), "change");
  assert.equal(revision.ownerAnnotationBadge(ownerCard.ownerReviews[0]), "CHANGE · WORDING");
  assert.equal(revision.revisionComparisonLayout().labels.ownerChange, "OWNER CHANGE");
});

test("Owner Change stays distinct from independent reviser change", () => {
  const before = pkg(1, [paragraph("p001", "Old line."), paragraph("p002", "Keep.")]);
  const after = pkg(2, [paragraph("p001", "Owner replacement."), paragraph("p002", "Independent polish.")], {
    reviserNotes: [{
      id: "rn-2",
      note: "Clarified the second paragraph for continuity.",
      afterParagraphIds: ["p002"]
    }]
  });
  const ownerReview = {
    annotations: [{
      id: "ann-change",
      paragraphId: "p001",
      selectedText: "Old line.",
      selectionStart: 0,
      selectionEnd: 9,
      category: "wording",
      comment: "",
      status: "open",
      requiresCanonChange: false,
      annotationKind: "change",
      replacementText: "Owner replacement."
    }]
  };
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  const ownerCard = model.changes.find((change) => change.origin === "owner_requested");
  const independent = model.changes.find((change) => change.origin === "additional_revision");
  assert.ok(ownerCard);
  assert.ok(independent);
  assert.equal(ownerCard.ownerReviews.length, 1);
  assert.equal(independent.ownerReviews.length, 0);
  assert.match(independent.revisionReason, /second paragraph/);
  assert.equal(ownerCard.revisionReason, null);
});

test("reader wiring keeps Change path and revision display hooks", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "reader.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "reader.js"), "utf8");
  assert.match(script, /openChangeEditor/);
  assert.match(script, /annotationKind: "change"/);
  assert.match(script, /replacementText/);
  assert.match(script, /Requested replacement|ownerChange/);
  assert.match(script, /reviserAdjustment/);
  assert.match(script, /MaxQuillOwnerChangeReview/);
  assert.match(html, /Save Change|annotation-save/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8"), /grid-template-columns:1fr 1fr 1fr/);
});
