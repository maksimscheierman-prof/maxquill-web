(function (root, factory) {
  const logic = factory();
  if (typeof module === "object" && module.exports) module.exports = logic;
  else root.MaxQuillSelectionLogic = logic;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function validateSelectionCandidate(sourcePackage, candidate) {
    if (!candidate || candidate.selectionStart === candidate.selectionEnd || !candidate.selectedText) return { valid: false, reason: "empty" };
    if (!candidate.paragraphId || candidate.startParagraphId !== candidate.endParagraphId) return { valid: false, reason: "cross-paragraph" };
    const paragraph = sourcePackage?.content?.find((item) => item.id === candidate.paragraphId);
    if (!paragraph || !Number.isInteger(candidate.selectionStart) || candidate.selectionStart < 0 || !Number.isInteger(candidate.selectionEnd) || candidate.selectionEnd <= candidate.selectionStart || candidate.selectionEnd > paragraph.text.length) return { valid: false, reason: "invalid-offsets" };
    if (paragraph.text.substring(candidate.selectionStart, candidate.selectionEnd) !== candidate.selectedText) return { valid: false, reason: "text-mismatch" };
    return { valid: true, paragraph };
  }
  return { validateSelectionCandidate };
});
