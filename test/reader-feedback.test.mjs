import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { requireOwner, requireWorker, requireReaderSession } from "../functions/_lib/auth.mjs";
import { ApiError } from "../functions/_lib/errors.mjs";
import { ReaderFeedbackService } from "../functions/_lib/reader-service.mjs";
import { ReviewQueueService } from "../functions/_lib/service.mjs";

const source = JSON.parse(fs.readFileSync(new URL("../content/books/demo-book/review/chapter_0001_v1.json", import.meta.url)));
const packageA = "a".repeat(64);
const packageB = "b".repeat(64);
const note = {
  id: "note-1",
  paragraphId: "p001",
  selectedText: source.content[0].text.substring(0, 3),
  selectionStart: 0,
  selectionEnd: 3,
  category: "wording",
  comment: "Revise this.",
  status: "open",
  requiresCanonChange: false
};
const ownerReview = () => ({
  schemaVersion: 1,
  type: "owner_review",
  source: "owner",
  bookId: source.bookId,
  chapterId: source.chapterId,
  chapterNumber: source.chapterNumber,
  chapterVersion: source.chapterVersion,
  reviewedAt: "2026-08-28T10:00:00.000Z",
  reviewStatus: "completed",
  annotations: [{ ...note }]
});

class MemoryReaderStore {
  constructor() {
    this.invites = [];
    this.reviewers = [];
    this.comments = [];
  }
  async createInvite(invite) {
    const row = {
      id: invite.id,
      book_id: invite.bookId,
      chapter_id: invite.chapterId,
      chapter_number: invite.chapterNumber,
      chapter_version: invite.chapterVersion,
      package_fingerprint: invite.packageFingerprint,
      package_title: invite.packageTitle,
      status: "ACTIVE",
      created_at: invite.now,
      expires_at: invite.expiresAt ?? null
    };
    this.invites.push(row);
    return row;
  }
  async inviteById(id) { return this.invites.find((row) => row.id === id) || null; }
  async listInvites(bookId) { return this.invites.filter((row) => row.book_id === bookId); }
  async createReviewer(reviewer) {
    const row = {
      id: reviewer.id,
      invite_id: reviewer.inviteId,
      display_name: reviewer.displayName,
      session_token_hash: reviewer.sessionTokenHash,
      created_at: reviewer.now,
      finished_at: null
    };
    this.reviewers.push(row);
    return row;
  }
  async reviewerById(id) { return this.reviewers.find((row) => row.id === id) || null; }
  async reviewerBySessionHash(hash) { return this.reviewers.find((row) => row.session_token_hash === hash) || null; }
  async finishReviewer(id, now) {
    const row = await this.reviewerById(id);
    if (row && !row.finished_at) row.finished_at = now;
    return row;
  }
  async createComment(comment) {
    const row = {
      id: comment.id,
      invite_id: comment.inviteId,
      reviewer_id: comment.reviewerId,
      book_id: comment.bookId,
      chapter_id: comment.chapterId,
      chapter_version: comment.chapterVersion,
      package_fingerprint: comment.packageFingerprint,
      paragraph_id: comment.paragraphId,
      selection_start: comment.selectionStart,
      selection_end: comment.selectionEnd,
      selected_text: comment.selectedText,
      comment_text: comment.commentText,
      category: comment.category ?? null,
      status: "open",
      created_at: comment.now,
      updated_at: comment.now
    };
    this.comments.push(row);
    return row;
  }
  async commentById(id) { return this.comments.find((row) => row.id === id) || null; }
  async commentsForChapter(bookId, chapterId, chapterVersion, packageFingerprint) {
    return this.comments
      .filter((row) => row.book_id === bookId && row.chapter_id === chapterId && row.chapter_version === chapterVersion && row.package_fingerprint === packageFingerprint)
      .map((row) => ({ ...row, reviewer_display_name: this.reviewers.find((reviewer) => reviewer.id === row.reviewer_id)?.display_name || "" }))
      .sort((a, b) => a.paragraph_id.localeCompare(b.paragraph_id) || a.selection_start - b.selection_start || a.created_at.localeCompare(b.created_at));
  }
  async commentsByReviewer(reviewerId) {
    return this.comments
      .filter((row) => row.reviewer_id === reviewerId)
      .map((row) => ({ ...row, reviewer_display_name: this.reviewers.find((reviewer) => reviewer.id === row.reviewer_id)?.display_name || "" }));
  }
  async resolveComment(id, now) {
    const row = await this.commentById(id);
    if (!row) return null;
    row.status = "resolved";
    row.updated_at = now;
    return row;
  }
  async chapterFeedbackStats(bookId) {
    const groups = new Map();
    for (const row of this.comments.filter((item) => item.book_id === bookId)) {
      const key = `${row.chapter_id}:${row.chapter_version}:${row.package_fingerprint}`;
      if (!groups.has(key)) {
        groups.set(key, {
          chapter_id: row.chapter_id,
          chapter_version: row.chapter_version,
          package_fingerprint: row.package_fingerprint,
          comment_count: 0,
          readers: new Set(),
          locations: new Set()
        });
      }
      const group = groups.get(key);
      group.comment_count += 1;
      group.readers.add(row.reviewer_id);
      group.locations.add(`${row.paragraph_id}:${row.selection_start}:${row.selection_end}`);
    }
    return [...groups.values()].map((group) => ({
      chapter_id: group.chapter_id,
      chapter_version: group.chapter_version,
      package_fingerprint: group.package_fingerprint,
      comment_count: group.comment_count,
      reader_count: group.readers.size,
      location_count: group.locations.size
    }));
  }
}

