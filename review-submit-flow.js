(function (root, factory) {
  const flow = factory();
  if (typeof module === "object" && module.exports) module.exports = flow;
  else root.MaxQuillSubmitFlow = flow;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  async function submit(options) {
    const { api, buildPackage, sourcePackage, persistJob, refreshJobStatus, startPolling, setSubmitting, showError, showSuccess, closePanel } = options;
    try {
      setSubmitting(true); showError("");
      const job = await api.submitOwnerReview(buildPackage(), sourcePackage);
      persistJob(job);
      showSuccess("Review submitted", "Queued for revision");
      closePanel();
      await refreshJobStatus();
      startPolling();
      return job;
    } catch (error) {
      showError(options.formatError?.(error) || "Could not submit review.");
      return null;
    } finally { setSubmitting(false); }
  }
  function createSubmitHandler(options) {
    let active = false;
    return function handleSubmitClick(event) {
      event?.preventDefault?.();
      if (active) return;
      active = true;
      try { options.setSubmitting(true); }
      catch (error) {
        active = false;
        console.error("Could not start owner review submission.", error);
        options.showUnexpectedError("Could not submit review.");
        return;
      }
      Promise.resolve().then(options.submitAction).catch((error) => {
        console.error("Could not submit owner review.", error);
        options.showUnexpectedError("Could not submit review.");
      }).finally(() => {
        active = false;
        options.setSubmitting(false);
      });
    };
  }

  function changeCountLabel(count, singular = "change", plural = "changes") {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function submitDisabledReason({ reviewCompleted, submitting, job, progress, hasRevisionDecisions, packageEligible }) {
    if (job) return "A revision job already exists for this package.";
    if (submitting) return "Submitting…";
    if (packageEligible === false) return "Submit unavailable — this review no longer matches the current package.";
    if (hasRevisionDecisions && progress && progress.unresolved > 0) {
      return `Submit unavailable — ${changeCountLabel(progress.unresolved)} still need a decision.`;
    }
    if (!reviewCompleted) {
      if (hasRevisionDecisions && progress?.allDecided) return "Submit unavailable — Finish Review to lock your decisions.";
      return "Submit unavailable — finish the review first.";
    }
    if (hasRevisionDecisions && progress && !progress.allDecided) {
      return `Submit unavailable — ${changeCountLabel(progress.unresolved)} still need a decision.`;
    }
    return "";
  }

  function reviewWorkspaceMode({ review, job }) {
    if (!job) return review?.completed ? "complete_unsubmitted" : "reviewing";
    if (job.status === "REVISION_READY") return "revision_ready";
    if (job.status === "FAILED") return "revision_failed";
    if (job.status === "QUEUED" || job.status === "CLAIMED" || job.status === "PROCESSING") return "submitted_waiting";
    return "submitted_waiting";
  }

  function submittedWorkspaceCopy({ job, chapterVersion, beforeVersion, afterVersion, hasRevisionPair, errorMessage }) {
    const submittedLabel = hasRevisionPair && Number.isInteger(beforeVersion) && Number.isInteger(afterVersion)
      ? `Version ${beforeVersion} → Version ${afterVersion}`
      : (Number.isInteger(chapterVersion) ? `Version ${chapterVersion}` : "This review");
    const nextVersion = Number.isInteger(chapterVersion) ? chapterVersion + 1 : null;
    const nextLabel = nextVersion ? `Preparing Version ${nextVersion}` : "";
    const persistence = "Your review decisions have been saved. You can leave this page and return later.";
    const status = job?.status || "QUEUED";
    if (status === "REVISION_READY") {
      return {
        mode: "revision_ready",
        eyebrow: "New revision ready",
        title: nextVersion ? `Version ${nextVersion} is ready` : "New revision ready",
        summary: `${submittedLabel} review submitted.`,
        detail: nextVersion
          ? `The next revision is ready to review as Version ${nextVersion}.`
          : "The next revision is ready to review.",
        nextLabel: nextVersion ? `Version ${chapterVersion} → Version ${nextVersion}` : "",
        persistence,
        ctaLabel: nextVersion ? `Review Version ${nextVersion}` : "Review New Version",
        statusClass: "is-ready"
      };
    }
    if (status === "FAILED") {
      return {
        mode: "revision_failed",
        eyebrow: "Revision submitted",
        title: "Revision failed",
        summary: `${submittedLabel} review was submitted.`,
        detail: errorMessage || "The reviser could not complete this revision. Download the review JSON if you need to retain the handoff.",
        nextLabel: "",
        persistence,
        ctaLabel: "",
        statusClass: "is-failed"
      };
    }
    if (status === "CLAIMED" || status === "PROCESSING") {
      return {
        mode: "submitted_waiting",
        eyebrow: "Revision submitted",
        title: "Revision in progress",
        summary: `Your review for ${submittedLabel} has been submitted.`,
        detail: "The reviser is preparing the next version.",
        nextLabel,
        persistence,
        ctaLabel: "",
        statusClass: "is-processing"
      };
    }
    return {
      mode: "submitted_waiting",
      eyebrow: "Revision submitted",
      title: "Revision queued",
      summary: `Your review for ${submittedLabel} has been submitted.`,
      detail: "Your review has been submitted. The reviser is waiting to start the next revision.",
      nextLabel,
      persistence,
      ctaLabel: "",
      statusClass: "is-queued"
    };
  }

  function reviewUiState(review, job, submitting, statusLabels, options = {}) {
    const label = job ? statusLabels[job.status] : "";
    const progress = options.progress || null;
    const hasRevisionDecisions = Boolean(options.hasRevisionDecisions);
    const packageEligible = options.packageEligible !== false;
    const reviewCompleted = Boolean(review?.completed);
    const workspaceMode = options.workspaceMode || reviewWorkspaceMode({ review, job });
    const reason = submitDisabledReason({
      reviewCompleted,
      submitting,
      job,
      progress,
      hasRevisionDecisions,
      packageEligible
    });

    let completion = reviewCompleted ? "Review complete" : "Review in progress";
    let completionDetail = "";
    let progressLabel = "";
    let progressDetail = "";

    if (workspaceMode === "submitted_waiting" || workspaceMode === "revision_ready" || workspaceMode === "revision_failed") {
      completion = workspaceMode === "revision_ready" ? "New revision ready" : (workspaceMode === "revision_failed" ? "Revision failed" : "Review submitted");
      completionDetail = label ? `Revision status: ${label}.` : "Waiting for the next revision.";
    } else if (hasRevisionDecisions && progress) {
      if (progress.total > 0) {
        progressLabel = `Review progress: ${progress.resolved} / ${progress.total} decisions complete`;
      }
      if (progress.unresolved > 0) {
        completion = "Review in progress";
        progressDetail = `${changeCountLabel(progress.unresolved)} still need a decision.`;
        completionDetail = progressDetail;
      } else if (!reviewCompleted) {
        completion = "All changes reviewed";
        completionDetail = "Finish Review to lock your decisions.";
        progressDetail = completionDetail;
      } else {
        completion = "Review complete";
        completionDetail = "All changes have been reviewed.";
        progressDetail = completionDetail;
      }
    } else if (!reviewCompleted) {
      completionDetail = "Finish Review when your notes are ready.";
    } else {
      completionDetail = "Ready to submit for revision.";
    }

    const submitDisabled = Boolean(job) ? true : (!reviewCompleted || submitting || packageEligible === false || (hasRevisionDecisions && progress && !progress.allDecided));
    return {
      workspaceMode,
      completion,
      completionDetail,
      progressLabel,
      progressDetail,
      showProgress: Boolean(hasRevisionDecisions && progress && progress.total > 0 && !job),
      showJumpToOpen: Boolean(hasRevisionDecisions && progress && progress.unresolved > 0 && !job),
      jumpToOpenLabel: progress?.unresolved ? `Jump to first open change` : "",
      openSummaryLabel: progress?.unresolved ? `${progress.unresolved} OPEN` : "",
      submittedHidden: !job,
      submitted: job ? "Submitted" : "",
      queueHidden: !job,
      queue: label,
      readerStatus: job ? `Submitted · ${label}` : null,
      submitHidden: Boolean(job),
      submitDisabled: Boolean(job) ? true : submitDisabled,
      submitDisabledReason: reason,
      showSubmitReason: Boolean(!job && submitDisabled && reason),
      submitText: submitting ? "Submitting..." : "Submit for Revision",
      finishHidden: Boolean(job),
      finishDisabled: Boolean(job) || reviewCompleted,
      finishHint: !reviewCompleted && hasRevisionDecisions && progress?.allDecided
        ? "Finish Review to lock your decisions."
        : (!reviewCompleted && hasRevisionDecisions && progress?.unresolved
          ? `${changeCountLabel(progress.unresolved)} still need a decision.`
          : "")
    };
  }

  return { submit, createSubmitHandler, reviewUiState, submitDisabledReason, reviewWorkspaceMode, submittedWorkspaceCopy };
});
