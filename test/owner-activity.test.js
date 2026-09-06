"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const activity = require("../owner-activity.js");
const reviewApi = require("../review-api.js");

const root = path.join(__dirname, "..");
const book = {
  id: "book-001",
  chapters: [{ number: 1, chapterId: "chapter_0001", title: "The Book He Never Asked For", status: "REVIEW_READY", version: 1 }]
};
const overviewChapter = {
  chapterId: "chapter_0001",
  chapterVersion: 1,
  packageFingerprint: "a".repeat(64),
  commentCount: 5,
  readerNames: ["Anna", "Max"]
};

function navPages() {
  return {
    index: fs.readFileSync(path.join(root, "index.html"), "utf8"),
    book: fs.readFileSync(path.join(root, "book.html"), "utf8"),
    reader: fs.readFileSync(path.join(root, "reader.html"), "utf8"),
    feedback: fs.readFileSync(path.join(root, "owner-feedback.html"), "utf8"),
    invite: fs.readFileSync(path.join(root, "invite.html"), "utf8")
  };
}

test("protected pages share Library, Owner Review, and Reader Feedback navigation", () => {
  const pages = navPages();
  for (const [name, html] of Object.entries(pages)) {
    if (name === "invite") continue;
    assert.match(html, /<nav class="owner-nav" aria-label="Owner">/);
    assert.match(html, /href="\/"[^>]*>Library</);
    assert.match(html, /href="\/reader.html"[^>]*>Owner Review</);
    assert.match(html, /href="\/owner-feedback.html"[^>]*>Reader Feedback</);
  }
  assert.doesNotMatch(pages.invite, /class="owner-nav"/);
  assert.doesNotMatch(pages.invite, /Owner Review/);
  assert.match(pages.index, /href="\/" aria-current="page">Library</);
  assert.match(pages.reader, /href="\/reader.html" aria-current="page">Owner Review</);
  assert.match(pages.feedback, /href="\/owner-feedback.html" aria-current="page">Reader Feedback</);
});