class MemoryJobStore {
  constructor() { this.rows = []; }
  async byPackage(book, chapter, version, fingerprint) {
    return this.rows.find((row) => row.book_id === book && row.chapter_id === chapter && row.chapter_version === version && row.package_fingerprint === fingerprint) || null;
  }
  async byId(id) { return this.rows.find((row) => row.id === id) || null; }
  async create(job) {
    const row = {
      id: job.id, book_id: job.bookId, chapter_id: job.chapterId, chapter_number: job.chapterNumber, chapter_version: job.chapterVersion,
      status: "QUEUED", package_fingerprint: job.packageFingerprint, review_fingerprint: job.reviewFingerprint,
      review_package_json: job.reviewJson, created_at: job.now, updated_at: job.now, worker_id: null, error_code: null, error_message: null
    };
    this.rows.push(row);
    return row;
  }
  async next() { return this.rows.find((row) => row.status === "QUEUED") || null; }
  async transition(id, from, to, workerId, now, changes = {}) {
    const row = await this.byId(id);
    if (!row || row.status !== from || (from !== "QUEUED" && !changes.skipWorkerMatch && row.worker_id !== workerId)) return null;
    row.status = to;
    row.updated_at = now;
    if (to === "CLAIMED") row.worker_id = workerId;
    return row;
  }
}

function readerService() {
  let n = 0;
  return new ReaderFeedbackService(new MemoryReaderStore(), {
    now: () => "2026-09-05T12:00:00.000Z",
    uuid: () => `id-${++n}`,
    token: async () => `${String(++n).padStart(2, "0")}${"ab".repeat(31)}`,
    hash: async (value) => `hash:${value}`
  });
}

async function expectApi(promise, status, code) {
  await assert.rejects(promise, (error) => error instanceof ApiError && error.status === status && error.code === code);
}

const inviteInput = {
  bookId: source.bookId,
  chapterId: source.chapterId,
  chapterNumber: source.chapterNumber,
  chapterVersion: source.chapterVersion,
  packageFingerprint: packageA,
  title: source.title
};

const commentInput = (overrides = {}) => ({
  packageFingerprint: packageA,
  paragraphId: "p001",
  selectionStart: 0,
  selectionEnd: 3,
  selectedText: source.content[0].text.substring(0, 3),
  commentText: "Felt abrupt.",
  category: "Pacing",
  ...overrides
});

test("owner can create invite", async () => {
  const service = readerService();
  const invite = await service.createInvite(inviteInput);
  assert.equal(invite.bookId, source.bookId);
  assert.equal(invite.chapterId, source.chapterId);
  assert.equal(invite.packageFingerprint, packageA);
  assert.match(invite.inviteId, /^[a-f0-9]{32,}$/i);
  assert.equal(invite.status, "ACTIVE");
});

test("invite opens exactly the bound chapter draft", async () => {
  const service = readerService();
  const created = await service.createInvite(inviteInput);
  const invite = await service.getInvite(created.inviteId);
  assert.equal(invite.chapterId, source.chapterId);
  assert.equal(invite.chapterVersion, source.chapterVersion);
  assert.equal(invite.packageFingerprint, packageA);
  assert.equal(invite.reviewType, "READER_REVIEW");
  assert.equal(invite.packageUrl, `content/books/${source.bookId}/review/${source.chapterId}_v${source.chapterVersion}.json`);
});

