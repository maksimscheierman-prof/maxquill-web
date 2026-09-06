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

  function ownerNoteIdFromChangeId(changeId) {
    if (typeof changeId !== "string") return null;
    if (changeId.startsWith("owner:")) return changeId.slice("owner:".length);
    return null;
  }

  function inferRevisionFeedbackKind(note) {
    if (note?.revisionFeedbackKind === "flag") return "flag";
    if (/^flagged(\b|\s)/i.test(String(note?.comment || "").trim())) return "flag";
    if (note?.revisionFeedbackKind === "comment") return "comment";
    if (note?.revisionChangeId || note?.sourceOwnerNoteId) return "comment";
    return null;
  }

  function normalizeRevisionFeedback(note) {
    if (!note) return null;
    const kind = inferRevisionFeedbackKind(note);
    return kind && note.revisionFeedbackKind !== kind ? { ...note, revisionFeedbackKind: kind } : note;
  }

  function feedbackMetaForChange(change) {
    return {
      sourceOwnerNoteId: change?.sourceOwnerNoteId || change?.ownerReviews?.[0]?.id || change?.annotation?.id || ownerNoteIdFromChangeId(change?.id) || null
    };
  }

  function applyAccepted(model, acceptedChangeIds, revisionAnnotations = []) {
    const accepted = new Set(acceptedChangeIds || []);
    const enrich = (change) => {
      if (!change) return null;
      const feedback = feedbackForChange(revisionAnnotations, change.id, feedbackMetaForChange(change));
      const decision = cardDecision({ accepted: accepted.has(change.id) && !feedback.length, feedbackNotes: feedback });
      return { ...change, accepted: decision.accepted, decision, revisionFeedback: feedback };
    };
    const changes = (model?.changes || []).map((change) => enrich(change));
    const titleChange = enrich(model?.titleChange);
    const unmatchedReviewItems = (model?.unmatchedReviewItems || []).map((item) => {
      const feedback = feedbackForChange(revisionAnnotations, item.id, feedbackMetaForChange(item));
      const decision = cardDecision({ accepted: accepted.has(item.id) && !feedback.length, feedbackNotes: feedback });
      return { ...item, accepted: decision.accepted, decision, revisionFeedback: feedback };
    });
    return {
      ...model,
      titleChange,
      changes,
      unmatchedReviewItems,
      summary: {
        ...(model?.summary || {}),
        accepted: changes.filter((change) => change.accepted).length + (titleChange?.accepted ? 1 : 0) + unmatchedReviewItems.filter((item) => item.accepted).length,
        needsRevision: [...changes, ...(titleChange ? [titleChange] : []), ...unmatchedReviewItems].filter((change) => change.decision?.state === "needs_revision" || change.decision?.state === "flagged").length,
        unresolved: [...changes, ...(titleChange ? [titleChange] : []), ...unmatchedReviewItems].filter((change) => change.decision?.state === "unresolved").length
      }
    };
  }

  function feedbackForChange(annotations, changeId, meta = {}) {
    const ownerNoteId = meta.sourceOwnerNoteId || ownerNoteIdFromChangeId(changeId);
    return (annotations || [])
      .filter((note) => {
        if (!note || note.status !== "open") return false;
        if (note.revisionChangeId === changeId) return true;
        if (ownerNoteId && note.sourceOwnerNoteId === ownerNoteId) return true;
        return false;
      })
      .map(normalizeRevisionFeedback)
      .filter(Boolean);
  }

  function cardDecision({ accepted = false, feedbackNotes = [] } = {}) {
    const openFeedback = (feedbackNotes || []).map(normalizeRevisionFeedback).filter((note) => note?.status === "open");
    if (openFeedback.length) {
      const flagged = openFeedback.some((note) => note.revisionFeedbackKind === "flag");
      const state = flagged ? "flagged" : "needs_revision";
      return {
        state,
        label: flagged ? "Flagged · Needs revision" : "Needs revision",
        headerLabel: flagged ? "FLAGGED" : "NEEDS REVISION",
        accepted: false,
        canAccept: false,
        showAccept: false,
        showUndoAccept: false,
        showComment: false,
        showFlag: false,
        showEditComment: !flagged,
        showRemoveComment: !flagged,
        showEditFlag: flagged,
        showRemoveFlag: flagged,
        feedbackNotes: openFeedback,
        actions: decisionActions(state)
      };
    }
    if (accepted) {
      return {
        state: "accepted",
        label: "Accepted",
        headerLabel: "ACCEPTED",
        accepted: true,
        canAccept: true,
        showAccept: false,
        showUndoAccept: true,
        showComment: false,
        showFlag: false,
        showEditComment: false,
        showRemoveComment: false,
        showEditFlag: false,
        showRemoveFlag: false,
        feedbackNotes: [],
        actions: decisionActions("accepted")
      };
    }
    return {
      state: "unresolved",
      label: "Unresolved",
      headerLabel: "",
      accepted: false,
      canAccept: true,
      showAccept: true,
      showUndoAccept: false,
      showComment: true,
      showFlag: true,
      showEditComment: false,
      showRemoveComment: false,
      showEditFlag: false,
      showRemoveFlag: false,
      feedbackNotes: [],
      actions: decisionActions("unresolved")
    };
  }

  function decisionActions(state) {
    if (state === "accepted") return ["accepted", "undo_accept"];
    if (state === "needs_revision") return ["edit_comment", "remove_comment"];
    if (state === "flagged") return ["edit_flag", "remove_flag"];
    return ["accept", "comment", "flag"];
  }

  function clearAccepted(session, changeId) {
    return { ...session, acceptedChangeIds: (session.acceptedChangeIds || []).filter((id) => id !== changeId) };
  }

  function setAccepted(session, changeId, accepted) {
    const ids = new Set(session.acceptedChangeIds || []);
    if (accepted) ids.add(changeId); else ids.delete(changeId);
    return { ...session, acceptedChangeIds: [...ids] };
  }

  function toggleAccepted(session, changeId) {
    const ids = new Set(session.acceptedChangeIds);
    if (ids.has(changeId)) ids.delete(changeId); else ids.add(changeId);
    return { ...session, acceptedChangeIds: [...ids] };
  }

  function acceptAll(session, changeIds) {
    return { ...session, acceptedChangeIds: [...new Set(changeIds.filter(Boolean))] };
  }

  function unresolvedRevisionFeedback(annotations) {
    return (annotations || []).filter((note) => typeof note?.revisionChangeId === "string" && note.revisionChangeId && note.status === "open");
  }

  function logicalReviewCards(model) {
    return [
      ...(model?.titleChange ? [model.titleChange] : []),
      ...(model?.changes || []),
      ...(model?.unmatchedReviewItems || []).map((item) => ({ ...item, id: item.id }))
    ];
  }

  function changesReviewResolved(model, session, revisionAnnotations = []) {
    const accepted = new Set(session?.acceptedChangeIds || []);
    for (const card of logicalReviewCards(model)) {
      if (!card?.id) continue;
      if (card.kind === "unchanged" || card.kind === "unmapped" || card.kind === "title_unchanged") {
        const feedback = feedbackForChange(revisionAnnotations, card.id, feedbackMetaForChange(card));
        if (!feedback.length) return false;
        continue;
      }
      const decision = cardDecision({
        accepted: accepted.has(card.id),
        feedbackNotes: feedbackForChange(revisionAnnotations, card.id, feedbackMetaForChange(card))
      });
      if (decision.state === "unresolved") return false;
    }
    return true;
  }

  function acceptAllEligibleIds(model, revisionAnnotations = []) {
    const ids = [];
    for (const card of [...(model?.titleChange ? [model.titleChange] : []), ...(model?.changes || []), ...(model?.unmatchedReviewItems || [])]) {
      const feedback = feedbackForChange(revisionAnnotations, card.id, feedbackMetaForChange(card));
      if (!feedback.length) ids.push(card.id);
    }
    return ids;
  }

  function buildNextRevisionAnnotations(annotations) {
    return unresolvedRevisionFeedback(annotations).map((note) => {
      const next = {
        id: note.id,
        paragraphId: note.paragraphId,
        selectedText: note.selectedText,
        selectionStart: note.selectionStart,
        selectionEnd: note.selectionEnd,
        category: note.category,
        comment: note.comment,
        status: note.status,
        requiresCanonChange: note.requiresCanonChange
      };
      if (note.target === "chapter_title") {
        return {
          id: note.id,
          target: "chapter_title",
          selectedText: note.selectedText,
          category: note.category,
          comment: note.comment,
          status: note.status,
          requiresCanonChange: note.requiresCanonChange
        };
      }
      return next;
    });
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
    feedbackForChange,
    inferRevisionFeedbackKind,
    normalizeRevisionFeedback,
    cardDecision,
    decisionActions,
    clearAccepted,
    setAccepted,
    toggleAccepted,
    acceptAll,
    unresolvedRevisionFeedback,
    logicalReviewCards,
    changesReviewResolved,
    acceptAllEligibleIds,
    buildNextRevisionAnnotations,
    revisionViewState,
    ownerReviewFromLocal,
    ownerSelectedRanges,
    revisionComparisonLayout
  };
});
