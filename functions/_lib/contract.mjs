const OWNER_FIELDS = ["schemaVersion", "type", "source", "bookId", "chapterId", "chapterNumber", "chapterVersion", "reviewedAt", "reviewStatus", "annotations"];
const ANNOTATION_FIELDS = ["id", "paragraphId", "selectedText", "selectionStart", "selectionEnd", "category", "comment", "status", "requiresCanonChange"];
const TITLE_ANNOTATION_FIELDS = ["id", "target", "selectedText", "category", "comment", "status", "requiresCanonChange"];
const REVIEW_READY_FIELDS = ["schemaVersion", "type", "bookId", "chapterId", "chapterNumber", "chapterVersion", "status", "title", "exportedAt", "content"];
const OPTIONAL_REVIEW_READY_FIELDS = ["reviserNotes"];
const PARAGRAPH_FIELDS = ["id", "text"];
const REVISER_NOTE_FIELDS = ["id", "note"];
const OPTIONAL_REVISER_NOTE_FIELDS = ["afterParagraphIds", "afterQuote"];
const CATEGORIES = new Set(["wording", "clarity", "pacing", "dialogue", "continuity", "canon", "style", "other"]);
const NOTE_STATUSES = new Set(["open", "accepted", "rejected", "resolved"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function exactFields(value, allowed, errors, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push("Expected an object."); return false; }
  const keys = Object.keys(value);
  const permitted = new Set([...allowed, ...optional]);
  if (keys.some((key) => !permitted.has(key)) || allowed.some((key) => !keys.includes(key))) errors.push("Fields do not match the contract.");
  return true;
}
function iso(value) { return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)); }
function positive(value) { return Number.isInteger(value) && value > 0; }

function validateReviserNotes(notes, content, errors) {
  if (notes == null) return;
  if (!Array.isArray(notes)) { errors.push("reviserNotes must be an array when present."); return; }
  const paragraphIds = new Set((content || []).map((paragraph) => paragraph?.id).filter(Boolean));
  const noteIds = new Set();
  for (const note of notes) {
    if (!exactFields(note, REVISER_NOTE_FIELDS, errors, OPTIONAL_REVISER_NOTE_FIELDS)) continue;
    if (typeof note.id !== "string" || !note.id.trim() || noteIds.has(note.id)) errors.push("reviserNote IDs must be non-empty and unique.");
    else noteIds.add(note.id);
    if (typeof note.note !== "string" || !note.note.trim()) errors.push("reviserNote note must be non-empty.");
    const hasIds = Array.isArray(note.afterParagraphIds) && note.afterParagraphIds.length > 0;
    const hasQuote = typeof note.afterQuote === "string" && note.afterQuote.trim();
    if (!hasIds && !hasQuote) errors.push("reviserNote must include afterParagraphIds or afterQuote.");
    if (note.afterParagraphIds != null) {
      if (!Array.isArray(note.afterParagraphIds) || !note.afterParagraphIds.length) errors.push("afterParagraphIds must be a non-empty array when present.");
      else for (const paragraphId of note.afterParagraphIds) {
        if (!/^p\d{3}$/.test(paragraphId || "") || (paragraphIds.size && !paragraphIds.has(paragraphId))) errors.push("Invalid reviserNote afterParagraphIds.");
      }
    }
    if (note.afterQuote != null && (typeof note.afterQuote !== "string" || !note.afterQuote.trim())) errors.push("afterQuote must be a non-empty string when present.");
  }
}

export function validateOwnerReview(pkg) {
  const errors = [];
  if (!exactFields(pkg, OWNER_FIELDS, errors)) return { valid: false, errors };
  if (pkg.schemaVersion !== 1 || pkg.type !== "owner_review" || pkg.source !== "owner" || pkg.reviewStatus !== "completed") errors.push("Invalid owner review envelope.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pkg.bookId || "") || !/^chapter_\d{4}$/.test(pkg.chapterId || "") || !positive(pkg.chapterNumber) || !positive(pkg.chapterVersion) || !iso(pkg.reviewedAt)) errors.push("Invalid owner review identity or timestamp.");
  if (!Array.isArray(pkg.annotations)) errors.push("Annotations must be an array.");
  else {
    const ids = new Set();
    for (const note of pkg.annotations) {
      if (note?.target === "chapter_title") {
        if (!exactFields(note, TITLE_ANNOTATION_FIELDS, errors)) continue;
        if (typeof note.id !== "string" || !note.id.trim() || ids.has(note.id)) errors.push("Annotation IDs must be non-empty and unique."); else ids.add(note.id);
        if (typeof note.selectedText !== "string" || !note.selectedText) errors.push("Invalid annotation selection.");
        if (!CATEGORIES.has(note.category) || typeof note.comment !== "string" || !note.comment.trim() || !NOTE_STATUSES.has(note.status) || typeof note.requiresCanonChange !== "boolean") errors.push("Invalid annotation values.");
        continue;
      }
      if (!exactFields(note, ANNOTATION_FIELDS, errors)) continue;
      if (typeof note.id !== "string" || !note.id.trim() || ids.has(note.id)) errors.push("Annotation IDs must be non-empty and unique."); else ids.add(note.id);
      if (!/^p\d{3}$/.test(note.paragraphId || "") || typeof note.selectedText !== "string" || !note.selectedText || !Number.isInteger(note.selectionStart) || note.selectionStart < 0 || !Number.isInteger(note.selectionEnd) || note.selectionEnd <= note.selectionStart || note.selectionEnd - note.selectionStart !== note.selectedText.length) errors.push("Invalid annotation selection.");
      if (!CATEGORIES.has(note.category) || typeof note.comment !== "string" || !note.comment.trim() || !NOTE_STATUSES.has(note.status) || typeof note.requiresCanonChange !== "boolean") errors.push("Invalid annotation values.");
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateReviewReady(pkg) {
  const errors = [];
  if (!exactFields(pkg, REVIEW_READY_FIELDS, errors, OPTIONAL_REVIEW_READY_FIELDS)) return { valid: false, errors };
  if (pkg.schemaVersion !== 1 || pkg.type !== "review_ready_chapter" || pkg.status !== "REVIEW_READY") errors.push("Invalid review-ready envelope.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pkg.bookId || "") || !/^chapter_\d{4}$/.test(pkg.chapterId || "") || !positive(pkg.chapterNumber) || !positive(pkg.chapterVersion) || typeof pkg.title !== "string" || !pkg.title.trim() || !iso(pkg.exportedAt)) errors.push("Invalid review-ready identity or metadata.");
  if (!Array.isArray(pkg.content) || !pkg.content.length) errors.push("Content must be non-empty.");
  else { const ids = new Set(); for (const paragraph of pkg.content) { if (!exactFields(paragraph, PARAGRAPH_FIELDS, errors)) continue; if (!/^p\d{3}$/.test(paragraph.id || "") || ids.has(paragraph.id) || typeof paragraph.text !== "string" || !paragraph.text.trim()) errors.push("Invalid paragraph."); ids.add(paragraph.id); } }
  validateReviserNotes(pkg.reviserNotes, pkg.content, errors);
  return { valid: errors.length === 0, errors };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