test("reader can set display name and create comments", async () => {
  const service = readerService();
  const created = await service.createInvite(inviteInput);
  const joined = await service.joinInvite(created.inviteId, { displayName: "Anna" });
  assert.equal(joined.displayName, "Anna");
  assert.ok(joined.sessionToken);
  const first = await service.addComment(joined.sessionToken, commentInput());
  const second = await service.addComment(joined.sessionToken, commentInput({
    selectionStart: 4,
    selectionEnd: 7,
    selectedText: source.content[0].text.substring(4, 7),
    commentText: "Second note."
  }));
  assert.equal(first.reviewerDisplayName, "Anna");
  assert.equal(first.paragraphId, "p001");
  assert.equal(first.selectionStart, 0);
  assert.equal(first.selectionEnd, 3);
  const own = await service.listOwnComments(joined.sessionToken);
  assert.equal(own.length, 2);
  assert.equal(second.commentText, "Second note.");
});

test("two readers on the same invite stay separated", async () => {
  const service = readerService();
  const created = await service.createInvite(inviteInput);
  const anna = await service.joinInvite(created.inviteId, { displayName: "Anna" });
  const tom = await service.joinInvite(created.inviteId, { displayName: "Anna" });
  assert.notEqual(anna.reviewerId, tom.reviewerId);
  await service.addComment(anna.sessionToken, commentInput({ commentText: "From first Anna." }));
  await service.addComment(tom.sessionToken, commentInput({ commentText: "From second Anna." }));
  const annaComments = await service.listOwnComments(anna.sessionToken);
  const tomComments = await service.listOwnComments(tom.sessionToken);
  assert.equal(annaComments.length, 1);
  assert.equal(tomComments.length, 1);
  assert.equal(annaComments[0].commentText, "From first Anna.");
  assert.equal(tomComments[0].commentText, "From second Anna.");
});

test("owner sees merged comments and can filter by reader", async () => {
  const service = readerService();
  const created = await service.createInvite(inviteInput);
  const anna = await service.joinInvite(created.inviteId, { displayName: "Anna" });
  const tom = await service.joinInvite(created.inviteId, { displayName: "Tom" });
  await service.addComment(anna.sessionToken, commentInput({ commentText: "Anna note" }));
  await service.addComment(tom.sessionToken, commentInput({ commentText: "Tom note" }));
  const all = await service.chapterComments({
    bookId: source.bookId,
    chapterId: source.chapterId,
    chapterVersion: source.chapterVersion,
    packageFingerprint: packageA
  });
  assert.equal(all.commentCount, 2);
  assert.equal(all.readerCount, 2);
  const filtered = await service.chapterComments({
    bookId: source.bookId,
    chapterId: source.chapterId,
    chapterVersion: source.chapterVersion,
    packageFingerprint: packageA,
    reviewerId: anna.reviewerId
  });
  assert.equal(filtered.commentCount, 1);
  assert.equal(filtered.comments[0].commentText, "Anna note");
});

test("chapter overview counts comments correctly", async () => {
  const service = readerService();
  const created = await service.createInvite(inviteInput);
  const anna = await service.joinInvite(created.inviteId, { displayName: "Anna" });
  const tom = await service.joinInvite(created.inviteId, { displayName: "Tom" });
  await service.addComment(anna.sessionToken, commentInput());
  await service.addComment(tom.sessionToken, commentInput({
    selectionStart: 4,
    selectionEnd: 7,
    selectedText: source.content[0].text.substring(4, 7),
    commentText: "Elsewhere"
  }));
  const overview = await service.chapterOverview(source.bookId);
  assert.equal(overview.chapters.length, 1);
  assert.equal(overview.chapters[0].commentCount, 2);
  assert.equal(overview.chapters[0].readerCount, 2);
  assert.equal(overview.chapters[0].locationCount, 2);
  assert.deepEqual(overview.chapters[0].readerNames.sort(), ["Anna", "Tom"]);
});

test("reader session cannot use owner or worker auth", async () => {
  const service = readerService();
  const created = await service.createInvite(inviteInput);
  const joined = await service.joinInvite(created.inviteId, { displayName: "Anna" });
  const readerRequest = new Request("https://example.test/api/reviews", {
    headers: { authorization: `Bearer ${joined.sessionToken}` }
  });
  await expectApi(requireOwner(readerRequest, {}, async () => false), 401, "UNAUTHORIZED");
  await expectApi(requireWorker(readerRequest, { MAXQUILL_WORKER_TOKEN: "worker-secret" }), 403, "FORBIDDEN");
  const session = await requireReaderSession(readerRequest, service);
  assert.equal(session.reviewer.id, joined.reviewerId);
});

