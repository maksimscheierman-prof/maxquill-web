(function (root, factory) {
  const contract = factory();
  if (typeof module === "object" && module.exports) module.exports = contract;
  else root.MaxQuillReviewContract = contract;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REVIEW_READY_FIELDS = ["schemaVersion", "type", "bookId", "chapterId", "chapterNumber", "chapterVersion", "status", "title", "exportedAt", "content"];
  const PARAGRAPH_FIELDS = ["id", "text"];
  const OWNER_REVIEW_FIELDS = ["schemaVersion", "type", "source", "bookId", "chapterId", "chapterNumber", "chapterVersion", "reviewedAt", "reviewStatus", "annotations"];
  const ANNOTATION_FIELDS = ["id", "paragraphId", "selectedText", "selectionStart", "selectionEnd", "category", "comment", "status", "requiresCanonChange"];
  const CATEGORIES = ["wording", "clarity", "pacing", "dialogue", "continuity", "canon", "style", "other"];
  const ANNOTATION_STATUSES = ["open", "accepted", "rejected", "resolved"];

  function exactFields(value, allowed, label, errors) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    const keys = Object.keys(value);
    keys.filter((key) => !allowed.includes(key)).forEach((key) => errors.push(`${label} contains unknown field "${key}".`));
    allowed.filter((key) => !keys.includes(key)).forEach((key) => errors.push(`${label} is missing field "${key}".`));
  }

  function isPositiveInteger(value) { return Number.isInteger(value) && value > 0; }
  function isIsoDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)); }
  function result(errors) { return { valid: errors.length === 0, errors }; }

  function validateReviewReadyPackage(pkg) {
    const errors = [];
    exactFields(pkg, REVIEW_READY_FIELDS, "REVIEW_READY_PACKAGE", errors);
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return result(errors);
    if (pkg.schemaVersion !== 1) errors.push("Unsupported REVIEW_READY_PACKAGE schemaVersion; expected 1.");
    if (pkg.type !== "review_ready_chapter") errors.push('REVIEW_READY_PACKAGE type must be "review_ready_chapter".');
    if (typeof pkg.bookId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pkg.bookId)) errors.push("bookId must be lowercase kebab-case.");
    if (typeof pkg.chapterId !== "string" || !/^chapter_\d{4}$/.test(pkg.chapterId)) errors.push("chapterId must match chapter_####.");
    if (!isPositiveInteger(pkg.chapterNumber)) errors.push("chapterNumber must be a positive integer.");
    if (!isPositiveInteger(pkg.chapterVersion)) errors.push("chapterVersion must be a positive integer.");
    if (pkg.status !== "REVIEW_READY") errors.push('status must be "REVIEW_READY".');
    if (typeof pkg.title !== "string" || !pkg.title.trim()) errors.push("title must be a non-empty string.");
    if (!isIsoDate(pkg.exportedAt)) errors.push("exportedAt must be a valid ISO-8601 UTC timestamp.");
    if (!Array.isArray(pkg.content) || pkg.content.length === 0) errors.push("content must be a non-empty array.");
    else {
      const ids = new Set();
      pkg.content.forEach((paragraph, index) => {
        exactFields(paragraph, PARAGRAPH_FIELDS, `content[${index}]`, errors);
        if (!paragraph || typeof paragraph !== "object") return;
        if (typeof paragraph.id !== "string" || !/^p\d{3}$/.test(paragraph.id)) errors.push(`content[${index}].id must match p###.`);
        else if (ids.has(paragraph.id)) errors.push(`Paragraph ID "${paragraph.id}" is duplicated.`);
        else ids.add(paragraph.id);
        if (typeof paragraph.text !== "string" || !paragraph.text.trim()) errors.push(`content[${index}].text must be non-empty.`);
      });
    }
    return result(errors);
  }

  function validateOwnerReviewPackage(pkg, sourcePackage) {
    const errors = [];
    exactFields(pkg, OWNER_REVIEW_FIELDS, "OWNER_REVIEW_PACKAGE", errors);
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return result(errors);
    if (pkg.schemaVersion !== 1) errors.push("OWNER_REVIEW_PACKAGE schemaVersion must be 1.");
    if (pkg.type !== "owner_review") errors.push('OWNER_REVIEW_PACKAGE type must be "owner_review".');
    if (pkg.source !== "owner") errors.push('OWNER_REVIEW_PACKAGE source must be "owner".');
    if (!isIsoDate(pkg.reviewedAt)) errors.push("reviewedAt must be a valid ISO-8601 UTC timestamp.");
    if (pkg.reviewStatus !== "completed") errors.push('reviewStatus must be "completed" before export.');
    if (!Array.isArray(pkg.annotations)) errors.push("annotations must be an array.");
    if (sourcePackage) {
      ["bookId", "chapterId", "chapterNumber", "chapterVersion"].forEach((field) => {
        if (pkg[field] !== sourcePackage[field]) errors.push(`${field} does not match the loaded REVIEW_READY_PACKAGE.`);
      });
    }
    if (Array.isArray(pkg.annotations)) {
      const annotationIds = new Set();
      const paragraphs = new Map((sourcePackage?.content || []).map((paragraph) => [paragraph.id, paragraph.text]));
      pkg.annotations.forEach((annotation, index) => {
        exactFields(annotation, ANNOTATION_FIELDS, `annotations[${index}]`, errors);
        if (!annotation || typeof annotation !== "object") return;
        if (typeof annotation.id !== "string" || !annotation.id.trim()) errors.push(`annotations[${index}].id must be non-empty.`);
        else if (annotationIds.has(annotation.id)) errors.push(`Annotation ID "${annotation.id}" is duplicated.`);
        else annotationIds.add(annotation.id);
        const text = paragraphs.get(annotation.paragraphId);
        if (typeof text !== "string") errors.push(`annotations[${index}].paragraphId does not exist in this chapter version.`);
        if (typeof annotation.selectedText !== "string" || !annotation.selectedText) errors.push(`annotations[${index}].selectedText must be non-empty.`);
        if (!Number.isInteger(annotation.selectionStart) || annotation.selectionStart < 0) errors.push(`annotations[${index}].selectionStart must be a non-negative integer.`);
        if (!Number.isInteger(annotation.selectionEnd) || annotation.selectionEnd <= annotation.selectionStart) errors.push(`annotations[${index}].selectionEnd must be greater than selectionStart.`);
        if (typeof text === "string" && Number.isInteger(annotation.selectionStart) && Number.isInteger(annotation.selectionEnd) && (annotation.selectionEnd > text.length || text.substring(annotation.selectionStart, annotation.selectionEnd) !== annotation.selectedText)) errors.push(`annotations[${index}] selection offsets do not match selectedText.`);
        if (!CATEGORIES.includes(annotation.category)) errors.push(`annotations[${index}].category is invalid.`);
        if (typeof annotation.comment !== "string" || !annotation.comment.trim()) errors.push(`annotations[${index}].comment must be non-empty.`);
        if (!ANNOTATION_STATUSES.includes(annotation.status)) errors.push(`annotations[${index}].status is invalid.`);
        if (typeof annotation.requiresCanonChange !== "boolean") errors.push(`annotations[${index}].requiresCanonChange must be Boolean.`);
      });
    }
    return result(errors);
  }

  return { CATEGORIES, ANNOTATION_STATUSES, validateReviewReadyPackage, validateOwnerReviewPackage };
});
