import { ApiError } from "./errors.mjs";

const BOOK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHAPTER_ID = /^chapter_\d{4}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/i;
const PARAGRAPH_ID = /^p\d{3}$/;
const CATEGORIES = new Set(["Confusing", "Pacing", "Dialogue", "Character", "Continuity", "General", null, undefined, ""]);
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'\-]{0,62}$/u;

function nonEmpty(value, code, message) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, code, message);
  return value.trim();
}

function packageFingerprint(value) {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) throw new ApiError(400, "INVALID_PACKAGE_FINGERPRINT", "A valid package fingerprint is required.");
  return value.toLowerCase();
}

function publicInvite(row) {
  return {
    inviteId: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    chapterNumber: row.chapter_number,
    chapterVersion: row.chapter_version,
    packageFingerprint: row.package_fingerprint,
    title: row.package_title,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

function publicComment(row) {
  return {
    commentId: row.id,
    inviteId: row.invite_id,
    reviewerId: row.reviewer_id,
    reviewerDisplayName: row.reviewer_display_name || row.display_name || "",
    bookId: row.book_id,
    chapterId: row.chapter_id,
    chapterVersion: row.chapter_version,
    packageFingerprint: row.package_fingerprint,
    paragraphId: row.paragraph_id,
    selectionStart: row.selection_start,
    selectionEnd: row.selection_end,
    selectedText: row.selected_text,
    commentText: row.comment_text,
    category: row.category || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function inviteActive(row, nowIso) {
  if (!row || row.status !== "ACTIVE") return false;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(nowIso)) return false;
  return true;
}

export class ReaderFeedbackService {
  constructor(store, options = {}) {
    this.store = store;
    this.now = options.now || (() => new Date().toISOString());
    this.uuid = options.uuid || (() => crypto.randomUUID());
    this.token = options.token || (async () => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    });
    this.hash = options.hash || (async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    });
  }

  async createInvite(input) {
    const bookId = nonEmpty(input?.bookId, "INVALID_INPUT", "bookId is required.");
    const chapterId = nonEmpty(input?.chapterId, "INVALID_INPUT", "chapterId is required.");
    const title = nonEmpty(input?.title, "INVALID_INPUT", "title is required.");
    if (!BOOK_ID.test(bookId) || !CHAPTER_ID.test(chapterId)) throw new ApiError(400, "INVALID_INPUT", "bookId or chapterId is invalid.");
    if (!Number.isInteger(input?.chapterNumber) || input.chapterNumber < 1) throw new ApiError(400, "INVALID_INPUT", "chapterNumber is invalid.");
    if (!Number.isInteger(input?.chapterVersion) || input.chapterVersion < 1) throw new ApiError(400, "INVALID_INPUT", "chapterVersion is invalid.");
    const packageHash = packageFingerprint(input?.packageFingerprint);
    let expiresAt = null;
    if (input?.expiresAt !== undefined && input?.expiresAt !== null) {
      if (typeof input.expiresAt !== "string" || Number.isNaN(Date.parse(input.expiresAt))) throw new ApiError(400, "INVALID_INPUT", "expiresAt is invalid.");
      expiresAt = input.expiresAt;
    }
    const id = await this.token();
    const row = await this.store.createInvite({
      id, bookId, chapterId, chapterNumber: input.chapterNumber, chapterVersion: input.chapterVersion,
      packageFingerprint: packageHash, packageTitle: title, now: this.now(), expiresAt
    });
    return {
      ...publicInvite(row),
      invitePath: `/review/invite/${row.id}`,
      inviteUrlPath: `/invite.html?token=${encodeURIComponent(row.id)}`
    };
  }

  async getInvite(token) {
    const row = await this.store.inviteById(nonEmpty(token, "INVALID_INVITE", "Invite token is required."));
    if (!row) throw new ApiError(404, "INVITE_NOT_FOUND", "Invite was not found.");
    const now = this.now();
    if (!inviteActive(row, now)) throw new ApiError(410, "INVITE_INACTIVE", "Invite is inactive or expired.");
    return {
      reviewType: "READER_REVIEW",
      ...publicInvite(row),
      packageUrl: `content/books/${encodeURIComponent(row.book_id)}/review/${row.chapter_id}_v${row.chapter_version}.json`
    };
  }

  async joinInvite(token, input) {
    const invite = await this.getInvite(token);
    const displayName = nonEmpty(input?.displayName, "INVALID_DISPLAY_NAME", "A display name is required.");
    if (!NAME.test(displayName) || displayName.length > 64) throw new ApiError(400, "INVALID_DISPLAY_NAME", "Display name is invalid.");
    const sessionToken = await this.token();
    const reviewer = await this.store.createReviewer({
      id: this.uuid(),
      inviteId: invite.inviteId,
      displayName,
      sessionTokenHash: await this.hash(sessionToken),
      now: this.now()
    });
    return {
      reviewType: "READER_REVIEW",
      inviteId: invite.inviteId,
      reviewerId: reviewer.id,
      displayName: reviewer.display_name,
      sessionToken,
      bookId: invite.bookId,
      chapterId: invite.chapterId,
      chapterNumber: invite.chapterNumber,
      chapterVersion: invite.chapterVersion,
      packageFingerprint: invite.packageFingerprint,
      title: invite.title,
      packageUrl: invite.packageUrl
    };
  }

  async resolveSession(sessionToken) {
    if (typeof sessionToken !== "string" || !sessionToken.trim()) throw new ApiError(401, "UNAUTHORIZED", "Reader session is required.");
    const reviewer = await this.store.reviewerBySessionHash(await this.hash(sessionToken.trim()));
    if (!reviewer) throw new ApiError(401, "UNAUTHORIZED", "Reader session is invalid.");
    const invite = await this.store.inviteById(reviewer.invite_id);
    if (!inviteActive(invite, this.now())) throw new ApiError(410, "INVITE_INACTIVE", "Invite is inactive or expired.");
    return { reviewer, invite };
  }

  async addComment(sessionToken, input) {
    const { reviewer, invite } = await this.resolveSession(sessionToken);
    const packageHash = packageFingerprint(input?.packageFingerprint);
    if (packageHash !== invite.package_fingerprint) throw new ApiError(409, "STALE_PACKAGE", "Comments must target the invite draft fingerprint.");
    const paragraphId = nonEmpty(input?.paragraphId, "INVALID_COMMENT", "paragraphId is required.");
    const selectedText = nonEmpty(input?.selectedText, "INVALID_COMMENT", "selectedText is required.");
    const commentText = nonEmpty(input?.commentText, "INVALID_COMMENT", "commentText is required.");
    if (!PARAGRAPH_ID.test(paragraphId)) throw new ApiError(400, "INVALID_COMMENT", "paragraphId is invalid.");
    if (!Number.isInteger(input?.selectionStart) || input.selectionStart < 0) throw new ApiError(400, "INVALID_COMMENT", "selectionStart is invalid.");
    if (!Number.isInteger(input?.selectionEnd) || input.selectionEnd <= input.selectionStart) throw new ApiError(400, "INVALID_COMMENT", "selectionEnd is invalid.");
    if (commentText.length > 4000 || selectedText.length > 4000) throw new ApiError(400, "INVALID_COMMENT", "Comment text is too long.");
    const category = input?.category == null || input?.category === "" ? null : String(input.category);
    if (!CATEGORIES.has(category)) throw new ApiError(400, "INVALID_COMMENT", "category is invalid.");
    const row = await this.store.createComment({
      id: this.uuid(),
      inviteId: invite.id,
      reviewerId: reviewer.id,
      bookId: invite.book_id,
      chapterId: invite.chapter_id,
      chapterVersion: invite.chapter_version,
      packageFingerprint: packageHash,
      paragraphId,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      selectedText,
      commentText,
      category,
      now: this.now()
    });
    row.reviewer_display_name = reviewer.display_name;
    return publicComment(row);
  }

  async listOwnComments(sessionToken) {
    const { reviewer } = await this.resolveSession(sessionToken);
    return (await this.store.commentsByReviewer(reviewer.id)).map(publicComment);
  }

  async finish(sessionToken) {
    const { reviewer } = await this.resolveSession(sessionToken);
    const row = await this.store.finishReviewer(reviewer.id, this.now());
    return { reviewerId: row.id, finishedAt: row.finished_at, reviewType: "READER_REVIEW" };
  }

  async listInvites(bookId) {
    const id = nonEmpty(bookId, "INVALID_INPUT", "bookId is required.");
    if (!BOOK_ID.test(id)) throw new ApiError(400, "INVALID_INPUT", "bookId is invalid.");
    const invites = await this.store.listInvites(id);
    return invites.map(publicInvite);
  }

  async chapterOverview(bookId) {
    const id = nonEmpty(bookId, "INVALID_INPUT", "bookId is required.");
    if (!BOOK_ID.test(id)) throw new ApiError(400, "INVALID_INPUT", "bookId is invalid.");
    const stats = await this.store.chapterFeedbackStats(id);
    const invites = await this.store.listInvites(id);
    const chapters = [];
    for (const row of stats) {
      const comments = await this.store.commentsForChapter(id, row.chapter_id, row.chapter_version, row.package_fingerprint);
      const readerNames = [...new Set(comments.map((item) => item.reviewer_display_name).filter(Boolean))];
      chapters.push({
        chapterId: row.chapter_id,
        chapterVersion: row.chapter_version,
        packageFingerprint: row.package_fingerprint,
        commentCount: Number(row.comment_count),
        readerCount: Number(row.reader_count),
        locationCount: Number(row.location_count),
        readerNames,
        inviteIds: invites
          .filter((invite) => invite.chapter_id === row.chapter_id && invite.chapter_version === row.chapter_version && invite.package_fingerprint === row.package_fingerprint)
          .map((invite) => invite.id)
      });
    }
    return { bookId: id, chapters };
  }

  async chapterComments(query) {
    const bookId = nonEmpty(query?.bookId, "INVALID_INPUT", "bookId is required.");
    const chapterId = nonEmpty(query?.chapterId, "INVALID_INPUT", "chapterId is required.");
    if (!BOOK_ID.test(bookId) || !CHAPTER_ID.test(chapterId)) throw new ApiError(400, "INVALID_INPUT", "bookId or chapterId is invalid.");
    if (!Number.isInteger(Number(query?.chapterVersion)) || Number(query.chapterVersion) < 1) throw new ApiError(400, "INVALID_INPUT", "chapterVersion is invalid.");
    const packageHash = packageFingerprint(query?.packageFingerprint);
    const chapterVersion = Number(query.chapterVersion);
    const rows = await this.store.commentsForChapter(bookId, chapterId, chapterVersion, packageHash);
    let comments = rows.map(publicComment);
    if (query?.reviewerId) comments = comments.filter((item) => item.reviewerId === query.reviewerId);
    if (query?.status === "open") comments = comments.filter((item) => item.status === "open");
    const readers = [...new Map(comments.map((item) => [item.reviewerId, { reviewerId: item.reviewerId, displayName: item.reviewerDisplayName }])).values()];
    return {
      reviewType: "READER_REVIEW",
      bookId,
      chapterId,
      chapterVersion,
      packageFingerprint: packageHash,
      readerCount: readers.length,
      commentCount: comments.length,
      readers,
      comments
    };
  }

  async resolveComment(commentId) {
    const id = nonEmpty(commentId, "INVALID_INPUT", "commentId is required.");
    const existing = await this.store.commentById(id);
    if (!existing) throw new ApiError(404, "COMMENT_NOT_FOUND", "Comment was not found.");
    const row = await this.store.resolveComment(id, this.now());
    if (!row) throw new ApiError(409, "COMMENT_CONFLICT", "Comment could not be resolved.");
    const reviewer = await this.store.reviewerById(row.reviewer_id);
    row.reviewer_display_name = reviewer?.display_name || "";
    return publicComment(row);
  }
}