test("homepage has a compact Needs Attention region", () => {
  const html = navPages().index;
  assert.match(html, /id="activity-title">Needs Attention</);
  assert.match(html, /id="owner-activity"/);
  assert.match(html, /src="owner-activity.js"/);
  assert.match(html, /src="reader-feedback-api.js"/);
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.owner-activity\{/);
  assert.match(css, /\.activity-empty\{/);
});

test("open reader comments become chapter activity with a View Feedback link", () => {
  const items = activity.buildItems({
    book: { id: "book-001", chapters: [] },
    overviewChapters: [overviewChapter],
    openCommentsByKey: {
      [`${overviewChapter.chapterId}:${overviewChapter.chapterVersion}:${overviewChapter.packageFingerprint}`]: {
        commentCount: 3,
        readers: [{ reviewerId: "r1", displayName: "Anna" }, { reviewerId: "r2", displayName: "Max" }]
      }
    },
    localJobs: []
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "reader-feedback");
  assert.equal(items[0].title, "CH001 · 3 open reader comments");
  assert.equal(items[0].detail, "Anna, Max");
  assert.equal(items[0].href, "/owner-feedback.html");
  assert.equal(items[0].action, "View Feedback");
  assert.equal(activity.openCommentCount(items), 3);
  const html = activity.render(items);
  assert.match(html, /CH001 · 3 open reader comments/);
  assert.match(html, /Anna, Max/);
  assert.match(html, /href="\/owner-feedback.html">View Feedback</);
});

test("resolved-only chapters and empty overviews stay off the dashboard", () => {
  const resolved = activity.buildItems({
    book: { id: "book-001", chapters: [] },
    overviewChapters: [overviewChapter],
    openCommentsByKey: {
      [`${overviewChapter.chapterId}:${overviewChapter.chapterVersion}:${overviewChapter.packageFingerprint}`]: { commentCount: 0, readers: [] }
    },
    localJobs: []
  });
  assert.deepEqual(resolved, []);
  assert.match(activity.render([]), /Nothing needs attention/);
});

test("REVIEW_READY packages appear when no local job has consumed them", () => {
  const items = activity.buildItems({ book, overviewChapters: [], openCommentsByKey: {}, localJobs: [] });
  assert.equal(items[0].kind, "owner-review");
  assert.equal(items[0].title, "Owner review · 1 package waiting");
  assert.equal(items[0].href, "/reader.html?book=book-001&chapter=1&version=1");
  assert.match(activity.render(items), /Owner review · 1 package waiting/);
});

test("revision-ready and failed local jobs surface as owner attention", () => {
  const identity = { bookId: "book-001", chapterId: "chapter_0001", chapterVersion: 1, packageFingerprint: "b".repeat(64) };
  const items = activity.buildItems({
    book,
    overviewChapters: [],
    openCommentsByKey: {},
    localJobs: [
      reviewApi.normalizeJob({ jobId: "job-ready", status: "REVISION_READY", submittedAt: "2026-09-06T00:00:00.000Z", ...identity }, identity),
      reviewApi.normalizeJob({ jobId: "job-failed", status: "FAILED", submittedAt: "2026-09-06T00:00:00.000Z", bookId: "book-001", chapterId: "chapter_0002", chapterVersion: 1, packageFingerprint: "c".repeat(64) }, { bookId: "book-001", chapterId: "chapter_0002", chapterVersion: 1, packageFingerprint: "c".repeat(64) })
    ]
  });
  assert.equal(items.some((item) => item.kind === "owner-review"), false);
  assert.equal(items.find((item) => item.kind === "revision-ready").title, "Revision · 1 ready");
  assert.equal(items.find((item) => item.kind === "revision-failed").title, "Revision · 1 failed");
});

function job(status, overrides = {}) {
  const identity = {
    bookId: overrides.bookId || "book-001",
    chapterId: overrides.chapterId || "chapter_0001",
    chapterVersion: overrides.chapterVersion || 1,
    packageFingerprint: overrides.packageFingerprint || "a".repeat(64)
  };
  return reviewApi.normalizeJob({
    jobId: overrides.jobId || `job-${status.toLowerCase()}`,
    status,
    submittedAt: overrides.submittedAt || "2026-09-06T00:00:00.000Z",
    ...identity,
    ...(overrides.error ? { error: overrides.error } : {})
  }, identity);
}

test("FAILED only appears in Needs Attention", () => {
  const failed = job("FAILED", { jobId: "job-failed-only", packageFingerprint: "1".repeat(64) });
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: [failed] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "revision-failed");
  assert.equal(items[0].detail, "CH001");
  assert.equal(items[0].title, "Revision · 1 failed");
});

test("FAILED then later REVISION_READY for the same workflow hides the old failure", () => {
  const failed = job("FAILED", { jobId: "job-old-fail", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-06T01:00:00.000Z" });
  const ready = job("REVISION_READY", { jobId: "job-recovered", packageFingerprint: "2".repeat(64), submittedAt: "2026-09-06T02:00:00.000Z" });
  const localJobs = [failed, ready];
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs });
  assert.equal(items.some((item) => item.kind === "revision-failed"), false);
  assert.equal(items.find((item) => item.kind === "revision-ready").title, "Revision · 1 ready");
  assert.equal(items.find((item) => item.kind === "revision-ready").detail, "CH001");
  assert.equal(activity.activeAttentionJobs(localJobs).failed.length, 0);
  assert.equal(activity.activeAttentionJobs(localJobs).ready[0].jobId, "job-recovered");
});

test("FAILED old package then FAILED new package keeps the current failure visible", () => {
  const oldFail = job("FAILED", { jobId: "job-old", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-06T01:00:00.000Z" });
  const newFail = job("FAILED", { jobId: "job-new", packageFingerprint: "2".repeat(64), submittedAt: "2026-09-06T03:00:00.000Z" });
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: [oldFail, newFail] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "revision-failed");
  assert.equal(items[0].title, "Revision · 1 failed");
  assert.equal(activity.activeAttentionJobs([oldFail, newFail]).failed[0].jobId, "job-new");
});

test("historical failed job remains stored when superseded", () => {
  const storage = {
    data: {},
    get length() { return Object.keys(this.data).length; },
    key(index) { return Object.keys(this.data)[index] || null; },
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
  const failed = job("FAILED", { jobId: "job-historical", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-06T01:00:00.000Z" });
  const ready = job("REVISION_READY", { jobId: "job-current", packageFingerprint: "2".repeat(64), submittedAt: "2026-09-06T02:00:00.000Z" });
  storage.setItem(reviewApi.jobStorageKey(failed), JSON.stringify(failed));
  storage.setItem(reviewApi.jobStorageKey(ready), JSON.stringify(ready));
  const stored = activity.readLocalJobs(storage, reviewApi.normalizeJob);
  assert.equal(stored.length, 2);
  assert.ok(stored.some((item) => item.jobId === "job-historical" && item.status === "FAILED"));
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: stored });
  assert.equal(items.some((item) => item.kind === "revision-failed"), false);
  assert.equal(storage.getItem(reviewApi.jobStorageKey(failed)), JSON.stringify(failed));
});

test("unrelated chapter failure remains visible beside a recovered chapter", () => {
  const recoveredFail = job("FAILED", { jobId: "ch1-fail", chapterId: "chapter_0001", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-06T01:00:00.000Z" });
  const recoveredReady = job("REVISION_READY", { jobId: "ch1-ready", chapterId: "chapter_0001", packageFingerprint: "2".repeat(64), submittedAt: "2026-09-06T02:00:00.000Z" });
  const otherFail = job("FAILED", { jobId: "ch2-fail", chapterId: "chapter_0002", packageFingerprint: "3".repeat(64), submittedAt: "2026-09-06T01:30:00.000Z" });
  const items = activity.buildItems({
    book: { id: "book-001", chapters: [] },
    overviewChapters: [],
    openCommentsByKey: {},
    localJobs: [recoveredFail, recoveredReady, otherFail]
  });
  assert.equal(items.find((item) => item.kind === "revision-ready").detail, "CH001");
  assert.equal(items.find((item) => item.kind === "revision-failed").detail, "CH002");
  assert.equal(items.find((item) => item.kind === "revision-failed").title, "Revision · 1 failed");
});

test("reload preserves the correct Needs Attention result after supersession", () => {
  const localJobs = [
    job("FAILED", { jobId: "job-old-fail", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-06T01:00:00.000Z" }),
    job("REVISION_READY", { jobId: "job-ready", packageFingerprint: "2".repeat(64), submittedAt: "2026-09-06T02:00:00.000Z" })
  ];
  const first = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs });
  const second = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: [...localJobs] });
  assert.deepEqual(second, first);
  assert.equal(first.some((item) => item.kind === "revision-failed"), false);
  assert.equal(first.find((item) => item.kind === "revision-ready").detail, "CH001");
});

test("homepage activity loads open comments from owner-only invite APIs", async () => {
  const calls = [];
  const items = await activity.loadHomepageActivity({
    book,
    chapterOverview: async (bookId) => {
      calls.push({ type: "overview", bookId });
      return { bookId, chapters: [overviewChapter] };
    },
    chapterComments: async (query) => {
      calls.push({ type: "comments", query });
      return { commentCount: 2, readers: [{ reviewerId: "r1", displayName: "Anna" }] };
    },
    localJobs: []
  });
  assert.equal(calls[0].type, "overview");
  assert.equal(calls[0].bookId, "book-001");
  assert.equal(calls[1].type, "comments");
  assert.equal(calls[1].query.status, "open");
  assert.equal(calls[1].query.chapterId, "chapter_0001");
  assert.equal(items[0].title, "CH001 · 2 open reader comments");
  assert.doesNotMatch(JSON.stringify(calls), /\/api\/public\//);
});
