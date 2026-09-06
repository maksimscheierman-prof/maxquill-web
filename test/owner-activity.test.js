"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const activity = require("../owner-activity.js");
const reviewApi = require("../review-api.js");
const revision = require("../revision-review.js");

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

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    data,
    get length() { return Object.keys(this.data).length; },
    key(index) { return Object.keys(this.data)[index] || null; },
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
}

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

function resultPackage(version = 2) {
  return {
    schemaVersion: 1,
    type: "review_ready_chapter",
    bookId: "book-001",
    chapterId: "chapter_0001",
    chapterNumber: 1,
    chapterVersion: version,
    status: "REVIEW_READY",
    title: "The Book He Never Asked For",
    exportedAt: "2026-09-05T18:12:52.899Z",
    content: [{ id: "p001", text: "Revised opening." }]
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
});

test("FAILED only appears in Needs Attention", () => {
  const failed = job("FAILED", { jobId: "job-failed-only", packageFingerprint: "1".repeat(64) });
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: [failed] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "revision-failed");
  assert.equal(items[0].detail, "CH001");
  assert.equal(items[0].title, "Revision · failed");
  assert.equal(items[0].badge, "OPEN");
});

test("FAILED source V1 plus successful revision result V2 hides failure and shows ready review", () => {
  const failedLocal = job("FAILED", {
    jobId: "34e65d22-77ae-4976-ae1b-54ddd63d2f39",
    packageFingerprint: "3f24df493cbf9d51c414c621fe1d18724d655ace9d0cd6efdf8b905d6de9eab5",
    submittedAt: "2026-09-05T17:44:04.338Z"
  });
  const syncedReady = { ...failedLocal, status: "REVISION_READY" };
  const result = resultPackage(2);
  const items = activity.buildItems({
    book: { id: "book-001", chapters: [] },
    overviewChapters: [],
    openCommentsByKey: {},
    localJobs: [syncedReady],
    resultPackagesByJobId: { [syncedReady.jobId]: result }
  });
  assert.equal(items.some((item) => item.kind === "revision-failed"), false);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "revision-ready");
  assert.equal(items[0].title, "Revision · ready for review");
  assert.equal(items[0].detail, "CH001 · Version 1 → Version 2");
  assert.equal(items[0].action, "REVIEW CHANGES");
  assert.equal(items[0].href, `/reader.html?book=book-001&chapter=1&version=2&resultJob=${syncedReady.jobId}`);
});

test("stale local FAILED is treated as ready when a result package exists for the same jobId", () => {
  const failed = job("FAILED", { jobId: "job-recovered", packageFingerprint: "1".repeat(64) });
  const items = activity.buildItems({
    book: { id: "book-001", chapters: [] },
    overviewChapters: [],
    openCommentsByKey: {},
    localJobs: [failed],
    resultPackagesByJobId: { "job-recovered": resultPackage(2) }
  });
  assert.equal(items.some((item) => item.kind === "revision-failed"), false);
  assert.equal(items[0].kind, "revision-ready");
  assert.equal(items[0].href, "/reader.html?book=book-001&chapter=1&version=2&resultJob=job-recovered");
});

test("ready CTA opens revised package Changes view by default", () => {
  const ready = job("REVISION_READY", { jobId: "job-ready", packageFingerprint: "2".repeat(64) });
  const href = activity.revisionChangesHref(ready, resultPackage(2));
  assert.equal(href, "/reader.html?book=book-001&chapter=1&version=2&resultJob=job-ready");
  const session = revision.defaultSession("source-fp", "result-fp");
  assert.equal(session.viewMode, "changes");
  const view = revision.revisionViewState({
    hasRevisionPair: true,
    viewMode: session.viewMode,
    jobStatus: "REVISION_READY",
    originalNoteCount: 16,
    changeCount: 4,
    beforeVersion: 1,
    afterVersion: 2
  });
  assert.equal(view.showChanges, true);
  assert.equal(view.showOriginalNotes, false);
  assert.equal(view.showFullChapter, false);
  assert.equal(view.notesLabel, "Review Notes (16)");
  assert.equal(view.changesLabel, "Changes (4)");
  assert.equal(view.toggleLabel, "View Full Chapter");
  assert.equal(view.toggleHidden, false);
});

test("refreshLocalJobs syncs REVISION_READY from the backend onto a stale FAILED local record", async () => {
  const failed = job("FAILED", {
    jobId: "34e65d22-77ae-4976-ae1b-54ddd63d2f39",
    packageFingerprint: "3f24df493cbf9d51c414c621fe1d18724d655ace9d0cd6efdf8b905d6de9eab5"
  });
  const storage = memoryStorage({ [reviewApi.jobStorageKey(failed)]: JSON.stringify(failed) });
  const refreshed = await activity.refreshLocalJobs({
    storage,
    normalizeJob: reviewApi.normalizeJob,
    jobStorageKey: reviewApi.jobStorageKey,
    getReviewJob: async () => ({ ...failed, status: "REVISION_READY" })
  });
  assert.equal(refreshed[0].status, "REVISION_READY");
  assert.equal(JSON.parse(storage.getItem(reviewApi.jobStorageKey(failed))).status, "REVISION_READY");
  const stillStored = activity.readLocalJobs(storage, reviewApi.normalizeJob);
  assert.equal(stillStored[0].jobId, failed.jobId);
});

