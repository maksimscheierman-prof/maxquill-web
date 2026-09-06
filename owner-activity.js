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

  function workflowKey(job) {
    return `${job.bookId}:${job.chapterId}:${job.chapterVersion}`;
  }

  function jobTime(job) {
    const value = Date.parse(job?.submittedAt || "");
    return Number.isFinite(value) ? value : 0;
  }

  function afterVersionFor(job, resultPackage) {
    if (Number.isInteger(resultPackage?.chapterVersion)) return resultPackage.chapterVersion;
    return Number(job.chapterVersion) + 1;
  }

  function revisionChangesHref(job, resultPackage) {
    const number = chapterNumberFromId(job.chapterId);
    const params = new URLSearchParams();
    params.set("book", job.bookId || "");
    if (number) params.set("chapter", String(number));
    params.set("version", String(afterVersionFor(job, resultPackage)));
    params.set("resultJob", job.jobId);
    return `/reader.html?${params}`;
  }

  function failedHref(job) {
    const number = chapterNumberFromId(job.chapterId);
    const params = new URLSearchParams();
    params.set("book", job.bookId || "");
    if (number) params.set("chapter", String(number));
    params.set("version", String(job.chapterVersion || 1));
    return `/reader.html?${params}`;
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

  function readLocalResultPackages(storage = root.localStorage) {
    if (!storage) return {};
    const byJobId = {};
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith("maxquill.result-package.")) continue;
      const jobId = key.slice("maxquill.result-package.".length);
      try {
        const pkg = JSON.parse(storage.getItem(key));
        if (pkg && typeof pkg === "object" && pkg.type === "review_ready_chapter") byJobId[jobId] = pkg;
      } catch (_) { /* ignore */ }
    }
    return byJobId;
  }

  function readCompletedRevisionJobIds(storage = root.localStorage, jobs = [], resultPackagesByJobId = {}) {
    if (!storage) return new Set();
    const dismissed = new Set();
    for (const job of jobs) {
      if (!job?.jobId) continue;
      const after = afterVersionFor(job, resultPackagesByJobId[job.jobId]);
      const prefix = `maxquill.review.${job.bookId}.${job.chapterId}.v${after}.`;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        try {
          const review = JSON.parse(storage.getItem(key));
          if (review && review.completed === true) dismissed.add(job.jobId);
        } catch (_) { /* ignore */ }
      }
    }
    return dismissed;
  }

  async function refreshLocalJobs({
    storage = root.localStorage,
    normalizeJob = root.MaxQuillReviewApi?.normalizeJob,
    getReviewJob = root.MaxQuillReviewApi?.getReviewJob?.bind(root.MaxQuillReviewApi),
    jobStorageKey = root.MaxQuillReviewApi?.jobStorageKey
  } = {}) {
    const local = readLocalJobs(storage, normalizeJob);
    if (typeof getReviewJob !== "function" || typeof jobStorageKey !== "function") return local;
    const refreshed = [];
    for (const job of local) {
      try {
        const next = await getReviewJob(job.jobId, job);
        const merged = { ...next, submittedAt: job.submittedAt || next.submittedAt };
        storage.setItem(jobStorageKey(merged), JSON.stringify(merged));
        refreshed.push(merged);
      } catch (_) {
        refreshed.push(job);
      }
    }
    return refreshed;
  }

  async function hydrateRevisionResults({
    jobs = [],
    storage = root.localStorage,
    getReviewResult = root.MaxQuillReviewApi?.getReviewResult?.bind(root.MaxQuillReviewApi),
    resultStorageKey = root.MaxQuillReviewApi?.resultStorageKey
  } = {}) {
    const byJobId = readLocalResultPackages(storage);
    if (typeof getReviewResult !== "function" || typeof resultStorageKey !== "function") return byJobId;
    for (const job of jobs) {
      if (!job || job.status !== "REVISION_READY" || byJobId[job.jobId]) continue;
      const chapterNumber = chapterNumberFromId(job.chapterId);
      if (!chapterNumber) continue;
      try {
        const result = await getReviewResult(job.jobId, {
          bookId: job.bookId,
          chapterId: job.chapterId,
          chapterNumber,
          chapterVersion: job.chapterVersion,
          packageFingerprint: job.packageFingerprint
        });
        storage.setItem(resultStorageKey(job.jobId), JSON.stringify(result));
        byJobId[job.jobId] = result;
      } catch (_) { /* keep going; CTA can still use version+1 */ }
    }
    return byJobId;
  }

  function effectiveJobs(localJobs = [], resultPackagesByJobId = {}) {
    return localJobs.map((job) => {
      if (job.status === "FAILED" && resultPackagesByJobId[job.jobId]) {
        return { ...job, status: "REVISION_READY", _recoveredFromResult: true };
      }
      return job;
    });
  }

  function activeAttentionJobs(localJobs = [], { resultPackagesByJobId = {}, completedJobIds = new Set() } = {}) {
    const jobs = effectiveJobs(localJobs, resultPackagesByJobId);
    const byWorkflow = new Map();
    for (const job of jobs) {
      if (!job || (job.status !== "FAILED" && job.status !== "REVISION_READY")) continue;
      const key = workflowKey(job);
      const list = byWorkflow.get(key) || [];
      list.push(job);
      byWorkflow.set(key, list);
    }
    const ready = [];
    const failed = [];
    for (const list of byWorkflow.values()) {
      list.sort((left, right) => jobTime(left) - jobTime(right) || String(left.jobId).localeCompare(String(right.jobId)));
      const latest = list[list.length - 1];
      if (latest.status === "REVISION_READY") {
        if (completedJobIds.has(latest.jobId)) continue;
        ready.push(latest);
      } else failed.push(latest);
    }
    return { ready, failed };
  }

  function buildItems({ book, overviewChapters, openCommentsByKey, localJobs, resultPackagesByJobId, completedJobIds } = {}) {
    const items = [];
    const results = resultPackagesByJobId || {};
    const completed = completedJobIds || new Set();

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

    const { ready, failed } = activeAttentionJobs(jobs, { resultPackagesByJobId: results, completedJobIds: completed });
    for (const job of ready) {
      const result = results[job.jobId];
      const before = job.chapterVersion;
      const after = afterVersionFor(job, result);
      items.push({
        kind: "revision-ready",
        title: "Revision · ready for review",
        detail: `${chapterLabel(job.chapterId)} · Version ${before} → Version ${after}`,
        href: revisionChangesHref(job, result),
        action: "REVIEW CHANGES",
        badge: "OPEN",
        jobId: job.jobId
      });
    }
    for (const job of failed) {
      items.push({
        kind: "revision-failed",
        title: "Revision · failed",
        detail: chapterLabel(job.chapterId),
        href: failedHref(job),
        action: "Open",
        badge: "OPEN",
        jobId: job.jobId
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

  async function loadHomepageActivity({
    book,
    chapterOverview,
    chapterComments,
    localJobs,
    resultPackagesByJobId,
    completedJobIds,
    refreshJobs
  } = {}) {
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
    const jobs = typeof refreshJobs === "function" ? await refreshJobs() : (localJobs || []);
    const results = resultPackagesByJobId || {};
    return buildItems({
      book,
      overviewChapters: overview.chapters,
      openCommentsByKey,
      localJobs: jobs,
      resultPackagesByJobId: results,
      completedJobIds: completedJobIds || new Set()
    });
  }

  return {
    chapterLabel,
    workflowKey,
    jobTime,
    afterVersionFor,
    revisionChangesHref,
    activeAttentionJobs,
    effectiveJobs,
    buildItems,
    openCommentCount,
    render,
    readLocalJobs,
    readLocalResultPackages,
    readCompletedRevisionJobIds,
    refreshLocalJobs,
    hydrateRevisionResults,
    loadHomepageActivity
  };
});
