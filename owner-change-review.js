(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaxQuillOwnerChangeReview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AI_REVIEW_STATUSES = Object.freeze([
    "LOOKS_GOOD",
    "MINOR_CONCERN",
    "LOGIC_CONCERN",
    "CANON_CONFLICT",
    "CONTINUITY_CONCERN",
    "REVEAL_RISK",
    "STYLE_CONCERN",
    "NEEDS_CONTEXT",
    "PENDING"
  ]);

  const STATUS_LABELS = Object.freeze({
    LOOKS_GOOD: "Looks good",
    MINOR_CONCERN: "Minor concern",
    LOGIC_CONCERN: "Logic concern",
    CANON_CONFLICT: "Canon conflict",
    CONTINUITY_CONCERN: "Continuity concern",
    REVEAL_RISK: "Reveal risk",
    STYLE_CONCERN: "Style concern",
    NEEDS_CONTEXT: "Needs context",
    PENDING: "AI review pending"
  });

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function validateReplacement(original, replacement) {
    const next = String(replacement ?? "");
    if (!next.trim()) {
      return { valid: false, error: "Replacement text cannot be empty. Clear the selection and choose Remove if you want to delete the passage." };
    }
    if (normalizeText(next) === normalizeText(original)) {
      return { valid: false, error: "Replacement text must differ from the original selection." };
    }
    return { valid: true, error: null };
  }

  function assessOwnerChange({ original, replacement, surroundingBefore = "", surroundingAfter = "", note = "" } = {}) {
    const validation = validateReplacement(original, replacement);
    if (!validation.valid) {
      return {
        status: "MINOR_CONCERN",
        summary: validation.error,
        suggestion: null
      };
    }
    const originalText = String(original || "");
    const replacementText = String(replacement || "");
    const before = String(surroundingBefore || "");
    const after = String(surroundingAfter || "");
    const combined = `${before} ${replacementText} ${after}`.toLowerCase();

    if (/\b(i am|i'm|we are)\b/i.test(replacementText) && /\b(he|she|they|kael|mara)\b/i.test(originalText) && !/\b(i am|i'm|we are)\b/i.test(originalText)) {
      return {
        status: "LOGIC_CONCERN",
        summary: "POV concern: the replacement introduces first-person wording that was not present in the original narration.",
        suggestion: null
      };
    }

    const originalPast = /\b(was|were|had|walked|ran|looked|said)\b/i.test(originalText);
    const replacementPresent = /\b(is|are|walks|runs|looks|says)\b/i.test(replacementText) && !/\b(was|were|had|walked|ran|looked|said)\b/i.test(replacementText);
    if (originalPast && replacementPresent) {
      return {
        status: "STYLE_CONCERN",
        summary: "Style concern: the replacement appears to shift tense relative to the original past-tense narration.",
        suggestion: null
      };
    }

    if (/(secret|reveal|true name|forbidden)\b/i.test(replacementText) && !/(secret|reveal|true name|forbidden)\b/i.test(originalText)) {
      return {
        status: "REVEAL_RISK",
        summary: "Reveal risk: the replacement introduces wording that may expose protected information earlier than intended.",
        suggestion: null
      };
    }

    if (before && after && normalizeText(replacementText).length < 8 && normalizeText(originalText).length > 40) {
      return {
        status: "NEEDS_CONTEXT",
        summary: "Needs context: the replacement is much shorter than the original and may lose necessary surrounding information.",
        suggestion: null
      };
    }

    if (note && /canon|continuity|later|earlier|already knows/i.test(note)) {
      return {
        status: "CONTINUITY_CONCERN",
        summary: "Continuity concern: the owner note flags timing or knowledge issues that should be verified against surrounding chapter context.",
        suggestion: null
      };
    }

    if (combined.includes(normalizeText(replacementText).toLowerCase()) && before.toLowerCase().includes(normalizeText(replacementText).slice(0, 24).toLowerCase())) {
      return {
        status: "MINOR_CONCERN",
        summary: "Minor concern: similar wording already appears nearby and may create repetition.",
        suggestion: null
      };
    }

    return {
      status: "LOOKS_GOOD",
      summary: "Looks good. The change remains locally coherent with the selected passage and does not introduce an obvious continuity or POV break.",
      suggestion: null
    };
  }

  function formatAiReview(aiReview) {
    if (!aiReview || typeof aiReview !== "object") return null;
    const status = AI_REVIEW_STATUSES.includes(aiReview.status) ? aiReview.status : "PENDING";
    const summary = typeof aiReview.summary === "string" && aiReview.summary.trim()
      ? aiReview.summary.trim()
      : STATUS_LABELS[status];
    return {
      status,
      label: STATUS_LABELS[status] || status,
      summary,
      suggestion: typeof aiReview.suggestion === "string" && aiReview.suggestion.trim() ? aiReview.suggestion.trim() : null
    };
  }

  return {
    AI_REVIEW_STATUSES,
    STATUS_LABELS,
    validateReplacement,
    assessOwnerChange,
    formatAiReview
  };
});
