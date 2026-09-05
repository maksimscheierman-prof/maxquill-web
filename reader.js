(() => {
  "use strict";
  const BOOK_URL = "content/book-001/book.json";
  const PROGRESS_KEY = "maxquill:progress:book-001";
  const PREFS_KEY = "maxquill:reader-preferences";
  const MODE_KEY = "maxquill:reader-mode";
  const defaults = { theme: "dark", fontSize: "medium", textWidth: "normal", lineHeight: "normal" };
  let book, chapter, sourcePackage, reviewIdentity, progress, review, reviewJob = null, pendingSelection = null, editingId = null, scrollTimer, selectionTimer, pollTimer, actionEngaged = false, submitting = false, companionManifest = null, companionState = null;

  function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (error) { console.warn(`Could not read ${key}.`, error); return fallback; } }
  function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { console.warn(`Could not save ${key}.`, error); } }
  function reviewKey() { return MaxQuillReviewApi.reviewStorageKey(reviewIdentity); }
  function newReview() { return { packageFingerprint: reviewIdentity.packageFingerprint, completed: false, reviewedAt: null, annotations: [] }; }
  function saveReview() { writeStorage(reviewKey(), review); updateReviewUi(); }
  function chapterUrl(item) { return `reader.html?book=${encodeURIComponent(book.id)}&chapter=${item.number}&version=${item.version}`; }
  function packageUrl(bookId, number, version) { return `content/books/${encodeURIComponent(bookId)}/review/chapter_${String(number).padStart(4, "0")}_v${version}.json`; }
  function showMessage(selector, message) { const node = document.querySelector(selector); node.textContent = message; node.hidden = !message; }
  function hideSelectionActions(clearSelection = false) { document.querySelector("#selection-actions").hidden = true; if (clearSelection) pendingSelection = null; }

  function applyPreferences(preferences) {
    const root = document.documentElement;
    for (const key of ["theme", "fontSize", "textWidth", "lineHeight"]) root.dataset[key === "theme" ? "readerTheme" : key] = preferences[key];
    document.querySelector('meta[name="theme-color"]').content = preferences.theme === "dark" ? "#0c0b0a" : preferences.theme === "sepia" ? "#eee4ce" : "#f5f2eb";
    document.querySelectorAll("[data-setting]").forEach((button) => button.setAttribute("aria-pressed", String(preferences[button.dataset.setting] === button.dataset.value)));
  }
  function setupSettings() {
    let preferences = { ...defaults, ...readStorage(PREFS_KEY, {}) };
    applyPreferences(preferences);
    const toggle = document.querySelector(".settings-toggle"), panel = document.querySelector("#reader-settings");
    toggle.addEventListener("click", () => { panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); });
    panel.addEventListener("click", (event) => { const button = event.target.closest("[data-setting]"); if (!button) return; preferences = { ...preferences, [button.dataset.setting]: button.dataset.value }; writeStorage(PREFS_KEY, preferences); applyPreferences(preferences); });
  }
  function setMode(mode) {
    const next = mode === "review" ? "review" : "read";
    document.documentElement.dataset.readerMode = next; writeStorage(MODE_KEY, next);
    document.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === next)));
    document.querySelector("#review-bar").hidden = next !== "review"; hideSelectionActions(true); showMessage("#selection-message", "");
    window.getSelection()?.removeAllRanges(); renderParagraphs();
  }
  function setupModes() { document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode))); setMode(readStorage(MODE_KEY, "read")); }
  function navMarkup(position) {
    const index = book.chapters.findIndex((item) => item.number === sourcePackage.chapterNumber), previous = book.chapters[index - 1], next = book.chapters[index + 1];
    return `<nav class="reader-nav ${position}" aria-label="${position === "top" ? "Chapter navigation" : "End of chapter navigation"}">${previous ? `<a class="nav-link previous" href="${chapterUrl(previous)}">&larr; Previous chapter</a>` : '<span class="nav-link previous disabled" aria-hidden="true">Previous</span>'}<a class="nav-link back" href="book.html?book=${encodeURIComponent(book.id)}">Back to book</a>${next ? `<a class="nav-link next" data-next-chapter href="${chapterUrl(next)}">Next chapter &rarr;</a>` : '<span class="nav-link next disabled" aria-hidden="true">Next</span>'}</nav>`;
  }
  function renderReader() {
    document.querySelector("#reader-content").innerHTML = `${navMarkup("top")}<article class="chapter-article" aria-labelledby="chapter-title"><header class="chapter-heading"><p class="eyebrow">Chapter ${sourcePackage.chapterNumber}</p><h1 id="chapter-title"></h1><p class="chapter-review-status">Review Candidate &middot; Version ${sourcePackage.chapterVersion} &middot; REVIEW_READY</p></header><div class="chapter-body" id="chapter-body"></div></article>${navMarkup("bottom")}`;
    document.querySelector("#chapter-title").textContent = sourcePackage.title; renderParagraphs();
  }
  function appendHighlightedText(paragraph, item, annotations) {
    const usable = [...annotations].sort((a, b) => a.selectionStart - b.selectionStart).filter((note, index, all) => !all[index - 1] || note.selectionStart >= all[index - 1].selectionEnd); let cursor = 0;
    for (const note of usable) { paragraph.append(document.createTextNode(item.text.slice(cursor, note.selectionStart))); const mark = document.createElement("mark"); mark.className = "annotation-highlight"; mark.dataset.annotationId = note.id; mark.tabIndex = 0; mark.textContent = item.text.slice(note.selectionStart, note.selectionEnd); mark.setAttribute("aria-label", `${note.category} annotation: ${note.comment}`); paragraph.append(mark); cursor = note.selectionEnd; }
    paragraph.append(document.createTextNode(item.text.slice(cursor)));
  }
  function renderParagraphs() {
    const body = document.querySelector("#chapter-body"); if (!body || !sourcePackage) return; body.replaceChildren(); const reviewMode = document.documentElement.dataset.readerMode === "review";
    for (const item of sourcePackage.content) { const paragraph = document.createElement("p"); paragraph.id = `paragraph-${item.id}`; paragraph.dataset.paragraphId = item.id; const notes = reviewMode ? review.annotations.filter((note) => note.paragraphId === item.id && note.status === "open") : []; if (notes.length) appendHighlightedText(paragraph, item, notes); else paragraph.textContent = item.text; body.append(paragraph); }
  }
  function selectionDetails() {
    if (document.documentElement.dataset.readerMode !== "review") return null; const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return null; const range = selection.getRangeAt(0);
    const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement, endNode = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startParagraph = startNode?.closest("[data-paragraph-id]"), endParagraph = endNode?.closest("[data-paragraph-id]"); if (!startParagraph || startParagraph !== endParagraph) return null;
    const beforeStart = range.cloneRange(), beforeEnd = range.cloneRange(); beforeStart.selectNodeContents(startParagraph); beforeStart.setEnd(range.startContainer, range.startOffset); beforeEnd.selectNodeContents(startParagraph); beforeEnd.setEnd(range.endContainer, range.endOffset);
    const selectionStart = Math.min(beforeStart.toString().length, beforeEnd.toString().length), selectionEnd = Math.max(beforeStart.toString().length, beforeEnd.toString().length); if (selectionStart === selectionEnd) return null;
    const paragraph = sourcePackage.content.find((item) => item.id === startParagraph.dataset.paragraphId); if (!paragraph) return null;
    const candidate = { paragraphId: paragraph.id, startParagraphId: startParagraph.dataset.paragraphId, endParagraphId: endParagraph.dataset.paragraphId, selectedText: paragraph.text.substring(selectionStart, selectionEnd), selectionStart, selectionEnd, rect: range.getBoundingClientRect() };
    return MaxQuillSelectionLogic.validateSelectionCandidate(sourcePackage, candidate).valid ? candidate : null;
  }
  function readSelectionState() {
    if (document.querySelector("#annotation-dialog").open || document.querySelector("#review-panel").open) return;
    if (document.documentElement.dataset.readerMode !== "review") { hideSelectionActions(true); showMessage("#selection-message", ""); return; }
    const selection = window.getSelection(), actions = document.querySelector("#selection-actions"), details = selectionDetails();
    if (!selection || selection.isCollapsed) { if (!actionEngaged) hideSelectionActions(true); showMessage("#selection-message", ""); return; }
    if (!details) { hideSelectionActions(true); showMessage("#selection-message", "Select text within one paragraph to add a review note."); return; }
    showMessage("#selection-message", ""); pendingSelection = details; document.querySelector("#selection-preview").textContent = details.selectedText; actions.hidden = false;
    if (!matchMedia("(hover: none), (pointer: coarse)").matches) { const width = actions.offsetWidth, height = actions.offsetHeight; actions.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, details.rect.left + details.rect.width / 2 - width / 2))}px`; actions.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, details.rect.top - height - 10))}px`; }
  }
  function handleTextSelection(delay = 320) { clearTimeout(selectionTimer); selectionTimer = setTimeout(readSelectionState, delay); }
  function annotationId() { return crypto.randomUUID ? `annotation-${crypto.randomUUID()}` : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function openEditor(note = null, defaultCategory = "wording") {
    editingId = note?.id || null; const source = note || pendingSelection; if (!source) return; showMessage("#annotation-message", "");
    document.querySelector("#annotation-title").textContent = note ? "Edit annotation" : "Add annotation"; document.querySelector("#annotation-quote").textContent = `“${source.selectedText}”`; document.querySelector("#annotation-type").value = note?.category || defaultCategory; document.querySelector("#annotation-comment").value = note?.comment || ""; document.querySelector("#annotation-status").value = note?.status || "open"; document.querySelector("#requires-canon-change").checked = note?.requiresCanonChange || false; document.querySelector("#delete-annotation").hidden = !note; document.querySelector("#annotation-dialog").showModal(); document.querySelector("#annotation-comment").focus();
  }
  function buildOwnerReviewPackage(annotations = review.annotations) { return { schemaVersion: 1, type: "owner_review", source: "owner", bookId: sourcePackage.bookId, chapterId: sourcePackage.chapterId, chapterNumber: sourcePackage.chapterNumber, chapterVersion: sourcePackage.chapterVersion, reviewedAt: review.reviewedAt || new Date().toISOString(), reviewStatus: "completed", annotations: annotations.map((note) => ({ ...note })) }; }
  function saveAnnotation(event) {
    event.preventDefault(); const existing = editingId ? review.annotations.find((item) => item.id === editingId) : null, selection = existing || pendingSelection; if (!selection) return;
    const annotation = { id: existing?.id || annotationId(), paragraphId: selection.paragraphId, selectedText: selection.selectedText, selectionStart: selection.selectionStart, selectionEnd: selection.selectionEnd, category: document.querySelector("#annotation-type").value, comment: document.querySelector("#annotation-comment").value.trim(), status: document.querySelector("#annotation-status").value, requiresCanonChange: document.querySelector("#requires-canon-change").checked };
    if (!annotation.comment) { showMessage("#annotation-message", "Add a comment before saving this note."); return; }
    const paragraph = sourcePackage.content.find((item) => item.id === annotation.paragraphId); if (!paragraph || paragraph.text.substring(annotation.selectionStart, annotation.selectionEnd) !== annotation.selectedText) { showMessage("#annotation-message", "This selection no longer matches the original paragraph. Select the text again."); return; }
    const validation = MaxQuillReviewContract.validateOwnerReviewPackage(buildOwnerReviewPackage([annotation]), sourcePackage); if (!validation.valid) { showMessage("#annotation-message", validation.errors.join(" ")); return; }
    if (existing) Object.assign(existing, annotation); else review.annotations.push(annotation); review.completed = false; review.reviewedAt = null; saveReview(); closeEditor(); renderParagraphs();
  }
  function quickFlag() { if (!pendingSelection) return; openEditor(null, "other"); document.querySelector("#annotation-comment").value = "Flagged for revision."; }
  function closeEditor() { document.querySelector("#annotation-dialog").close(); hideSelectionActions(true); window.getSelection()?.removeAllRanges(); pendingSelection = null; editingId = null; actionEngaged = false; }
  function deleteAnnotation() { if (!editingId) return; review.annotations = review.annotations.filter((note) => note.id !== editingId); review.completed = false; review.reviewedAt = null; saveReview(); closeEditor(); renderParagraphs(); }
  function updateReviewUi() {
    if (!review || !sourcePackage) return; document.querySelector("#review-chapter-status").textContent = `Review Candidate · Version ${sourcePackage.chapterVersion}`; document.querySelector("#open-note-count").textContent = `Review Notes · ${review.annotations.length}`; document.querySelector('[data-mode="review"]').textContent = review.annotations.length ? `Review (${review.annotations.length})` : "Review";
    document.querySelector("#review-summary").innerHTML = `<p><strong>${review.annotations.length} ${review.annotations.length === 1 ? "note" : "notes"}</strong><br>Review for Version ${sourcePackage.chapterVersion} · ${review.completed ? "Owner Review Complete" : "Review in progress"}</p>`;
    const list = document.querySelector("#review-note-list"); list.replaceChildren(); if (!review.annotations.length) { const empty = document.createElement("li"); empty.className = "empty-notes"; empty.textContent = "No notes yet. Select text in Review Mode to begin."; list.append(empty); }
    review.annotations.forEach((note, index) => { const item = document.createElement("li"); item.className = "review-note"; item.innerHTML = '<button type="button" class="note-jump"><span></span><q></q><small></small></button><button type="button" class="note-edit">Edit</button>'; item.querySelector("span").textContent = `${index + 1}. ${note.category} · ${note.status}${note.requiresCanonChange ? " · Canon change" : ""}`; item.querySelector("q").textContent = note.selectedText; item.querySelector("small").textContent = note.comment; item.querySelector(".note-jump").addEventListener("click", () => { document.querySelector("#review-panel").close(); document.querySelector(`#paragraph-${note.paragraphId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }); item.querySelector(".note-edit").addEventListener("click", () => { document.querySelector("#review-panel").close(); openEditor(note); }); list.append(item); });
    const finish = document.querySelector("#finish-review"); finish.textContent = review.completed ? "Owner Review Complete" : "Finish Review"; finish.setAttribute("aria-pressed", String(review.completed)); finish.disabled = review.completed; updateJobUi();
  }
  function finishReview() { const previousReviewedAt = review.reviewedAt; review.reviewedAt = new Date().toISOString(); const validation = MaxQuillReviewContract.validateOwnerReviewPackage(buildOwnerReviewPackage(), sourcePackage); if (!validation.valid) { review.reviewedAt = previousReviewedAt; showMessage("#review-message", `Review cannot be completed: ${validation.errors.join(" ")}`); return; } review.completed = true; showMessage("#review-message", "Review complete."); saveReview(); }
  function exportReview() {
    showMessage("#review-message", ""); if (!review.completed) { showMessage("#review-message", "Finish the review before exporting."); return; } const reviewPackage = buildOwnerReviewPackage(), validation = MaxQuillReviewContract.validateOwnerReviewPackage(reviewPackage, sourcePackage); if (!validation.valid) { showMessage("#review-message", `Export blocked: ${validation.errors.join(" ")}`); return; }
    const blob = new Blob([JSON.stringify(reviewPackage, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `${sourcePackage.bookId}-${sourcePackage.chapterId}-v${sourcePackage.chapterVersion}-owner-review.json`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function persistJob(job) { reviewJob = job; writeStorage(MaxQuillReviewApi.jobStorageKey(reviewIdentity), job); updateJobUi(); }
  function updateJobUi() {
    if (!review || !sourcePackage) return; const submit = document.querySelector("#submit-review"), openRevision = document.querySelector("#open-revised-version"), completion = document.querySelector("#review-job-status strong"), submitted = document.querySelector("#submission-state"), queue = document.querySelector("#queue-status");
    const state = MaxQuillSubmitFlow.reviewUiState(review, reviewJob, submitting, MaxQuillReviewApi.STATUS_LABELS);
    completion.textContent = state.completion; submitted.hidden = state.submittedHidden; submitted.textContent = state.submitted; queue.hidden = state.queueHidden; queue.textContent = state.queue; queue.className = "";
    if (state.readerStatus) document.querySelector("#review-chapter-status").textContent = state.readerStatus;
    if (reviewJob?.status === "REVISION_READY") queue.className = "is-ready"; if (reviewJob?.status === "FAILED") queue.className = "is-failed";
    submit.hidden = state.submitHidden; submit.disabled = state.submitDisabled; submit.textContent = state.submitText;
    openRevision.hidden = reviewJob?.status !== "REVISION_READY";
  }
  function submissionError(error) {
    if (error.kind === "conflict" || error.kind === "auth" || error.kind === "validation" || error.kind === "submit-network") return error.message;
    return `Backend rejected review. ${error.message || "The request could not be completed."}`;
  }
  function showSubmitToast(title, detail) {
    const toast = document.querySelector("#submit-toast"); document.querySelector("#submit-toast-title").textContent = title; document.querySelector("#submit-toast-detail").textContent = detail; toast.hidden = false; clearTimeout(showSubmitToast.timer); showSubmitToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
  }
  async function submitReview() {
    showMessage("#review-message", ""); if (!review.completed) { showMessage("#review-message", "Finish the review before submitting."); return; }
    await MaxQuillSubmitFlow.submit({ api: MaxQuillReviewApi, buildPackage: buildOwnerReviewPackage, sourcePackage: reviewIdentity, persistJob, refreshJobStatus, startPolling, setSubmitting() {}, showError(message) { showMessage("#review-message", message); }, showSuccess: showSubmitToast, closePanel() { document.querySelector("#review-panel").close(); }, formatError: submissionError });
  }
  async function refreshJobStatus() {
    if (!reviewJob || ["REVISION_READY", "FAILED"].includes(reviewJob.status)) { stopPolling(); return; }
    try { const job = await MaxQuillReviewApi.getReviewJob(reviewJob.jobId, reviewIdentity); job.submittedAt = reviewJob.submittedAt; persistJob(job); if (job.status === "REVISION_READY") { showMessage("#review-message", "Revision ready. Open the revised version when you are ready."); stopPolling(); } else if (job.status === "FAILED") { showMessage("#review-message", `Revision failed. ${job.error?.message || "Download the review JSON to retain the handoff."}`); stopPolling(); } }
    catch (error) { showMessage("#review-message", error.message || "Status check failed."); }
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  function startPolling() { stopPolling(); if (reviewJob && !["REVISION_READY", "FAILED"].includes(reviewJob.status)) pollTimer = setInterval(refreshJobStatus, 12000); }
  async function openRevisedVersion() {
    if (reviewJob?.status !== "REVISION_READY") return;
    const button = document.querySelector("#open-revised-version"); button.disabled = true; showMessage("#review-message", "Loading revised version...");
    try {
      const result = await MaxQuillReviewApi.getReviewResult(reviewJob.jobId, reviewIdentity);
      writeStorage(MaxQuillReviewApi.resultStorageKey(reviewJob.jobId), result);
      location.assign(`reader.html?book=${encodeURIComponent(result.bookId)}&chapter=${result.chapterNumber}&version=${result.chapterVersion}&resultJob=${encodeURIComponent(reviewJob.jobId)}`);
    } catch (error) { button.disabled = false; showMessage("#review-message", error.message || "Revised version could not be loaded."); }
  }
  function setupReview() {
    const body = document.querySelector("#chapter-body"), actions = document.querySelector("#selection-actions");
    body.addEventListener("pointerup", () => handleTextSelection(40)); body.addEventListener("keyup", () => handleTextSelection(40)); document.addEventListener("selectionchange", () => handleTextSelection(320));
    body.addEventListener("click", (event) => { const mark = event.target.closest("[data-annotation-id]"); if (mark) openEditor(review.annotations.find((note) => note.id === mark.dataset.annotationId)); });
    actions.addEventListener("pointerdown", () => { actionEngaged = true; }); actions.addEventListener("click", (event) => { if (event.target.dataset.selectionAction === "comment") openEditor(); if (event.target.dataset.selectionAction === "flag") quickFlag(); actionEngaged = false; });
    addEventListener("scroll", () => { hideSelectionActions(false); showMessage("#selection-message", ""); }, { passive: true }); addEventListener("resize", () => { hideSelectionActions(false); handleTextSelection(180); }); addEventListener("orientationchange", () => { hideSelectionActions(false); handleTextSelection(250); });
    const submitHandler = MaxQuillSubmitFlow.createSubmitHandler({ submitAction: submitReview, setSubmitting(value) { submitting = value; updateJobUi(); }, showUnexpectedError(message) { showMessage("#review-message", message); } });
    document.querySelector("#annotation-form").addEventListener("submit", saveAnnotation); document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeEditor)); document.querySelector("#delete-annotation").addEventListener("click", deleteAnnotation); document.querySelector("#open-review-panel").addEventListener("click", () => document.querySelector("#review-panel").showModal()); document.querySelector("[data-close-panel]").addEventListener("click", () => document.querySelector("#review-panel").close()); document.querySelector("#finish-review").addEventListener("click", finishReview); document.querySelector("#submit-review").addEventListener("click", submitHandler); document.querySelector("#open-revised-version").addEventListener("click", openRevisedVersion); addEventListener("pagehide", stopPolling); updateReviewUi();
  }
  function saveProgress(markRead = false) { const read = new Set(progress.readChapters || []); if (markRead) read.add(String(sourcePackage.chapterNumber)); const furthest = window.MaxQuillCompanion ? MaxQuillCompanion.advanceFurthestChapter(progress, sourcePackage.chapterNumber, markRead) : Math.max(Number(progress.furthestChapter || 0), ...[...read].map(Number)); progress = { bookId: book.id, currentChapter: String(sourcePackage.chapterNumber), furthestChapter: furthest, readingProgress: Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)), lastOpened: new Date().toISOString(), readChapters: [...read], scrollPositions: { ...(progress.scrollPositions || {}), [sourcePackage.chapterId]: Math.round(scrollY) } }; writeStorage(PROGRESS_KEY, progress); if (window.MaxQuillCompanion) companionState = MaxQuillCompanion.getCompanionState(companionManifest, { progress, viewedChapterId: sourcePackage.chapterId }); }
  function setupProgress() { const saved = Number(progress.scrollPositions?.[sourcePackage.chapterId] || 0); requestAnimationFrame(() => scrollTo({ top: saved, behavior: "instant" })); addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { const max = Math.max(1, document.documentElement.scrollHeight - innerHeight); saveProgress(scrollY / max >= .88); }, 400); }, { passive: true }); addEventListener("pagehide", () => saveProgress()); document.querySelectorAll("[data-next-chapter]").forEach((link) => link.addEventListener("click", () => saveProgress(true))); }
  async function init() {
    setupSettings(); try {
      if (!window.MaxQuillReviewContract || !window.MaxQuillSelectionLogic || !window.MaxQuillReviewApi || !window.MaxQuillSubmitFlow) throw new Error("Review validation support is unavailable."); const bookResponse = await fetch(BOOK_URL); if (!bookResponse.ok) throw new Error(`Book data returned ${bookResponse.status}`); book = await bookResponse.json();
      const params = new URLSearchParams(location.search), requestedBook = params.get("book") || book.id, requestedNumber = Number.parseInt(params.get("chapter") || String(book.chapters[0].number), 10); chapter = book.chapters.find((item) => item.number === requestedNumber); if (requestedBook !== book.id || !chapter) throw new Error("The requested review candidate is not available."); const version = Number.parseInt(params.get("version") || String(chapter.version), 10), resultJob = params.get("resultJob"); if (!Number.isInteger(version) || version < 1) throw new Error("The requested chapter version is invalid.");
      if (resultJob) { const original = { bookId: requestedBook, chapterId: chapter.chapterId, chapterNumber: requestedNumber, chapterVersion: version - 1 }; try { sourcePackage = await MaxQuillReviewApi.getReviewResult(resultJob, original); writeStorage(MaxQuillReviewApi.resultStorageKey(resultJob), sourcePackage); } catch (error) { const cached = readStorage(MaxQuillReviewApi.resultStorageKey(resultJob), null), cachedValidation = MaxQuillReviewContract.validateReviewReadyPackage(cached); if (!cachedValidation.valid || cached?.bookId !== requestedBook || cached?.chapterId !== chapter.chapterId || cached?.chapterNumber !== requestedNumber || cached?.chapterVersion !== version) throw error; sourcePackage = cached; } } else { const response = await fetch(packageUrl(requestedBook, requestedNumber, version)); if (!response.ok) throw new Error(`Review candidate returned ${response.status}`); sourcePackage = await response.json(); }
      const validation = MaxQuillReviewContract.validateReviewReadyPackage(sourcePackage); if (!validation.valid) throw new Error(`Contract validation failed: ${validation.errors.join(" ")}`); if (sourcePackage.bookId !== requestedBook || sourcePackage.chapterNumber !== requestedNumber || sourcePackage.chapterVersion !== version || sourcePackage.chapterId !== chapter.chapterId) throw new Error("Contract validation failed: package identity does not match the requested review candidate.");
      reviewIdentity = await MaxQuillReviewApi.packageIdentity(sourcePackage); progress = readStorage(PROGRESS_KEY, { bookId: book.id, readChapters: [], scrollPositions: {} }); review = readStorage(reviewKey(), newReview()); if (!review || typeof review !== "object" || review.packageFingerprint !== reviewIdentity.packageFingerprint || !Array.isArray(review.annotations) || typeof review.completed !== "boolean") review = newReview(); if (review.completed && !review.reviewedAt) { review.reviewedAt = new Date().toISOString(); writeStorage(reviewKey(), review); } reviewJob = MaxQuillReviewApi.normalizeJob(readStorage(MaxQuillReviewApi.jobStorageKey(reviewIdentity), null), reviewIdentity); if (window.MaxQuillCompanion) { const loaded = await MaxQuillCompanion.loadCompanionManifest(MaxQuillCompanion.companionUrl(book.id)); companionManifest = loaded.manifest; companionState = MaxQuillCompanion.getCompanionState(companionManifest, { progress, viewedChapterId: sourcePackage.chapterId }); } document.title = `Chapter ${sourcePackage.chapterNumber}: ${sourcePackage.title} | MaxQuill`; renderReader(); setupModes(); setupReview(); saveProgress(); setupProgress(); if (reviewJob) { await refreshJobStatus(); startPolling(); }
    } catch (error) { console.error("Could not open chapter.", error); document.querySelector("#reader-content").innerHTML = `<p class="error-message reader-loading">This review candidate could not be opened. ${String(error.message || error)} <a href="book.html">Return to the book</a>.</p>`; }
  }
  init();
})();
