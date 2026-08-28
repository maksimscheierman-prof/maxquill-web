(function (root, factory) {
  const flow = factory();
  if (typeof module === "object" && module.exports) module.exports = flow;
  else root.MaxQuillSubmitFlow = flow;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  async function submit(options) {
    const { api, buildPackage, sourcePackage, persistJob, refreshJobStatus, startPolling, setSubmitting, showError, showSuccess, closePanel } = options;
    setSubmitting(true); showError("");
    try {
      const job = await api.submitOwnerReview(buildPackage(), sourcePackage);
      persistJob(job);
      showSuccess("Review submitted", "Queued for revision");
      closePanel();
      await refreshJobStatus();
      startPolling();
      return job;
    } catch (error) {
      showError(options.formatError(error));
      return null;
    } finally { setSubmitting(false); }
  }
  return { submit };
});
