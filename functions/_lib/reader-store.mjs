export class D1ReaderStore {
  constructor(db) { this.db = db; }

  async createInvite(invite) {
    await this.db.prepare(
      `INSERT INTO reader_invites (id, book_id, chapter_id, chapter_number, chapter_version, package_fingerprint, package_title, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
    ).bind(invite.id, invite.bookId, invite.chapterId, invite.chapterNumber, invite.chapterVersion, invite.packageFingerprint, invite.packageTitle, invite.now, invite.expiresAt ?? null).run();
    return this.inviteById(invite.id);
  }

  async inviteById(id) {
    return this.db.prepare("SELECT * FROM reader_invites WHERE id = ?").bind(id).first();
  }

  async listInvites(bookId) {
    return (await this.db.prepare("SELECT * FROM reader_invites WHERE book_id = ? ORDER BY created_at DESC").bind(bookId).all()).results || [];
  }

  async createReviewer(reviewer) {
    await this.db.prepare(
      `INSERT INTO reader_reviewers (id, invite_id, display_name, session_token_hash, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    ).bind(reviewer.id, reviewer.inviteId, reviewer.displayName, reviewer.sessionTokenHash, reviewer.now).run();
    return this.reviewerById(reviewer.id);
  }

  async reviewerById(id) {
    return this.db.prepare("SELECT * FROM reader_reviewers WHERE id = ?").bind(id).first();
  }

  async reviewerBySessionHash(hash) {
    return this.db.prepare("SELECT * FROM reader_reviewers WHERE session_token_hash = ?").bind(hash).first();
  }

  async finishReviewer(id, now) {
    await this.db.prepare("UPDATE reader_reviewers SET finished_at = ? WHERE id = ? AND finished_at IS NULL").bind(now, id).run();
    return this.reviewerById(id);
  }

  async createComment(comment) {
    await this.db.prepare(
      `INSERT INTO reader_comments
        (id, invite_id, reviewer_id, book_id, chapter_id, chapter_version, package_fingerprint,
         paragraph_id, selection_start, selection_end, selected_text, comment_text, category, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).bind(
      comment.id, comment.inviteId, comment.reviewerId, comment.bookId, comment.chapterId, comment.chapterVersion,
      comment.packageFingerprint, comment.paragraphId, comment.selectionStart, comment.selectionEnd,
      comment.selectedText, comment.commentText, comment.category ?? null, comment.now, comment.now
    ).run();
    return this.commentById(comment.id);
  }

  async commentById(id) {
    return this.db.prepare("SELECT * FROM reader_comments WHERE id = ?").bind(id).first();
  }

  async commentsForInvite(inviteId, packageFingerprint) {
    return (await this.db.prepare(
      `SELECT c.*, r.display_name AS reviewer_display_name
       FROM reader_comments c
       JOIN reader_reviewers r ON r.id = c.reviewer_id
       WHERE c.invite_id = ? AND c.package_fingerprint = ?
       ORDER BY c.paragraph_id ASC, c.selection_start ASC, c.created_at ASC`
    ).bind(inviteId, packageFingerprint).all()).results || [];
  }

  async commentsForChapter(bookId, chapterId, chapterVersion, packageFingerprint) {
    return (await this.db.prepare(
      `SELECT c.*, r.display_name AS reviewer_display_name
       FROM reader_comments c
       JOIN reader_reviewers r ON r.id = c.reviewer_id
       WHERE c.book_id = ? AND c.chapter_id = ? AND c.chapter_version = ? AND c.package_fingerprint = ?
       ORDER BY c.paragraph_id ASC, c.selection_start ASC, c.created_at ASC`
    ).bind(bookId, chapterId, chapterVersion, packageFingerprint).all()).results || [];
  }

  async commentsByReviewer(reviewerId) {
    return (await this.db.prepare(
      `SELECT c.*, r.display_name AS reviewer_display_name
       FROM reader_comments c
       JOIN reader_reviewers r ON r.id = c.reviewer_id
       WHERE c.reviewer_id = ?
       ORDER BY c.created_at ASC`
    ).bind(reviewerId).all()).results || [];
  }

  async resolveComment(id, now) {
    const result = await this.db.prepare(
      "UPDATE reader_comments SET status = 'resolved', updated_at = ? WHERE id = ?"
    ).bind(now, id).run();
    return Number(result.meta?.changes || 0) === 1 ? this.commentById(id) : null;
  }

  async reviewersForInvite(inviteId) {
    return (await this.db.prepare("SELECT * FROM reader_reviewers WHERE invite_id = ? ORDER BY created_at ASC").bind(inviteId).all()).results || [];
  }

  async chapterFeedbackStats(bookId) {
    return (await this.db.prepare(
      `SELECT
         c.chapter_id AS chapter_id,
         c.chapter_version AS chapter_version,
         c.package_fingerprint AS package_fingerprint,
         COUNT(*) AS comment_count,
         COUNT(DISTINCT c.reviewer_id) AS reader_count,
         COUNT(DISTINCT c.paragraph_id || ':' || c.selection_start || ':' || c.selection_end) AS location_count
       FROM reader_comments c
       WHERE c.book_id = ?
       GROUP BY c.chapter_id, c.chapter_version, c.package_fingerprint
       ORDER BY c.chapter_id ASC, c.chapter_version ASC`
    ).bind(bookId).all()).results || [];
  }
}