test("hydrateRevisionResults caches the V2 package for a ready job", async () => {
  const ready = job("REVISION_READY", { jobId: "job-ready", packageFingerprint: "2".repeat(64) });
  const storage = memoryStorage();
  const result = resultPackage(2);
  const byJobId = await activity.hydrateRevisionResults({
    jobs: [ready],
    storage,
    resultStorageKey: reviewApi.resultStorageKey,
    getReviewResult: async () => result
  });
  assert.deepEqual(byJobId["job-ready"], result);
  assert.deepEqual(JSON.parse(storage.getItem(reviewApi.resultStorageKey("job-ready"))), result);
});

test("browser reload keeps the correct ready state after sync", async () => {
  const failed = job("FAILED", { jobId: "job-ch001", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-05T17:44:04.338Z" });
  const storage = memoryStorage({ [reviewApi.jobStorageKey(failed)]: JSON.stringify(failed) });
  const jobs = await activity.refreshLocalJobs({
    storage,
    normalizeJob: reviewApi.normalizeJob,
    jobStorageKey: reviewApi.jobStorageKey,
    getReviewJob: async () => ({ ...failed, status: "REVISION_READY" })
  });
  const results = { [failed.jobId]: resultPackage(2) };
  const first = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: jobs, resultPackagesByJobId: results });
  const reloadedJobs = activity.readLocalJobs(storage, reviewApi.normalizeJob);
  const second = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: reloadedJobs, resultPackagesByJobId: results });
  assert.deepEqual(second, first);
  assert.equal(first[0].kind, "revision-ready");
  assert.equal(first.some((item) => item.kind === "revision-failed"), false);
});

test("historical FAILED remains stored when a later REVISION_READY supersedes it", () => {
  const storage = memoryStorage();
  const failed = job("FAILED", { jobId: "job-historical", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-06T01:00:00.000Z" });
  const ready = job("REVISION_READY", { jobId: "job-current", packageFingerprint: "2".repeat(64), submittedAt: "2026-09-06T02:00:00.000Z" });
  storage.setItem(reviewApi.jobStorageKey(failed), JSON.stringify(failed));
  storage.setItem(reviewApi.jobStorageKey(ready), JSON.stringify(ready));
  const stored = activity.readLocalJobs(storage, reviewApi.normalizeJob);
  assert.equal(stored.length, 2);
  assert.ok(stored.some((item) => item.jobId === "job-historical" && item.status === "FAILED"));
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: stored });
  assert.equal(items.some((item) => item.kind === "revision-failed"), false);
  assert.equal(items[0].kind, "revision-ready");
  assert.equal(storage.getItem(reviewApi.jobStorageKey(failed)), JSON.stringify(failed));
});

test("genuinely current FAILED still appears", () => {
  const oldReady = job("REVISION_READY", { jobId: "job-old-ready", packageFingerprint: "1".repeat(64), submittedAt: "2026-09-06T01:00:00.000Z" });
  const newFail = job("FAILED", { jobId: "job-new-fail", packageFingerprint: "2".repeat(64), submittedAt: "2026-09-06T03:00:00.000Z" });
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: [oldReady, newFail] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "revision-failed");
  assert.equal(items[0].jobId, "job-new-fail");
});

test("package fingerprint isolation remains intact across versions", () => {
  const v1 = job("FAILED", { jobId: "job-v1", chapterVersion: 1, packageFingerprint: "1".repeat(64) });
  const v2 = job("FAILED", { jobId: "job-v2", chapterVersion: 2, packageFingerprint: "2".repeat(64) });
  assert.notEqual(reviewApi.jobStorageKey(v1), reviewApi.jobStorageKey(v2));
  const items = activity.buildItems({ book: { id: "book-001", chapters: [] }, overviewChapters: [], openCommentsByKey: {}, localJobs: [v1, v2] });
  assert.equal(items.filter((item) => item.kind === "revision-failed").length, 2);
});

test("unrelated chapter failure remains visible beside a recovered chapter", () => {
  const recovered = job("REVISION_READY", { jobId: "ch1-ready", chapterId: "chapter_0001", packageFingerprint: "2".repeat(64) });
  const otherFail = job("FAILED", { jobId: "ch2-fail", chapterId: "chapter_0002", packageFingerprint: "3".repeat(64) });
  const items = activity.buildItems({
    book: { id: "book-001", chapters: [] },
    overviewChapters: [],
    openCommentsByKey: {},
    localJobs: [recovered, otherFail],
    resultPackagesByJobId: { "ch1-ready": resultPackage(2) }
  });
  assert.equal(items.find((item) => item.kind === "revision-ready").detail, "CH001 · Version 1 → Version 2");
  assert.equal(items.find((item) => item.kind === "revision-failed").detail, "CH002");
});

test("completed revision review removes the ready item from Needs Attention", () => {
  const ready = job("REVISION_READY", { jobId: "job-ready", packageFingerprint: "1".repeat(64) });
  const result = resultPackage(2);
  const storage = memoryStorage({
    [`maxquill.review.book-001.chapter_0001.v2.${"9".repeat(64)}`]: JSON.stringify({ packageFingerprint: "9".repeat(64), completed: true, annotations: [] })
  });
  const completed = activity.readCompletedRevisionJobIds(storage, [ready], { "job-ready": result });
  assert.ok(completed.has("job-ready"));
  const items = activity.buildItems({
    book: { id: "book-001", chapters: [] },
    overviewChapters: [],
    openCommentsByKey: {},
    localJobs: [ready],
    resultPackagesByJobId: { "job-ready": result },
    completedJobIds: completed
  });
  assert.equal(items.some((item) => item.kind === "revision-ready"), false);
});

test("homepage scripts refresh jobs before rendering attention", () => {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /refreshLocalJobs/);
  assert.match(app, /hydrateRevisionResults/);
  assert.match(app, /readCompletedRevisionJobIds/);
  assert.match(app, /REVIEW CHANGES|resultPackagesByJobId/);
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
