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