test("reader comments never create owner revision jobs", async () => {
  const jobs = new ReviewQueueService(new MemoryJobStore(), {
    now: () => "2026-09-05T12:00:00.000Z",
    uuid: () => "job-owner-1"
  });
  const readers = readerService();
  const created = await readers.createInvite(inviteInput);
  const joined = await readers.joinInvite(created.inviteId, { displayName: "Anna" });
  await readers.addComment(joined.sessionToken, commentInput());
  await readers.finish(joined.sessionToken);
  assert.equal(jobs.store.rows.length, 0);
  const submitted = await jobs.submit(ownerReview(), packageA);
  assert.equal(submitted.created, true);
  assert.equal(submitted.job.status, "QUEUED");
});

test("draft fingerprint change isolates old reader comments", async () => {
  const service = readerService();
  const v1 = await service.createInvite(inviteInput);
  const anna = await service.joinInvite(v1.inviteId, { displayName: "Anna" });
  await service.addComment(anna.sessionToken, commentInput());
  await expectApi(service.addComment(anna.sessionToken, commentInput({ packageFingerprint: packageB })), 409, "STALE_PACKAGE");
  const v2 = await service.createInvite({ ...inviteInput, packageFingerprint: packageB, chapterVersion: 2 });
  const tom = await service.joinInvite(v2.inviteId, { displayName: "Tom" });
  await service.addComment(tom.sessionToken, commentInput({ packageFingerprint: packageB, commentText: "On v2" }));
  const old = await service.chapterComments({
    bookId: source.bookId,
    chapterId: source.chapterId,
    chapterVersion: 1,
    packageFingerprint: packageA
  });
  const next = await service.chapterComments({
    bookId: source.bookId,
    chapterId: source.chapterId,
    chapterVersion: 2,
    packageFingerprint: packageB
  });
  assert.equal(old.commentCount, 1);
  assert.equal(old.comments[0].commentText, "Felt abrupt.");
  assert.equal(next.commentCount, 1);
  assert.equal(next.comments[0].commentText, "On v2");
});

test("owner review submit/queue flow remains unchanged beside reader feedback", async () => {
  const jobs = new ReviewQueueService(new MemoryJobStore(), {
    now: () => "2026-09-05T12:00:00.000Z",
    uuid: () => "job-1"
  });
  const first = await jobs.submit(ownerReview(), packageA);
  const again = await jobs.submit(ownerReview(), packageA);
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.job.jobId, first.job.jobId);
  assert.equal((await jobs.claim(first.job.jobId, { workerId: "worker-1" })).status, "CLAIMED");
});

test("client helper groups comments by text location", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const api = require("../reader-feedback-api.js");
  const groups = api.groupCommentsByLocation([
    { paragraphId: "p001", selectionStart: 0, selectionEnd: 3, selectedText: "abc", reviewerDisplayName: "Anna", commentText: "A" },
    { paragraphId: "p001", selectionStart: 0, selectionEnd: 3, selectedText: "abc", reviewerDisplayName: "Tom", commentText: "B" },
    { paragraphId: "p002", selectionStart: 1, selectionEnd: 2, selectedText: "x", reviewerDisplayName: "Lisa", commentText: "C" }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].comments.length, 2);
  assert.equal(groups[1].comments.length, 1);
});

test("reader invite and comment route modules load", async () => {
  const modules = await Promise.all([
    import("../functions/api/invites.js"),
    import("../functions/api/invites/overview.js"),
    import("../functions/api/invites/comments.js"),
    import("../functions/api/invites/[token].js"),
    import("../functions/api/invites/[token]/join.js"),
    import("../functions/api/reader/comments.js"),
    import("../functions/api/reader/finish.js"),
    import("../functions/api/reader-comments/[id]/resolve.js"),
    import("../functions/review/invite/[token].js")
  ]);
  modules.forEach((module) => assert.equal(typeof module.onRequest, "function"));
});

test("owner invite route rejects unauthenticated browsers", async () => {
  const { onRequest } = await import("../functions/api/invites.js");
  const response = await onRequest({
    request: new Request("https://example.test/api/invites", { method: "POST", body: "{}" }),
    env: {}
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
});

test("reader cannot resolve comments through owner resolve route without Access", async () => {
  const { onRequest } = await import("../functions/api/reader-comments/[id]/resolve.js");
  const response = await onRequest({
    request: new Request("https://example.test/api/reader-comments/c1/resolve", {
      method: "POST",
      headers: { authorization: "Bearer reader-session" }
    }),
    env: {},
    params: { id: "c1" }
  });
  assert.equal(response.status, 401);
});
