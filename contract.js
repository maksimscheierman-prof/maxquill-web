(function (root, factory) {
  const contract = factory();
  if (typeof module === "object" && module.exports) module.exports = contract;
  else root.MaxQuillReviewContract = contract;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REVIEW_READY_FIELDS = ["schemaVersion", "type", "bookId", "chapterId", "chapterNumber", "chapterVersion", "status", "title", "exportedAt", "content"];
  const OPTIONAL_REVIEW_READY_FIELDS = ["reviserNotes"];
  const PARAGRAPH_FIELDS = ["id", "text"];
  const REVISER_NOTE_FIELDS = ["id", "note"];
  const OPTIONAL_REVISER_NOTE_FIELDS = ["afterParagraphIds", "afterQuote", "sourceOwnerNoteId", "kind"];
  const OWNER_REVIEW_FIELDS = ["schemaVersion", "type", "source", "bookId", "chapterId", "chapterNumber", "chapterVersion", "reviewedAt", "reviewStatus", "annotations"];
  const ANNOTATION_FIELDS = ["id", "paragraphId", "selectedText", "selectionStart", "selectionEnd", "category", "comment", "status", "requiresCanonChange"];
  const TITLE_ANNOTATION_FIELDS = ["id", "target", "selectedText", "category", "comment", "status", "requiresCanonChange"];
  const OPTIONAL_ANNOTATION_FIELDS = ["revisionChangeId", "revisionFeedbackKind", "sourceOwnerNoteId", "annotationKind", "replacementText", "aiReview"];
  const CATEGORIES = ["wording", "clarity", "pacing", "dialogue", "continuity", "canon", "style", "other"];
  const ANNOTATION_STATUSES = ["open", "accepted", "rejected", "resolved"];
  const REVISION_FEEDBACK_KINDS = ["comment", "flag"];
  const ANNOTATION_KINDS = ["comment", "flag", "change"];
  const REVISER_NOTE_KINDS = ["independent", "owner_change_adjustment"];
  const AI_REVIEW_STATUSES = ["LOOKS_GOOD", "MINOR_CONCERN", "LOGIC_CONCERN", "CANON_CONFLICT", "CONTINUITY_CONCERN", "REVEAL_RISK", "STYLE_CONCERN", "NEEDS_CONTEXT", "PENDING"];
  const CHAPTER_TITLE_TARGET = "chapter_title";

  function isChapterTitleAnnotation(value) {
    return Boolean(value && value.target === CHAPTER_TITLE_TARGET);
  }

  function exactFields(value, allowed, label, errors, optional = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    const keys = Object.keys(value);
    const permitted = new Set([...allowed, ...optional]);
    keys.filter((key) => !permitted.has(key)).forEach((key) => errors.push(`${label} contains unknown field "${key}".`));
    allowed.filter((key) => !keys.includes(key)).forEach((key) => errors.push(`${label} is missing field "${key}".`));
  }

  function isPositiveInteger(value) { return Number.isInteger(value) && value > 0; }
  function isIsoDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)); }
  function result(errors) { return { valid: errors.length === 0, errors }; }

  function validateReviserNotes(notes, content, errors, label = "reviserNotes") {
    if (notes == null) return;
    if (!Array.isArray(notes)) {
      errors.push(`${label} must be an array when present.`);
      return;
    }
    const paragraphIds = new Set((content || []).map((paragraph) => paragraph?.id).filter(Boolean));
    const noteIds = new Set();
    notes.forEach((note, index) => {
      exactFields(note, REVISER_NOTE_FIELDS, `${label}[${index}]`, errors, OPTIONAL_REVISER_NOTE_FIELDS);
      if (!note || typeof note !== "object") return;
      if (typeof note.id !== "string" || !note.id.trim()) errors.push(`${label}[${index}].id must be non-empty.`);
      else if (noteIds.has(note.id)) errors.push(`${label} ID "${note.id}" is duplicated.`);
      else noteIds.add(note.id);
      if (typeof note.note !== "string" || !note.note.trim()) errors.push(`${label}[${index}].note must be non-empty.`);
      const hasIds = Array.isArray(note.afterParagraphIds) && note.afterParagraphIds.length > 0;
      const hasQuote = typeof note.afterQuote === "string" && note.afterQuote.trim();
      if (!hasIds && !hasQuote) errors.push(`${label}[${index}] must include afterParagraphIds or afterQuote.`);
      if (note.afterParagraphIds != null) {
        if (!Array.isArray(note.afterParagraphIds) || !note.afterParagraphIds.length) errors.push(`${label}[${index}].afterParagraphIds must be a non-empty array when present.`);
        else {
          note.afterParagraphIds.forEach((paragraphId, paragraphIndex) => {
            if (typeof paragraphId !== "string" || !/^p\d{3}$/.test(paragraphId)) errors.push(`${label}[${index}].afterParagraphIds[${paragraphIndex}] must match p###.`);
            else if (paragraphIds.size && !paragraphIds.has(paragraphId)) errors.push(`${label}[${index}].afterParagraphIds[${paragraphIndex}] does not exist in content.`);
          });
        }
      }
      if (note.afterQuote != null && (typeof note.afterQuote !== "string" || !note.afterQuote.trim())) {
        errors.push(`${label}[${index}].afterQuote must be a non-empty string when present.`);
      }
      if (note.sourceOwnerNoteId != null && (typeof note.sourceOwnerNoteId !== "string" || !note.sourceOwnerNoteId.trim())) {
        errors.push(`${label}[${index}].sourceOwnerNoteId must be a non-empty string when present.`);
      }
      if (note.kind != null && !REVISER_NOTE_KINDS.includes(note.kind)) {
        errors.push(`${label}[${index}].kind is invalid.`);
      }
    });
  }

  function validateAiReview(aiReview, label, errors) {
    if (aiReview == null) return;
    if (!aiReview || typeof aiReview !== "object" || Array.isArray(aiReview)) {
      errors.push(`${label} must be an object when present.`);
      return;
    }
    const keys = Object.keys(aiReview);
    const permitted = new Set(["status", "summary", "suggestion"]);
    keys.filter((key) => !permitted.has(key)).forEach((key) => errors.push(`${label} contains unknown field "${key}".`));
    if (!AI_REVIEW_STATUSES.includes(aiReview.status)) errors.push(`${label}.status is invalid.`);
    if (typeof aiReview.summary !== "string" || !aiReview.summary.trim()) errors.push(`${label}.summary must be a non-empty string.`);
    if (aiReview.suggestion != null && (typeof aiReview.suggestion !== "string" || !aiReview.suggestion.trim())) {
      errors.push(`${label}.suggestion must be a non-empty string when present.`);
    }
  }

  function validateAnnotationKindFields(annotation, index, errors, { allowChange = true } = {}) {
    if (annotation.annotationKind != null && !ANNOTATION_KINDS.includes(annotation.annotationKind)) {
      errors.push(`annotations[${index}].annotationKind is invalid.`);
    }
    const isChange = annotation.annotationKind === "change";
    if (isChange && !allowChange) {
      errors.push(`annotations[${index}].annotationKind "change" is not supported for this annotation target.`);
      return;
    }
    if (isChange) {
      if (typeof annotation.replacementText !== "string" || !annotation.replacementText.trim()) {
        errors.push(`annotations[${index}].replacementText must be a non-empty string for Owner Change.`);
      } else if (annotation.replacementText.trim() === String(annotation.selectedText || "").trim()) {
        errors.push(`annotations[${index}].replacementText must differ from selectedText.`);
      }
      if (typeof annotation.comment !== "string") errors.push(`annotations[${index}].comment must be a string.`);
    } else if (typeof annotation.comment !== "string" || !annotation.comment.trim()) {
      errors.push(`annotations[${index}].comment must be non-empty.`);
    }
    if (annotation.replacementText != null && !isChange) {
      errors.push(`annotations[${index}].replacementText is only valid for annotationKind "change".`);
    }
    validateAiReview(annotation.aiReview, `annotations[${index}].aiReview`, errors);
  }

  function validateReviewReadyPackage(pkg) {
    const errors = [];
    exactFields(pkg, REVIEW_READY_FIELDS, "REVIEW_READY_PACKAGE", errors, OPTIONAL_REVIEW_READY_FIELDS);
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
    validateReviserNotes(pkg.reviserNotes, pkg.content, errors);
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
        if (isChapterTitleAnnotation(annotation)) {
          exactFields(annotation, TITLE_ANNOTATION_FIELDS, `annotations[${index}]`, errors, OPTIONAL_ANNOTATION_FIELDS);
          if (!annotation || typeof annotation !== "object") return;
          if (typeof annotation.id !== "string" || !annotation.id.trim()) errors.push(`annotations[${index}].id must be non-empty.`);
          else if (annotationIds.has(annotation.id)) errors.push(`Annotation ID "${annotation.id}" is duplicated.`);
          else annotationIds.add(annotation.id);
          if (annotation.selectedText !== sourcePackage?.title) errors.push(`annotations[${index}].selectedText must match the chapter title.`);
          if (!CATEGORIES.includes(annotation.category)) errors.push(`annotations[${index}].category is invalid.`);
          if (!ANNOTATION_STATUSES.includes(annotation.status)) errors.push(`annotations[${index}].status is invalid.`);
          if (typeof annotation.requiresCanonChange !== "boolean") errors.push(`annotations[${index}].requiresCanonChange must be Boolean.`);
          if (annotation.revisionFeedbackKind != null && !REVISION_FEEDBACK_KINDS.includes(annotation.revisionFeedbackKind)) errors.push(`annotations[${index}].revisionFeedbackKind is invalid.`);
          validateAnnotationKindFields(annotation, index, errors, { allowChange: false });
          return;
        }
        exactFields(annotation, ANNOTATION_FIELDS, `annotations[${index}]`, errors, OPTIONAL_ANNOTATION_FIELDS);
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
        if (!ANNOTATION_STATUSES.includes(annotation.status)) errors.push(`annotations[${index}].status is invalid.`);
        if (typeof annotation.requiresCanonChange !== "boolean") errors.push(`annotations[${index}].requiresCanonChange must be Boolean.`);
        if (annotation.revisionFeedbackKind != null && !REVISION_FEEDBACK_KINDS.includes(annotation.revisionFeedbackKind)) errors.push(`annotations[${index}].revisionFeedbackKind is invalid.`);
        validateAnnotationKindFields(annotation, index, errors, { allowChange: true });
      });
    }
    return result(errors);
  }

  return { CATEGORIES, ANNOTATION_STATUSES, ANNOTATION_KINDS, AI_REVIEW_STATUSES, REVISER_NOTE_KINDS, CHAPTER_TITLE_TARGET, TITLE_ANNOTATION_FIELDS, OPTIONAL_ANNOTATION_FIELDS, REVISION_FEEDBACK_KINDS, isChapterTitleAnnotation, validateReviewReadyPackage, validateOwnerReviewPackage };
});
