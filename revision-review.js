(function (root, factory) {
  const review = factory();
  if (typeof module === "object" && module.exports) module.exports = review;
  else root.MaxQuillRevisionReview = review;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VIEW_MODES = new Set(["changes", "full"]);

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

  function applyAccepted(model, acceptedChangeIds) {
    const accepted = new Set(acceptedChangeIds || []);
    const changes = (model?.changes || []).map((change) => ({ ...change, accepted: accepted.has(change.id) }));
    return {
      ...model,
      changes,
      unmatchedReviewItems: model?.unmatchedReviewItems || [],
      summary: {
        ...(model?.summary || {}),
        accepted: changes.filter((change) => change.accepted).length
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

  function revisionViewState({ hasRevisionPair, viewMode, jobStatus }) {
    const changes = hasRevisionPair && viewMode === "changes";
    return {
      openRevisedHidden: jobStatus !== "REVISION_READY",
      openRevisedLabel: "Review Changes",
      toggleHidden: !hasRevisionPair,
      toggleLabel: changes ? "View Full Chapter" : "Review Changes",
      showChanges: Boolean(changes)
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

  return {
    cloneReviewReady,
    cloneOwnerReview,
    sourceStorageKey,
    sessionStorageKey,
    createSourceRecord,
    normalizeSourceRecord,
    defaultSession,
    normalizeSession,
    applyAccepted,
    toggleAccepted,
    acceptAll,
    revisionViewState,
    ownerReviewFromLocal
  };
});
