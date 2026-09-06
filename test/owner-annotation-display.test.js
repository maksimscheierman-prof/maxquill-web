"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const diff = require("../revision-diff.js");
const revision = require("../revision-review.js");

function paragraph(id, text) { return { id, text }; }
function pkg(version, content) {
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
    content
  };
}
function note(id, paragraphId, selectedText, comment, category = "wording", annotationKind = "comment") {
  return {
    id,
    paragraphId,
    selectedText,
    selectionStart: 0,
    selectionEnd: selectedText.length,
    category,
    comment,
    status: "open",
    requiresCanonChange: false,
    annotationKind
  };
}

test("owner selected quote ranges underline the annotated old passage", () => {
  const quote = "Lyra, on the far side of the room, made a small sound.";
  const passage = { id: "p008", text: `Before. ${quote} After.` };
  const note = {
    id: "ann-lyra",
    paragraphId: "p008",
    selectedText: quote,
    selectionStart: 8,
    selectionEnd: 8 + quote.length,
    category: "continuity",
    comment: "Have her enter instead.",
    status: "open",
    requiresCanonChange: false,
    annotationKind: "comment"
  };
  const ranges = revision.ownerSelectedRangesForPassage(passage, [note]);
  assert.equal(ranges.length, 1);
  assert.equal(passage.text.slice(ranges[0].start, ranges[0].end), quote);
  const whole = revision.ownerSelectedRangesForPassage(
    { id: "p008", text: quote },
    [{ ...note, selectionStart: 0, selectionEnd: quote.length, selectedText: quote }]
  );
  assert.deepEqual(whole, [{ start: 0, end: quote.length }]);
});

test("CH001 owner annotation display preserves Comment/Flag and category", () => {
  const wording = note("ann-wording", "p007", "It is if you refuse food long enough.", "Change to: If you refuse food long enough, it is.", "wording", "comment");
  const flag = note("ann-maera", "p060", "But it had cost Maera more than it should have.", "Flagged for revision. Avoid implying that Maera personally paid for the book.", "canon", "flag");
  const recovered = {
    id: "ann-flag-text",
    paragraphId: "p001",
    selectedText: "x",
    selectionStart: 0,
    selectionEnd: 1,
    category: "other",
    comment: "Flagged for revision. Remove the explicit mention.",
    status: "open",
    requiresCanonChange: false
  };
  assert.equal(revision.ownerAnnotationKind(wording), "comment");
  assert.equal(revision.ownerAnnotationBadge(wording), "COMMENT · WORDING");
  assert.equal(revision.ownerAnnotationKind(flag), "flag");
  assert.equal(revision.ownerAnnotationBadge(flag), "FLAG · CANON");
  assert.equal(revision.ownerAnnotationKind(recovered), "flag");
  assert.equal(revision.ownerAnnotationBadge(recovered), "FLAG · OTHER");
  assert.equal(revision.ownerAnnotationCategoryLabel("continuity"), "Continuity");
});

