(() => {
  "use strict";

  const BOOK_URL = "content/demo-book/book.json";
  const PROGRESS_KEY = "maxquill:progress:demo-book";
  const PREFS_KEY = "maxquill:reader-preferences";
  const MODE_KEY = "maxquill:reader-mode";
  const defaults = { theme: "dark", fontSize: "medium", textWidth: "normal", lineHeight: "normal" };
  let book;
  let chapter;
  let chapterData;
  let progress;
  let review;
  let pendingSelection = null;
  let editingId = null;
  let scrollTimer;

  function readStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (error) { console.warn(`Could not read ${key}.`, error); return fallback; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (error) { console.warn(`Could not save ${key}.`, error); }
  }

  function reviewKey() {
    return `maxquill:review:${book.id}:chapter-${chapter.number}:version-${chapterData.version}`;
  }

  function newReview() {
    return {
      schemaVersion: 1,
      source: "owner",
      bookId: book.id,
      chapter: chapter.number,
      chapterVersion: chapterData.version,
      chapterStatus: chapterData.status,
      ownerReviewStatus: "in_progress",
      reviewStartedAt: new Date().toISOString(),
      lastReviewedAt: null,
      annotations: []
    };
  }

  function saveReview() {
    review.lastReviewedAt = new Date().toISOString();
    writeStorage(reviewKey(), review);
    updateReviewUi();
  }

  function chapterUrl(item) {
    return `reader.html?book=${encodeURIComponent(book.id)}&chapter=${encodeURIComponent(item.slug)}`;
  }

  function applyPreferences(preferences) {
    const root = document.documentElement;
    root.dataset.readerTheme = preferences.theme;
    root.dataset.fontSize = preferences.fontSize;
    root.dataset.textWidth = preferences.textWidth;
    root.dataset.lineHeight = preferences.lineHeight;
    document.querySelector('meta[name="theme-color"]').content = preferences.theme === "dark" ? "#0c0b0a" : preferences.theme === "sepia" ? "#eee4ce" : "#f5f2eb";
    document.querySelectorAll("[data-setting]").forEach((button) => button.setAttribute("aria-pressed", String(preferences[button.dataset.setting] === button.dataset.value)));
  }

  function setupSettings() {
    let preferences = { ...defaults, ...readStorage(PREFS_KEY, {}) };
    applyPreferences(preferences);
    const toggle = document.querySelector(".settings-toggle");
    const panel = document.querySelector("#reader-settings");
    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-setting]");
      if (!button) return;
      preferences = { ...preferences, [button.dataset.setting]: button.dataset.value };
      writeStorage(PREFS_KEY, preferences);
      applyPreferences(preferences);
    });
  }

  function setMode(mode) {
    const nextMode = mode === "review" ? "review" : "read";
    document.documentElement.dataset.readerMode = nextMode;
    writeStorage(MODE_KEY, nextMode);
    document.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === nextMode)));
    document.querySelector("#review-bar").hidden = nextMode !== "review";
    document.querySelector("#selection-actions").hidden = true;
    window.getSelection()?.removeAllRanges();
    renderParagraphs();
  }

  function setupModes() {
    document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
    setMode(readStorage(MODE_KEY, "read"));
  }

  function navMarkup(position) {
    const index = book.chapters.findIndex((item) => item.slug === chapter.slug);
    const previous = book.chapters[index - 1];
    const next = book.chapters[index + 1];
    return `<nav class="reader-nav ${position}" aria-label="${position === "top" ? "Chapter navigation" : "End of chapter navigation"}">
      ${previous ? `<a class="nav-link previous" href="${chapterUrl(previous)}">&larr; Previous chapter</a>` : '<span class="nav-link previous disabled" aria-hidden="true">Previous</span>'}
      <a class="nav-link back" href="book.html?book=${encodeURIComponent(book.id)}">Back to book</a>
      ${next ? `<a class="nav-link next" data-next-chapter href="${chapterUrl(next)}">Next chapter &rarr;</a>` : '<span class="nav-link next disabled" aria-hidden="true">Next</span>'}
    </nav>`;
  }

  function renderReader() {
    document.querySelector("#reader-content").innerHTML = `${navMarkup("top")}
      <article class="chapter-article" aria-labelledby="chapter-title">
        <header class="chapter-heading">
          <p class="eyebrow">Chapter ${chapter.number}</p>
          <h1 id="chapter-title">${chapter.title}</h1>
          <p class="chapter-review-status">Review Candidate <span aria-hidden="true">&middot;</span> Version ${chapterData.version}</p>
        </header>
        <div class="chapter-body" id="chapter-body"></div>
      </article>${navMarkup("bottom")}`;
    renderParagraphs();
  }

  function appendHighlightedText(paragraph, item, annotations) {
    const usable = [...annotations].sort((a, b) => a.selectionStart - b.selectionStart).filter((note, index, all) => {
      const previous = all[index - 1];
      return !previous || note.selectionStart >= previous.selectionEnd;
    });
    let cursor = 0;
    usable.forEach((note) => {
      paragraph.append(document.createTextNode(item.text.slice(cursor, note.selectionStart)));
      const mark = document.createElement("mark");
      mark.className = "annotation-highlight";
      mark.dataset.annotationId = note.id;
      mark.tabIndex = 0;
      mark.textContent = item.text.slice(note.selectionStart, note.selectionEnd);
      mark.setAttribute("aria-label", `${note.type} annotation: ${note.comment || "No comment"}`);
      paragraph.append(mark);
      cursor = note.selectionEnd;
    });
    paragraph.append(document.createTextNode(item.text.slice(cursor)));
  }

  function renderParagraphs() {
    const body = document.querySelector("#chapter-body");
    if (!body || !chapterData) return;
    const reviewMode = document.documentElement.dataset.readerMode === "review";
    body.replaceChildren();
    chapterData.content.forEach((item) => {
      const paragraph = document.createElement("p");
      paragraph.id = `paragraph-${item.id}`;
      paragraph.dataset.paragraphId = item.id;
      const notes = reviewMode ? review.annotations.filter((note) => note.paragraphId === item.id && note.status === "open") : [];
      if (notes.length) appendHighlightedText(paragraph, item, notes);
      else paragraph.textContent = item.text;
      body.append(paragraph);
    });
  }

  function selectionDetails() {
    if (document.documentElement.dataset.readerMode !== "review") return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const endNode = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startParagraph = startNode?.closest("[data-paragraph-id]");
    const endParagraph = endNode?.closest("[data-paragraph-id]");
    if (!startParagraph || startParagraph !== endParagraph) return null;
    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(startParagraph);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(startParagraph);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const start = beforeStart.toString().length;
    const end = beforeEnd.toString().length;
    if (start === end) return null;
    const selectionStart = Math.min(start, end);
    const selectionEnd = Math.max(start, end);
    return {
      paragraphId: startParagraph.dataset.paragraphId,
      selectedText: startParagraph.textContent.slice(selectionStart, selectionEnd),
      selectionStart,
      selectionEnd,
      rect: range.getBoundingClientRect()
    };
  }

  function captureSelection() {
    window.setTimeout(() => {
      const details = selectionDetails();
      const actions = document.querySelector("#selection-actions");
      if (!details) { actions.hidden = true; return; }
      pendingSelection = details;
      actions.hidden = false;
      actions.style.left = `${Math.max(8, Math.min(innerWidth - actions.offsetWidth - 8, details.rect.left + details.rect.width / 2 - actions.offsetWidth / 2))}px`;
      actions.style.top = `${Math.max(8, details.rect.top - actions.offsetHeight - 10)}px`;
    }, 20);
  }

  function annotationId() {
    return crypto.randomUUID ? `annotation-${crypto.randomUUID()}` : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openEditor(note = null, defaultType = "wording") {
    editingId = note?.id || null;
    const source = note || pendingSelection;
    if (!source) return;
    document.querySelector("#annotation-title").textContent = note ? "Edit annotation" : "Add annotation";
    document.querySelector("#annotation-quote").textContent = `“${source.selectedText}”`;
    document.querySelector("#annotation-type").value = note?.type || defaultType;
    document.querySelector("#annotation-comment").value = note?.comment || "";
    document.querySelector("#delete-annotation").hidden = !note;
    document.querySelector("#annotation-dialog").showModal();
    document.querySelector("#annotation-comment").focus();
  }

  function saveAnnotation(event) {
    event.preventDefault();
    const type = document.querySelector("#annotation-type").value;
    const comment = document.querySelector("#annotation-comment").value.trim();
    if (editingId) {
      const note = review.annotations.find((item) => item.id === editingId);
      if (note) { note.type = type; note.comment = comment; note.updatedAt = new Date().toISOString(); }
    } else if (pendingSelection) {
      review.annotations.push({
        id: annotationId(), source: "owner", bookId: book.id, chapter: chapter.number,
        chapterVersion: chapterData.version, paragraphId: pendingSelection.paragraphId,
        selectedText: pendingSelection.selectedText, selectionStart: pendingSelection.selectionStart,
        selectionEnd: pendingSelection.selectionEnd, type, comment, status: "open",
        createdAt: new Date().toISOString()
      });
    }
    saveReview();
    closeEditor();
    renderParagraphs();
  }

  function quickFlag() {
    if (!pendingSelection) return;
    document.querySelector("#annotation-type").value = "flag";
    document.querySelector("#annotation-comment").value = "";
    saveAnnotation(new Event("submit", { cancelable: true }));
  }

  function closeEditor() {
    document.querySelector("#annotation-dialog").close();
    document.querySelector("#selection-actions").hidden = true;
    window.getSelection()?.removeAllRanges();
    pendingSelection = null;
    editingId = null;
  }

  function deleteAnnotation() {
    if (!editingId) return;
    review.annotations = review.annotations.filter((note) => note.id !== editingId);
    saveReview();
    closeEditor();
    renderParagraphs();
  }

  function updateReviewUi() {
    if (!review || !chapterData) return;
    const open = review.annotations.filter((note) => note.status === "open");
    document.querySelector("#review-chapter-status").textContent = `Review Candidate · Version ${chapterData.version}`;
    document.querySelector("#open-note-count").textContent = `Open notes: ${open.length}`;
    document.querySelector('[data-mode="review"]').textContent = open.length ? `Review (${open.length})` : "Review";
    const completed = review.ownerReviewStatus === "completed";
    let historicalCount = 0;
    try {
      const prefix = `maxquill:review:${book.id}:chapter-${chapter.number}:version-`;
      historicalCount = Object.keys(localStorage).filter((key) => key.startsWith(prefix) && key !== reviewKey()).length;
    } catch (error) { console.warn("Could not inspect historical reviews.", error); }
    document.querySelector("#review-summary").innerHTML = `<p><strong>${open.length} open ${open.length === 1 ? "note" : "notes"}</strong><br>Review for Version ${chapterData.version} · ${completed ? "Owner Review Complete" : "Review in progress"}${historicalCount ? `<br>${historicalCount} historical version ${historicalCount === 1 ? "review" : "reviews"} kept separately` : ""}</p>`;
    const list = document.querySelector("#review-note-list");
    list.replaceChildren();
    if (!open.length) {
      const empty = document.createElement("li");
      empty.className = "empty-notes";
      empty.textContent = "No notes yet. Select text in Review Mode to begin.";
      list.append(empty);
    }
    open.forEach((note, index) => {
      const item = document.createElement("li");
      item.className = "review-note";
      item.innerHTML = `<button type="button" class="note-jump"><span>${index + 1}. ${note.type}</span><q></q><small></small></button><button type="button" class="note-edit">Edit</button>`;
      item.querySelector("q").textContent = note.selectedText;
      item.querySelector("small").textContent = note.comment || "No comment";
      item.querySelector(".note-jump").addEventListener("click", () => {
        document.querySelector("#review-panel").close();
        document.querySelector(`#paragraph-${note.paragraphId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      item.querySelector(".note-edit").addEventListener("click", () => { document.querySelector("#review-panel").close(); openEditor(note); });
      list.append(item);
    });
    const finish = document.querySelector("#finish-review");
    finish.textContent = completed ? "Owner Review Complete" : "Finish Review";
    finish.setAttribute("aria-pressed", String(completed));
  }

  function exportReview() {
    const reviewPackage = { ...review, reviewedAt: new Date().toISOString(), annotations: review.annotations.map(({ ...note }) => note) };
    const blob = new Blob([JSON.stringify(reviewPackage, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${book.id}-chapter-${chapter.number}-v${chapterData.version}-owner-review.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setupReview() {
    document.querySelector("#chapter-body").addEventListener("pointerup", captureSelection);
    document.querySelector("#chapter-body").addEventListener("keyup", captureSelection);
    document.querySelector("#chapter-body").addEventListener("click", (event) => {
      const mark = event.target.closest("[data-annotation-id]");
      if (mark) openEditor(review.annotations.find((note) => note.id === mark.dataset.annotationId));
    });
    document.querySelector("#selection-actions").addEventListener("click", (event) => {
      const action = event.target.dataset.selectionAction;
      if (action === "comment") openEditor(null, "wording");
      if (action === "flag") quickFlag();
    });
    document.querySelector("#annotation-form").addEventListener("submit", saveAnnotation);
    document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeEditor));
    document.querySelector("#delete-annotation").addEventListener("click", deleteAnnotation);
    document.querySelector("#open-review-panel").addEventListener("click", () => document.querySelector("#review-panel").showModal());
    document.querySelector("[data-close-panel]").addEventListener("click", () => document.querySelector("#review-panel").close());
    document.querySelectorAll("#export-review, #panel-export").forEach((button) => button.addEventListener("click", exportReview));
    document.querySelector("#finish-review").addEventListener("click", () => {
      review.ownerReviewStatus = "completed";
      review.completedAt = new Date().toISOString();
      saveReview();
    });
    updateReviewUi();
  }

  function saveProgress(markRead = false) {
    const read = new Set(progress.readChapters || []);
    if (markRead) read.add(chapter.slug);
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    progress = { bookId: book.id, currentChapter: chapter.slug, readingProgress: Math.min(1, scrollY / maxScroll), lastOpened: new Date().toISOString(), readChapters: [...read], scrollPositions: { ...(progress.scrollPositions || {}), [chapter.slug]: Math.round(scrollY) } };
    writeStorage(PROGRESS_KEY, progress);
  }

  function setupProgress() {
    const savedPosition = Number(progress.scrollPositions?.[chapter.slug] || 0);
    requestAnimationFrame(() => scrollTo({ top: savedPosition, behavior: "instant" }));
    addEventListener("scroll", () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => { const max = Math.max(1, document.documentElement.scrollHeight - innerHeight); saveProgress(scrollY / max >= .88); }, 400);
    }, { passive: true });
    addEventListener("pagehide", () => saveProgress());
    document.querySelectorAll("[data-next-chapter]").forEach((link) => link.addEventListener("click", () => saveProgress(true)));
  }

  async function init() {
    setupSettings();
    try {
      const bookResponse = await fetch(BOOK_URL);
      if (!bookResponse.ok) throw new Error(`Book data returned ${bookResponse.status}`);
      book = await bookResponse.json();
      const requested = new URLSearchParams(location.search).get("chapter") || book.chapters[0].slug;
      chapter = book.chapters.find((item) => item.slug === requested) || book.chapters[0];
      const chapterResponse = await fetch(`content/${book.id}/chapters/${chapter.slug}.json`);
      if (!chapterResponse.ok) throw new Error(`Chapter data returned ${chapterResponse.status}`);
      chapterData = await chapterResponse.json();
      progress = readStorage(PROGRESS_KEY, { bookId: book.id, readChapters: [], scrollPositions: {} });
      review = readStorage(reviewKey(), newReview());
      document.title = `Chapter ${chapter.number}: ${chapter.title} | MaxQuill`;
      renderReader();
      setupModes();
      setupReview();
      saveProgress();
      setupProgress();
    } catch (error) {
      console.error("Could not open chapter.", error);
      document.querySelector("#reader-content").innerHTML = '<p class="error-message reader-loading">This chapter could not be opened. <a href="book.html">Return to the book</a>.</p>';
    }
  }

  init();
})();
