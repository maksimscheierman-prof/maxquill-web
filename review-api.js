(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaxQuillReviewApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const JOB_STATUSES = new Set(["QUEUED", "CLAIMED", "PROCESSING", "REVISION_READY", "FAILED"]);
  const STATUS_LABELS = { QUEUED: "Queued", CLAIMED: "Processing", PROCESSING: "Processing", REVISION_READY: "Revision ready", FAILED: "Failed" };
  class ReviewApiError extends Error { constructor(kind, message, status = 0) { super(message); this.name = "ReviewApiError"; this.kind = kind; this.status = status; } }
  function canonicalReviewPackageIdentity(pkg) {
    return JSON.stringify({ bookId: pkg.bookId, chapterId: pkg.chapterId, chapterVersion: pkg.chapterVersion, title: pkg.title, content: (pkg.content || []).map(({ id, text }) => ({ id, text })) });
  }
  async function reviewPackageFingerprint(pkg) {
    const subtle = root.crypto?.subtle;
    if (!subtle) throw new Error("SHA-256 support is unavailable.");
    const input = canonicalReviewPackageIdentity(pkg);
    const bytes = typeof root.TextEncoder === "function" ? new root.TextEncoder().encode(input) : Uint8Array.from(unescape(encodeURIComponent(input)), (character) => character.charCodeAt(0));
    return [...new Uint8Array(await subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function packageIdentity(pkg) { return { ...pkg, packageFingerprint: pkg.packageFingerprint || await reviewPackageFingerprint(pkg) }; }
  function packageStorageKey(kind, identity) {
    if (!identity.packageFingerprint) throw new Error("Package fingerprint is required for local storage.");
    return `maxquill.${kind}.${identity.bookId}.${identity.chapterId}.v${identity.chapterVersion}.${identity.packageFingerprint}`;
  }
  function reviewStorageKey(identity) { return packageStorageKey("review", identity); }
  function jobStorageKey(identity) { return packageStorageKey("review-job", identity); }
  function normalizeJob(value, identity) {
    if (!value || typeof value !== "object" || typeof value.jobId !== "string" || !value.jobId || !JOB_STATUSES.has(value.status)) return null;
    if (!identity.packageFingerprint || value.bookId !== identity.bookId || value.chapterId !== identity.chapterId || value.chapterVersion !== identity.chapterVersion || value.packageFingerprint !== identity.packageFingerprint) return null;
    return { jobId: value.jobId, bookId: value.bookId, chapterId: value.chapterId, chapterVersion: value.chapterVersion, packageFingerprint: value.packageFingerprint, status: value.status, submittedAt: value.submittedAt || value.createdAt || new Date().toISOString(), ...(value.error?.message ? { error: { message: value.error.message } } : {}) };
  }
  async function responseJson(response) { try { return await response.json(); } catch (_) { return null; } }
  function responseError(response, data, operation) {
    if (response.status === 401 || response.status === 403) return new ReviewApiError("auth", "Your owner session is unavailable or has expired. Sign in through Cloudflare Access and try again.", response.status);
    if (operation === "submit" && response.status === 409) return new ReviewApiError("conflict", "A different review for this chapter version has already been submitted.", response.status);
    const safe = typeof data?.error?.message === "string" ? data.error.message : "The backend could not complete the request.";
    return new ReviewApiError(operation === "submit" ? "rejected" : "status", safe, response.status);
  }
  async function submitOwnerReview(reviewPackage, sourcePackage, fetchImpl = root.fetch, contract = root.MaxQuillReviewContract) {
    const validation = contract?.validateOwnerReviewPackage?.(reviewPackage, sourcePackage);
    if (!validation?.valid) throw new ReviewApiError("validation", `Review cannot be submitted: ${(validation?.errors || ["Contract validation is unavailable."]).join(" ")}`);
    let response;
    try { response = await fetchImpl("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reviewPackage) }); }
    catch (_) { throw new ReviewApiError("submit-network", "Submit failed. Check your connection and try again."); }
    const data = await responseJson(response); if (!response.ok) throw responseError(response, data, "submit");
    const identity = await packageIdentity(sourcePackage);
    const job = normalizeJob({ ...data, packageFingerprint: identity.packageFingerprint, submittedAt: new Date().toISOString() }, identity);
    if (!job) throw new ReviewApiError("rejected", "Backend rejected review: the response did not contain a valid job.", response.status);
    return job;
  }
  async function getReviewJob(jobId, identity, fetchImpl = root.fetch) {
    let response;
    try { response = await fetchImpl(`/api/jobs/${encodeURIComponent(jobId)}`); }
    catch (_) { throw new ReviewApiError("status-network", "Status check failed. Check your connection; the submitted job is still saved locally."); }
    const data = await responseJson(response); if (!response.ok) throw responseError(response, data, "status");
    const resolvedIdentity = await packageIdentity(identity);
    const job = normalizeJob({ ...data, packageFingerprint: resolvedIdentity.packageFingerprint }, resolvedIdentity); if (!job || job.jobId !== jobId) throw new ReviewApiError("status", "Status check failed: the backend returned an invalid job.", response.status);
    return job;
  }
  return { ReviewApiError, STATUS_LABELS, canonicalReviewPackageIdentity, reviewPackageFingerprint, packageIdentity, reviewStorageKey, jobStorageKey, normalizeJob, submitOwnerReview, getReviewJob };
});
