"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { validateSelectionCandidate } = require("../selection-logic.js");

const source = { content: [{ id: "p001", text: "Alpha beta gamma." }, { id: "p002", text: "Delta." }] };
const valid = { paragraphId: "p001", startParagraphId: "p001", endParagraphId: "p001", selectedText: "beta", selectionStart: 6, selectionEnd: 10 };

test("desktop and touch selection candidates use original string offsets", () => {
  assert.equal(validateSelectionCandidate(source, valid).valid, true);
  assert.equal(source.content[0].text.substring(valid.selectionStart, valid.selectionEnd), valid.selectedText);
});
test("empty selection is ignored", () => { assert.equal(validateSelectionCandidate(source, { ...valid, selectedText: "", selectionEnd: 6 }).reason, "empty"); });
test("cross-paragraph selection is rejected", () => { assert.equal(validateSelectionCandidate(source, { ...valid, endParagraphId: "p002" }).reason, "cross-paragraph"); });
test("negative and reversed offsets are rejected", () => { assert.equal(validateSelectionCandidate(source, { ...valid, selectionStart: -1 }).reason, "invalid-offsets"); assert.equal(validateSelectionCandidate(source, { ...valid, selectionStart: 10, selectionEnd: 6 }).reason, "invalid-offsets"); });
test("offsets beyond the paragraph are rejected", () => { assert.equal(validateSelectionCandidate(source, { ...valid, selectionEnd: 99 }).reason, "invalid-offsets"); });
test("selected text mismatch is rejected", () => { assert.equal(validateSelectionCandidate(source, { ...valid, selectedText: "Beta" }).reason, "text-mismatch"); });
