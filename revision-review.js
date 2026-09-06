(function (root, factory) {
  const review = factory();
  if (typeof module === "object" && module.exports) module.exports = review;
  else root.MaxQuillRevisionReview = review;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VIEW_MODES = new Set(["notes", "changes", "full"]);

  function cloneReviewReady(pkg) {
    if (!pkg || typeof pkg !== "object") return null;
    return {
      schemaVersion: pkg.schemaVersion,
      type: pkg.type,
      bookId: pkg.bookId,
      chapterId: pkg.chapterId,
      chapterNumber: pkg.chapterNumber,
      chapterVersion: pkg.chapterVersion,
      status: pkg.status,
      title: pkg.title,
      exportedAt: pkg.exportedAt,
      content: Array.isArray(pkg.content) ? pkg.content.map((paragraph) => ({ id: paragraph.id, text: paragraph.text })) : []
    };
  }

  function cloneOwnerReview(pkg) {
    if (!pkg || typeof pkg !== "object") return null;
    return {
      schemaVersion: pkg.schemaVersion,
      type: pkg.type,
      source: pkg.source,
      bookId: pkg.bookId,
      chapterId: pkg.chapterId,
      chapterNumber: pkg.chapterNumber,
      chapterVersion: pkg.chapterVersion,
      reviewedAt: pkg.reviewedAt,
      reviewStatus: pkg.reviewStatus,
      annotations: Array.isArray(pkg.annotations) ? pkg.annotations.map((note) => ({ ...note })) : []
    };
  }

  function sourceStorageKey(jobId) {
    if (!jobId) throw new Error("Job id is required for revision source storage.");
    return `maxquill.revision-source.${jobId}`;
  }

  function sessionStorageKey(identity) {
    if (!identity?.packageFingerprint) throw new Error("Package fingerprint is required for revision session storage.");
    return `maxquill.revision-session.${identity.bookId}.${identity.chapterId}.v${identity.chapterVersion}.${identity.packageFingerprint}`;
  }

  function createSourceRecord(jobId, sourceIdentity, sourcePackage, ownerReview) {
    return {
      jobId,
      sourceFingerprint: sourceIdentity.packageFingerprint,
      sourcePackage: cloneReviewReady(sourcePackage),
      ownerReview: cloneOwnerReview(ownerReview)
    };
  }

  function normalizeSourceRecord(value, expected) {
    if (!value || typeof value !== "object" || !value.sourcePackage || typeof value.sourceFingerprint !== "string") return null;
    if (expected?.jobId && value.jobId !== expected.jobId) return null;
    if (expected?.bookId && value.sourcePackage.bookId !== expected.bookId) return null;
    if (expected?.chapterId && value.sourcePackage.chapterId !== expected.chapterId) return null;
    if (expected?.chapterNumber && value.sourcePackage.chapterNumber !== expected.chapterNumber) return null;
    if (Number.isInteger(expected?.chapterVersion) && value.sourcePackage.chapterVersion !== expected.chapterVersion) return null;
    return {
      jobId: value.jobId,
      sourceFingerprint: value.sourceFingerprint,
      sourcePackage: cloneReviewReady(value.sourcePackage),
      ownerReview: cloneOwnerReview(value.ownerReview)
    };
  }

  function defaultSession(sourceFingerprint, resultFingerprint) {
    return { sourceFingerprint, resultFingerprint, viewMode: "changes", acceptedChangeIds: [] };
  }

  function normalizeSession(value, sourceIdentity, resultIdentity) {
    const fallback = defaultSession(sourceIdentity.packageFingerprint, resultIdentity.packageFingerprint);
    if (!value || typeof value !== "object") return fallback;
    if (value.sourceFingerprint !== sourceIdentity.packageFingerprint || value.resultFingerprint !== resultIdentity.packageFingerprint) return fallback;
    if (resultIdentity.bookId !== sourceIdentity.bookId || resultIdentity.chapterId !== sourceIdentity.chapterId) return fallback;
    const accepted = Array.isArray(value.acceptedChangeIds) ? [...new Set(value.acceptedChangeIds.filter((id) => typeof id === "string" && id))] : [];
    return {
      sourceFingerprint: sourceIdentity.packageFingerprint,
      resultFingerprint: resultIdentity.packageFingerprint,
      viewMode: VIEW_MODES.has(value.viewMode) ? value.viewMode : "changes",
      acceptedChangeIds: accepted
    };
  }

  function setViewMode(session, viewMode) {
    const mode = VIEW_MODES.has(viewMode) ? viewMode : "changes";
    return { ...session, viewMode: mode };
  }

  function reviewNotesLabel(count) {
    return `Review Notes (${Number(count) || 0})`;
  }

  function changesTabLabel(count) {
    return `Changes (${Number(count) || 0})`;
  }

  function versionRelationLabel(beforeVersion, afterVersion) {
    if (!Number.isInteger(beforeVersion) || !Number.isInteger(afterVersion)) return "";
    return `Version ${beforeVersion} → Version ${afterVersion}`;
  }

  function changeCardCount(model) {
    return (model?.changes?.length || 0) + (model?.unmatchedReviewItems?.length || 0) + (model?.titleChange ? 1 : 0);
  }

  function originalNoteCount(ownerReview) {
    return Array.isArray(ownerReview?.annotations) ? ownerReview.annotations.length : 0;
  }

  function revisionDisplayState({ viewMode, beforePackage, afterPackage, ownerReview, afterReview }) {
    const mode = VIEW_MODES.has(viewMode) ? viewMode : "changes";
    if (mode === "notes") {
      return {
        viewMode: "notes",
        package: beforePackage || null,
        annotations: Array.isArray(ownerReview?.annotations) ? ownerReview.annotations : [],
        readOnly: true,
        writesTo: "none",
        chapterVersion: beforePackage?.chapterVersion ?? null
      };
    }
    return {
      viewMode: mode,
      package: afterPackage || null,
      annotations: Array.isArray(afterReview?.annotations) ? afterReview.annotations : [],
      readOnly: false,
      writesTo: "afterReview",
      chapterVersion: afterPackage?.chapterVersion ?? null
    };
  }

  function applyAccepted(model, acceptedChangeIds) {
    const accepted = new Set(acceptedChangeIds || []);
    const changes = (model?.changes || []).map((change) => ({ ...change, accepted: accepted.has(change.id) }));
    const titleChange = model?.titleChange ? { ...model.titleChange, accepted: accepted.has(model.titleChange.id) } : null;
    return {
      ...model,
      titleChange,
      changes,
      unmatchedReviewItems: model?.unmatchedReviewItems || [],
      summary: {
        ...(model?.summary || {}),
        accepted: changes.filter((change) => change.accepted).length + (titleChange?.accepted ? 1 : 0)
      }
    };
  }

  function toggleAccepted(session, changeId) {
    const ids = new Set(session.acceptedChangeIds);
    if (ids.has(changeId)) ids.delete(changeId); else ids.add(changeId);
    return { ...session, acceptedChangeIds: [...ids] };
  }

  function acceptAll(session, changeIds) {
    return { ...session, acceptedChangeIds: [...new Set(changeIds.filter(Boolean))] };
  }

  function revisionViewState({
    hasRevisionPair,
    viewMode,
    jobStatus,
    originalNoteCount = 0,
    changeCount = 0,
    currentNoteCount = 0,
    beforeVersion,
    afterVersion
  }) {
    const pair = Boolean(hasRevisionPair);
    const mode = pair && VIEW_MODES.has(viewMode) ? viewMode : null;
    const readyOnSource = jobStatus === "REVISION_READY" && !pair;
    let noteCountLabel = reviewNotesLabel(currentNoteCount);
    if (pair && mode === "notes") noteCountLabel = reviewNotesLabel(originalNoteCount);
    if (pair && mode === "changes") noteCountLabel = changesTabLabel(changeCount);
    return {
      openRevisedHidden: !readyOnSource,
      openRevisedLabel: "Review Changes",
      tabsHidden: !pair,
      notesLabel: reviewNotesLabel(originalNoteCount),
      changesLabel: changesTabLabel(changeCount),
      notesPressed: mode === "notes",
      changesPressed: mode === "changes",
      fullPressed: mode === "full",
      showChanges: mode === "changes",
      showOriginalNotes: mode === "notes",
      showFullChapter: mode === "full" || !pair,
      toggleHidden: !pair,
      toggleLabel: "View Full Chapter",
      togglePressed: mode === "full",
      versionLabel: pair ? versionRelationLabel(beforeVersion, afterVersion) : "",
      modeSwitchLabel: "Review",
      noteCountLabel,
      countHidden: pair
    };
  }

  function ownerReviewFromLocal(review, sourcePackage) {
    if (!review || !review.completed || !Array.isArray(review.annotations) || !sourcePackage) return null;
    return {
      schemaVersion: 1,
      type: "owner_review",
      source: "owner",
      bookId: sourcePackage.bookId,
      chapterId: sourcePackage.chapterId,
      chapterNumber: sourcePackage.chapterNumber,
      chapterVersion: sourcePackage.chapterVersion,
      reviewedAt: review.reviewedAt || new Date().toISOString(),
      reviewStatus: "completed",
      annotations: review.annotations.map((note) => ({ ...note }))
    };
  }

  function ownerSelectedRanges(text, reviews) {
    const ranges = [];
    for (const note of reviews || []) {
      if (!note?.selectedText || !text) continue;
      if (Number.isInteger(note.selectionStart) && Number.isInteger(note.selectionEnd) && note.selectionEnd > note.selectionStart && text.slice(note.selectionStart, note.selectionEnd) === note.selectedText) {
        ranges.push({ start: note.selectionStart, end: note.selectionEnd });
        continue;
      }
      const index = text.indexOf(note.selectedText);
      if (index >= 0) ranges.push({ start: index, end: index + note.selectedText.length });
    }
    return ranges.sort((left, right) => left.start - right.start).filter((range, index, all) => !all[index - 1] || range.start >= all[index - 1].end);
  }

  function revisionComparisonLayout() {
    return {
      desktopColumns: ["new", "old"],
      mobileStack: ["new", "old", "ownerNote"],
      labels: { new: "New Version", old: "Old Version", ownerNote: "Owner Review Note" },
      kindBadgeSecondary: true
    };
  }

  return {
    cloneReviewReady,
    cloneOwnerReview,
    sourceStorageKey,
    sessionStorageKey,
    createSourceRecord,
    normalizeSourceRecord,
    defaultSession,
    normalizeSession,
    setViewMode,
    reviewNotesLabel,
    changesTabLabel,
    versionRelationLabel,
    changeCardCount,
    originalNoteCount,
    revisionDisplayState,
    applyAccepted,
    toggleAccepted,
    acceptAll,
    revisionViewState,
    ownerReviewFromLocal,
    ownerSelectedRanges,
    revisionComparisonLayout
  };
});
