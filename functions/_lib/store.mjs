export class D1JobStore {
  constructor(db) { this.db = db; }
  async byVersion(bookId, chapterId, chapterVersion) { return this.db.prepare("SELECT * FROM review_jobs WHERE book_id = ? AND chapter_id = ? AND chapter_version = ?").bind(bookId, chapterId, chapterVersion).first(); }
  async byId(id) { return this.db.prepare("SELECT * FROM review_jobs WHERE id = ?").bind(id).first(); }
  async create(job) {
    await this.db.prepare("INSERT INTO review_jobs (id, book_id, chapter_id, chapter_number, chapter_version, status, package_fingerprint, review_package_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)").bind(job.id, job.bookId, job.chapterId, job.chapterNumber, job.chapterVersion, job.fingerprint, job.reviewJson, job.now, job.now).run();
    return this.byId(job.id);
  }
  async next() { return this.db.prepare("SELECT * FROM review_jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1").first(); }
  async transition(id, from, to, workerId, now, changes = {}) {
    const timestampColumn = { CLAIMED: "claimed_at", PROCESSING: "processing_started_at", REVISION_READY: "completed_at", FAILED: "failed_at" }[to];
    const assignments = ["status = ?", "updated_at = ?", `${timestampColumn} = ?`], values = [to, now, now];
    if (to === "CLAIMED") { assignments.push("worker_id = ?", "attempt_count = attempt_count + 1"); values.push(workerId); }
    if (to === "REVISION_READY") { assignments.push("result_package_json = ?"); values.push(changes.resultJson); }
    if (to === "FAILED") { assignments.push("error_code = ?", "error_message = ?"); values.push(changes.errorCode, changes.errorMessage); }
    values.push(id, from);
    let where = "id = ? AND status = ?";
    if (from !== "QUEUED") { where += " AND worker_id = ?"; values.push(workerId); }
    const result = await this.db.prepare(`UPDATE review_jobs SET ${assignments.join(", ")} WHERE ${where}`).bind(...values).run();
    return Number(result.meta?.changes || 0) === 1 ? this.byId(id) : null;
  }
}
