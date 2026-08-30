import { ApiError } from "./errors.mjs";
import { fingerprint, validateOwnerReview, validateReviewReady } from "./contract.mjs";

const publicJob = (row) => ({ jobId: row.id, status: row.status, bookId: row.book_id, chapterId: row.chapter_id, chapterVersion: row.chapter_version, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.status === "FAILED" ? { error: { code: row.error_code || "REVISION_FAILED", message: row.error_message || "Revision failed." } } : {}) });
const workerJob = (row) => ({ ...publicJob(row), chapterNumber: row.chapter_number, reviewPackage: JSON.parse(row.review_package_json) });
function workerId(value) { if (!value || typeof value !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(value)) throw new ApiError(400, "INVALID_WORKER_ID", "A valid workerId is required."); return value; }
function packageFingerprint(value) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new ApiError(400, "INVALID_PACKAGE_FINGERPRINT", "A valid package fingerprint is required."); return value.toLowerCase(); }

export class ReviewQueueService {
  constructor(store, options = {}) { this.store = store; this.now = options.now || (() => new Date().toISOString()); this.uuid = options.uuid || (() => crypto.randomUUID()); }
  async submit(pkg, sourceFingerprint) {
    if (!validateOwnerReview(pkg).valid) throw new ApiError(400, "INVALID_REVIEW_PACKAGE", "Review package validation failed.");
    const packageHash = packageFingerprint(sourceFingerprint), reviewHash = await fingerprint(pkg), existing = await this.store.byPackage(pkg.bookId, pkg.chapterId, pkg.chapterVersion, packageHash);
    if (existing) { if (existing.review_fingerprint === reviewHash) return { job: publicJob(existing), created: false }; throw new ApiError(409, "REVIEW_PACKAGE_CONFLICT", "A different review for this exact draft has already been submitted."); }
    try {
      const row = await this.store.create({ id: this.uuid(), bookId: pkg.bookId, chapterId: pkg.chapterId, chapterNumber: pkg.chapterNumber, chapterVersion: pkg.chapterVersion, packageFingerprint: packageHash, reviewFingerprint: reviewHash, reviewJson: JSON.stringify(pkg), now: this.now() });
      return { job: publicJob(row), created: true };
    } catch (error) {
      const raced = await this.store.byPackage(pkg.bookId, pkg.chapterId, pkg.chapterVersion, packageHash);
      if (raced?.review_fingerprint === reviewHash) return { job: publicJob(raced), created: false };
      if (raced) throw new ApiError(409, "REVIEW_PACKAGE_CONFLICT", "A different review for this exact draft has already been submitted.");
      throw error;
    }
  }
  async status(id) { const row = await this.store.byId(id); if (!row) throw new ApiError(404, "JOB_NOT_FOUND", "Review job was not found."); return publicJob(row); }
  async next() { const row = await this.store.next(); return row ? workerJob(row) : null; }
  async claim(id, input) { return this.change(id, "QUEUED", "CLAIMED", workerId(input?.workerId)); }
  async processing(id, input) { return this.change(id, "CLAIMED", "PROCESSING", workerId(input?.workerId)); }
  async result(id, input) {
    const idValue = workerId(input?.workerId), row = await this.store.byId(id);
    if (!row) throw new ApiError(404, "JOB_NOT_FOUND", "Review job was not found.");
    const pkg = input?.reviewReadyPackage;
    if (!validateReviewReady(pkg).valid || pkg.bookId !== row.book_id || pkg.chapterId !== row.chapter_id || pkg.chapterNumber !== row.chapter_number || pkg.chapterVersion <= row.chapter_version) throw new ApiError(400, "INVALID_RESULT_PACKAGE", "Result package validation failed.");
    if (row.status === "REVISION_READY") {
      const stored = row.result_package_json ? JSON.parse(row.result_package_json) : null;
      if (stored && await fingerprint(stored) === await fingerprint(pkg)) return publicJob(row);
      throw new ApiError(409, "RESULT_CONFLICT", "A different result for this job has already been accepted.");
    }
    if (row.status === "FAILED") {
      if (!new Set(["HTTP_400", "INVALID_INPUT", "INVALID_RESULT_PACKAGE"]).has(row.error_code)) throw new ApiError(409, "INVALID_JOB_STATE", "Job state transition is not allowed.");
      return this.change(id, "FAILED", "REVISION_READY", idValue, { resultJson: JSON.stringify(pkg), skipWorkerMatch: true });
    }
    return this.change(id, "PROCESSING", "REVISION_READY", idValue, { resultJson: JSON.stringify(pkg) });
  }
  async fail(id, input) {
    const idValue = workerId(input?.workerId), code = input?.errorCode, message = input?.errorMessage;
    if (typeof code !== "string" || !/^[A-Z0-9_]{1,64}$/.test(code) || typeof message !== "string" || !message.trim() || message.length > 500) throw new ApiError(400, "INVALID_FAILURE", "Safe errorCode and errorMessage are required.");
    const row = await this.store.byId(id); if (!row) throw new ApiError(404, "JOB_NOT_FOUND", "Review job was not found.");
    if (!new Set(["CLAIMED", "PROCESSING"]).has(row.status)) throw new ApiError(409, "INVALID_JOB_STATE", "Job state transition is not allowed.");
    return this.change(id, row.status, "FAILED", idValue, { errorCode: code, errorMessage: message.trim() });
  }
  async change(id, from, to, worker, changes = {}) {
    const row = await this.store.byId(id); if (!row) throw new ApiError(404, "JOB_NOT_FOUND", "Review job was not found.");
    if (row.status !== from) throw new ApiError(409, "INVALID_JOB_STATE", "Job state transition is not allowed.");
    const updated = await this.store.transition(id, from, to, worker, this.now(), changes);
    if (!updated) throw new ApiError(409, "INVALID_JOB_STATE", "Job state transition is not allowed.");
    return publicJob(updated);
  }
}