test("CH001 fixtures link wording, continuity, canon flag, and genuine additional polish", () => {
  const wordingQuote = "“It is if you refuse food long enough.”";
  const lyraQuote = "Lyra, on the far side of the room, made a small sound that might have been a laugh if she wanted to flatter Tarin. She had one knee up under the blanket and was already tying back her hair with practiced fingers.";
  const maeraQuote = "But it had cost Maera more than it should have.";
  const before = pkg(1, [
    paragraph("p004", "Boots on the floorboards. Miss Maera’s brisk voice stayed ordinary."),
    paragraph("p005", "“Finally,” Tarin said from the next pallet."),
    paragraph("p006", "Kael blinked at him. “That’s not how dying works.”"),
    paragraph("p007", wordingQuote),
    paragraph("p008", lyraQuote),
    paragraph("p009", "“Move,” she said, and tossed Kael his shirt."),
    paragraph("p040", "Bridge paragraph stays the same in both versions."),
    paragraph("p050", "Later, the overlook was quiet."),
    paragraph("p060", maeraQuote)
  ]);
  const after = pkg(2, [
    paragraph("p004", "Boots on the floorboards. Miss Maera’s brisk voice stayed ordinary."),
    paragraph("p005", "The door opened without warning."),
    paragraph("p006", "Lyra stepped into the room, already tying back her hair."),
    paragraph("p007", "“If you refuse food long enough, it is.”"),
    paragraph("p008", "“Are you two actually getting up?”"),
    paragraph("p009", "Tarin pulled the blanket higher. “We were considering it.”"),
    paragraph("p010", "Lyra made a small sound that might have been a laugh if she wanted to flatter him."),
    paragraph("p040", "Bridge paragraph stays the same in both versions."),
    paragraph("p050", "Later, the overlook was rewritten for an unrelated polish."),
    paragraph("p060", "But it had cost more than anything in his life had any right to.")
  ]);
  const ownerReview = {
    annotations: [
      note("ann-wording", "p007", wordingQuote, "“If you refuse food long enough, it is.” change to this", "wording", "comment"),
      note(
        "ann-lyra",
        "p008",
        lyraQuote,
        "This implies Lyra sleeps in the same room as Kael and Tarin. She should have a separate girls’ sleeping room. Have her enter the boys’ room instead. Use something like this \"The door opened without warning.\n\nLyra stepped into the room, already tying back her hair with practiced fingers. She looked as though she had been awake for an hour rather than a few minutes.\n\nShe glanced from Kael to Tarin.\n\n“Are you two actually getting up?”\n\nTarin pulled the blanket higher. “We were considering it.”\n\nLyra made a small sound that might have been a laugh if she wanted to flatter him.\"",
        "continuity",
        "comment"
      ),
      note("ann-maera", "p060", maeraQuote, "Flagged for revision. Avoid implying that Maera personally paid for the book.", "canon", "flag")
    ]
  };
  const model = diff.buildRevisionReviewModel(before, after, ownerReview);
  const byId = Object.fromEntries(model.changes.map((change) => [change.id, change]));
  assert.equal(byId["owner:ann-wording"].origin, "owner_requested");
  assert.equal(revision.ownerAnnotationBadge(byId["owner:ann-wording"].ownerReviews[0]), "COMMENT · WORDING");
  assert.equal(byId["owner:ann-wording"].ownerReviews[0].selectedText, wordingQuote);
  assert.match(byId["owner:ann-wording"].ownerReviews[0].comment, /If you refuse food long enough, it is/);

  assert.equal(byId["owner:ann-lyra"].origin, "owner_requested");
  assert.equal(revision.ownerAnnotationBadge(byId["owner:ann-lyra"].ownerReviews[0]), "COMMENT · CONTINUITY");
  assert.ok(byId["owner:ann-lyra"].memberIds.some((id) => id.includes("p005")), "door opening claimed by continuity note evidence");
  assert.match(byId["owner:ann-lyra"].after.text, /The door opened without warning/);
  assert.match(byId["owner:ann-lyra"].after.text, /Are you two actually getting up/);
  const lyraPassage = byId["owner:ann-lyra"].before.passages.find((passage) => passage.id === "p008");
  assert.ok(lyraPassage, "old version must include the annotated Lyra paragraph");
  const lyraRanges = revision.ownerSelectedRangesForPassage(lyraPassage, byId["owner:ann-lyra"].ownerReviews);
  assert.equal(lyraRanges.length, 1);
  assert.equal(lyraPassage.text.slice(lyraRanges[0].start, lyraRanges[0].end), lyraQuote);

  assert.equal(byId["owner:ann-maera"].origin, "owner_requested");
  assert.equal(revision.ownerAnnotationKind(byId["owner:ann-maera"].ownerReviews[0]), "flag");
  assert.equal(revision.ownerAnnotationBadge(byId["owner:ann-maera"].ownerReviews[0]), "FLAG · CANON");
  assert.equal(byId["owner:ann-maera"].ownerReviews[0].selectedText, maeraQuote);

  const additional = model.changes.filter((change) => change.origin === "additional_revision");
  assert.equal(additional.length, 1, "only the distant overlook polish should remain Additional");
  assert.equal(additional[0].ownerReviews.length, 0);
  assert.match(additional[0].after.text, /overlook was rewritten/);
  assert.doesNotMatch(additional[0].after.text, /The door opened without warning/);

  const ranges = revision.ownerSelectedRangesForPassage(
    { id: "p060", text: maeraQuote },
    byId["owner:ann-maera"].ownerReviews
  );
  assert.equal(ranges.length, 1);
  assert.equal(maeraQuote.slice(ranges[0].start, ranges[0].end), maeraQuote);

  const feedback = [{
    id: "v2-1",
    paragraphId: "p007",
    selectedText: "x",
    selectionStart: 0,
    selectionEnd: 1,
    category: "wording",
    comment: "Still off.",
    status: "open",
    requiresCanonChange: false,
    revisionChangeId: "owner:ann-wording",
    revisionFeedbackKind: "comment"
  }];
  const decided = revision.applyAccepted(model, [], feedback);
  assert.equal(decided.changes.find((change) => change.id === "owner:ann-wording").decision.state, "needs_revision");
  assert.equal(decided.changes.find((change) => change.id === "owner:ann-wording").ownerReviews[0].comment, ownerReview.annotations[0].comment);
  assert.equal(decided.changes.find((change) => change.id === "owner:ann-wording").revisionFeedback[0].comment, "Still off.");
  assert.deepEqual(revision.revisionComparisonLayout().mobileStack, ["new", "old", "ownerNote"]);
});
