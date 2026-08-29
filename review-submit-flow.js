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
  function reviewUiState(review, job, submitting, statusLabels) {
    const label = job ? statusLabels[job.status] : "";
    return {
      completion: review.completed ? "Review complete" : "Review in progress",
      submittedHidden: !job,
      submitted: job ? "Submitted" : "",
      queueHidden: !job,
      queue: label,
      readerStatus: job ? `Submitted · ${label}` : null,
      submitHidden: Boolean(job),
      submitDisabled: !review.completed || submitting,
      submitText: submitting ? "Submitting..." : "Submit for Revision"
    };
  }
  return { submit, createSubmitHandler, reviewUiState };
});
