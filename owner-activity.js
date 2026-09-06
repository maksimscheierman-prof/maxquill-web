(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaxQuillOwnerActivity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function chapterLabel(chapterId) {
    const match = /^chapter_(\d+)$/.exec(chapterId || "");
    return match ? `CH${match[1].slice(-3).padStart(3, "0")}` : (chapterId || "Chapter");
  }

  function chapterNumberFromId(chapterId) {
    const match = /^chapter_0*([1-9]\d*)$/.exec(chapterId || "");
    return match ? Number(match[1]) : null;
  }

  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function keyFor(chapter) {
    return `${chapter.chapterId}:${chapter.chapterVersion}:${chapter.packageFingerprint}`;
  }

  function readerNames(details) {
    return [...new Set((details?.readers || []).map((reader) => reader.displayName).filter(Boolean))];
  }

  function reviewHref(bookId, chapterId, chapterVersion) {
    const number = chapterNumberFromId(chapterId);
    const params = new URLSearchParams({ book: bookId || "", version: String(chapterVersion || 1) });
    if (number) params.set("chapter", String(number));
    return `/reader.html?${params}`;
  }

  function buildItems({ book, overviewChapters, openCommentsByKey, localJobs } = {}) {
    const items = [];
    for (const chapter of overviewChapters || []) {
      const details = openCommentsByKey?.[keyFor(chapter)];
      const count = Number(details?.commentCount || 0);
      if (!count) continue;
      const names = readerNames(details);
      items.push({
        kind: "reader-feedback",
        title: `${chapterLabel(chapter.chapterId)} · ${count} open reader comment${count === 1 ? "" : "s"}`,
        detail: names.join(", "),
        href: "/owner-feedback.html",
        action: "View Feedback",
        badge: String(count)
      });
    }

    const jobs = localJobs || [];
    const submitted = new Set(jobs.map((job) => `${job.chapterId}:${job.chapterVersion}`));
    const waiting = (book?.chapters || []).filter((chapter) => {
      if (chapter.status !== "REVIEW_READY") return false;
      return !submitted.has(`${chapter.chapterId}:${chapter.version}`);
    });
    if (waiting.length) {
      const first = waiting[0];
      items.push({
        kind: "owner-review",
        title: `Owner review · ${waiting.length} package${waiting.length === 1 ? "" : "s"} waiting`,
        detail: first.title || "",
        href: `/reader.html?book=${encodeURIComponent(book.id)}&chapter=${first.number}&version=${first.version}`,
        action: "Review",
        badge: String(waiting.length)
      });
    }

    const ready = jobs.filter((job) => job.status === "REVISION_READY");
    const failed = jobs.filter((job) => job.status === "FAILED");
    if (ready.length) {
      const job = ready[0];
      items.push({
        kind: "revision-ready",
        title: `Revision · ${ready.length} ready`,
        detail: chapterLabel(job.chapterId),
        href: reviewHref(job.bookId, job.chapterId, job.chapterVersion),
        action: "Open",
        badge: String(ready.length)
      });
    }
    if (failed.length) {
      const job = failed[0];
      items.push({
        kind: "revision-failed",
        title: `Revision · ${failed.length} failed`,
        detail: chapterLabel(job.chapterId),
        href: reviewHref(job.bookId, job.chapterId, job.chapterVersion),
        action: "Open",
        badge: String(failed.length)
      });
    }
    return items;
  }

  function openCommentCount(items) {
    return (items || [])
      .filter((item) => item.kind === "reader-feedback")
      .reduce((sum, item) => sum + Number(item.badge || 0), 0);
  }

  function render(items) {
    if (!items?.length) return '<p class="activity-empty">Nothing needs attention</p>';
    return `<ol class="activity-list">${items.map((item) => {
      const detail = item.detail ? `<span>${escapeText(item.detail)}</span>` : "";
      return `<li class="activity-item" data-kind="${escapeText(item.kind)}"><div class="activity-copy"><strong>${escapeText(item.title)}</strong>${detail}</div><span class="activity-badge">${escapeText(item.badge)}</span><a class="quiet-link" href="${escapeText(item.href)}">${escapeText(item.action)}</a></li>`;
    }).join("")}</ol>`;
  }

  function readLocalJobs(storage = root.localStorage, normalizeJob = root.MaxQuillReviewApi?.normalizeJob) {
    if (!storage || typeof normalizeJob !== "function") return [];
    const jobs = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith("maxquill.review-job.")) continue;
      try {
        const raw = JSON.parse(storage.getItem(key));
        const job = normalizeJob(raw, {
          bookId: raw.bookId,
          chapterId: raw.chapterId,
          chapterVersion: raw.chapterVersion,
          packageFingerprint: raw.packageFingerprint
        });
        if (job) jobs.push(job);
      } catch (_) { /* ignore */ }
    }
    return jobs;
  }

  async function loadHomepageActivity({ book, chapterOverview, chapterComments, localJobs } = {}) {
    const overview = await chapterOverview(book.id);
    const openCommentsByKey = {};
    for (const chapter of overview.chapters || []) {
      openCommentsByKey[keyFor(chapter)] = await chapterComments({
        bookId: book.id,
        chapterId: chapter.chapterId,
        chapterVersion: chapter.chapterVersion,
        packageFingerprint: chapter.packageFingerprint,
        status: "open"
      });
    }
    return buildItems({ book, overviewChapters: overview.chapters, openCommentsByKey, localJobs });
  }

  return { chapterLabel, buildItems, openCommentCount, render, readLocalJobs, loadHomepageActivity };
});
