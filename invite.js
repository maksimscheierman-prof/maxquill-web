(() => {
  "use strict";

  const SESSION_KEY = "maxquill:reader-invite-session";
  const PREFS_KEY = "maxquill:reader-preferences";
  const defaults = { theme: "dark", fontSize: "medium", textWidth: "normal", lineHeight: "normal" };

  let inviteMeta = null;
  let session = null;
  let sourcePackage = null;
  let comments = [];
  let pendingSelection = null;
  let selectionTimer = null;
  let actionEngaged = false;
  let finished = false;

  function params() { return new URLSearchParams(location.search); }
  function showMessage(selector, message) {
    const node = document.querySelector(selector);
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
  }
  function readStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function writeStorage(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* ignore */ }
  }
  function sessionStorageKey(inviteId) { return `${SESSION_KEY}:${inviteId}`; }
  function loadSession(inviteId) {
    const value = readStorage(sessionStorageKey(inviteId), null);
    if (!value?.sessionToken || !value?.reviewerId) return null;
    return value;
  }
  function saveSession(value) { writeStorage(sessionStorageKey(value.inviteId), value); }

  function applyPreferences(preferences) {
    const root = document.documentElement;
    for (const key of ["theme", "fontSize", "textWidth", "lineHeight"]) {
      root.dataset[key === "theme" ? "readerTheme" : key] = preferences[key];
    }
    document.querySelector('meta[name="theme-color"]').content =
      preferences.theme === "dark" ? "#0c0b0a" : preferences.theme === "sepia" ? "#eee4ce" : "#f5f2eb";
    document.querySelectorAll("[data-setting]").forEach((button) => {
      button.setAttribute("aria-pressed", String(preferences[button.dataset.setting] === button.dataset.value));
    });
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

  function hideSelectionActions(clearSelection = false) {
    document.querySelector("#selection-actions").hidden = true;
    if (clearSelection) pendingSelection = null;
  }

  function renderParagraphs() {
    const body = document.querySelector("#chapter-body");
    if (!body || !sourcePackage) return;
    body.replaceChildren();
    for (const item of sourcePackage.content) {
      const paragraph = document.createElement("p");
      paragraph.id = `paragraph-${item.id}`;
      paragraph.dataset.paragraphId = item.id;
      const notes = comments.filter((note) => note.paragraphId === item.id);
      if (notes.length) appendHighlightedText(paragraph, item, notes);
      else paragraph.textContent = item.text;
      body.append(paragraph);
    }
  }

  function appendHighlightedText(paragraph, item, annotations) {
    const usable = [...annotations]
      .sort((a, b) => a.selectionStart - b.selectionStart)
      .filter((note, index, all) => !all[index - 1] || note.selectionStart >= all[index - 1].selectionEnd);
    let cursor = 0;
    for (const note of usable) {
      paragraph.append(document.createTextNode(item.text.slice(cursor, note.selectionStart)));
      const mark = document.createElement("mark");
      mark.className = "annotation-highlight";
      mark.dataset.commentId = note.commentId;
      mark.tabIndex = 0;
      mark.textContent = item.text.slice(note.selectionStart, note.selectionEnd);
      mark.setAttribute("aria-label", `Comment: ${note.commentText}`);
      paragraph.append(mark);
      cursor = note.selectionEnd;
    }
    paragraph.append(document.createTextNode(item.text.slice(cursor)));
  }

  function renderChapter() {
    document.querySelector("#reader-content").innerHTML =
      `<article class="chapter-article" aria-labelledby="chapter-title"><header class="chapter-heading"><p class="eyebrow">Chapter ${sourcePackage.chapterNumber}</p><h1 id="chapter-title"></h1><p class="chapter-review-status">Reader feedback · Version ${sourcePackage.chapterVersion}</p></header><div class="chapter-body" id="chapter-body"></div></article>`;
    document.querySelector("#chapter-title").textContent = sourcePackage.title;
    renderParagraphs();
  }

  function selectionDetails() {
    if (finished) return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const endNode = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startParagraph = startNode?.closest("[data-paragraph-id]");
    const endParagraph = endNode?.closest("[data-paragraph-id]");
    if (!startParagraph || startParagraph !== endParagraph) return null;
    const beforeStart = range.cloneRange();
    const beforeEnd = range.cloneRange();
    beforeStart.selectNodeContents(startParagraph);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    beforeEnd.selectNodeContents(startParagraph);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const selectionStart = Math.min(beforeStart.toString().length, beforeEnd.toString().length);
    const selectionEnd = Math.max(beforeStart.toString().length, beforeEnd.toString().length);
    if (selectionStart === selectionEnd) return null;
    const paragraph = sourcePackage.content.find((item) => item.id === startParagraph.dataset.paragraphId);
    if (!paragraph) return null;
    const candidate = {
      paragraphId: paragraph.id,
      startParagraphId: startParagraph.dataset.paragraphId,
      endParagraphId: endParagraph.dataset.paragraphId,
      selectedText: paragraph.text.substring(selectionStart, selectionEnd),
      selectionStart,
      selectionEnd,
      rect: range.getBoundingClientRect()
    };
    return MaxQuillSelectionLogic.validateSelectionCandidate(sourcePackage, candidate).valid ? candidate : null;
  }

  function readSelectionState() {
    if (document.querySelector("#annotation-dialog").open || document.querySelector("#review-panel").open || finished) {
      hideSelectionActions(true);
      return;
    }
    const selection = window.getSelection();
    const actions = document.querySelector("#selection-actions");
    const details = selectionDetails();
    if (!selection || selection.isCollapsed) {
      if (!actionEngaged) hideSelectionActions(true);
      showMessage("#selection-message", "");
      return;
    }
    if (!details) {
      hideSelectionActions(true);
      showMessage("#selection-message", "Select text within one paragraph to comment.");
      return;
    }
    showMessage("#selection-message", "");
    pendingSelection = details;
    document.querySelector("#selection-preview").textContent = details.selectedText;
    actions.hidden = false;
    if (!matchMedia("(hover: none), (pointer: coarse)").matches) {
      const width = actions.offsetWidth;
      const height = actions.offsetHeight;
      actions.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, details.rect.left + details.rect.width / 2 - width / 2))}px`;
      actions.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, details.rect.top - height - 10))}px`;
    }
  }

  function handleTextSelection(delay = 320) {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(readSelectionState, delay);
  }

  function openEditor() {
    if (!pendingSelection || finished) return;
    showMessage("#annotation-message", "");
    document.querySelector("#annotation-quote").textContent = `“${pendingSelection.selectedText}”`;
    document.querySelector("#annotation-type").value = "";
    document.querySelector("#annotation-comment").value = "";
    document.querySelector("#annotation-dialog").showModal();
    document.querySelector("#annotation-comment").focus();
  }

  function closeEditor() {
    document.querySelector("#annotation-dialog").close();
    hideSelectionActions(true);
    window.getSelection()?.removeAllRanges();
    pendingSelection = null;
    actionEngaged = false;
  }

  async function saveComment(event) {
    event.preventDefault();
    if (!pendingSelection || !session) return;
    const commentText = document.querySelector("#annotation-comment").value.trim();
    if (!commentText) {
      showMessage("#annotation-message", "Add a comment before saving.");
      return;
    }
    const category = document.querySelector("#annotation-type").value || null;
    const paragraph = sourcePackage.content.find((item) => item.id === pendingSelection.paragraphId);
    if (!paragraph || paragraph.text.substring(pendingSelection.selectionStart, pendingSelection.selectionEnd) !== pendingSelection.selectedText) {
      showMessage("#annotation-message", "This selection no longer matches the paragraph. Select the text again.");
      return;
    }
    try {
      const saved = await MaxQuillReaderFeedbackApi.createComment(session.sessionToken, {
        packageFingerprint: session.packageFingerprint,
        paragraphId: pendingSelection.paragraphId,
        selectionStart: pendingSelection.selectionStart,
        selectionEnd: pendingSelection.selectionEnd,
        selectedText: pendingSelection.selectedText,
        commentText,
        category
      });
      comments.push(saved);
      updateReviewUi();
      closeEditor();
      renderParagraphs();
    } catch (error) {
      showMessage("#annotation-message", error.message || "Comment could not be saved.");
    }
  }

  function updateReviewUi() {
    document.querySelector("#open-note-count").textContent = `Comments: ${comments.length}`;
    document.querySelector("#review-chapter-status").textContent = finished
      ? `Finished · ${session?.displayName || "Reader"}`
      : `Reader feedback · ${session?.displayName || ""}`;
    document.querySelector("#finish-review").disabled = finished;
    document.querySelector("#finish-review-panel").disabled = finished;
    const list = document.querySelector("#review-note-list");
    list.replaceChildren();
    document.querySelector("#review-summary").innerHTML =
      `<p><strong>${comments.length} ${comments.length === 1 ? "comment" : "comments"}</strong><br>${finished ? "Review finished. Thank you." : "Select text to leave feedback."}</p>`;
    if (!comments.length) {
      const empty = document.createElement("li");
      empty.className = "empty-notes";
      empty.textContent = "No comments yet.";
      list.append(empty);
      return;
    }
    comments.forEach((note, index) => {
      const item = document.createElement("li");
      item.className = "review-note";
      item.innerHTML = '<button type="button" class="note-jump"><span></span><q></q><small></small></button>';
      item.querySelector("span").textContent = `${index + 1}. ${note.category || "General"}`;
      item.querySelector("q").textContent = note.selectedText;
      item.querySelector("small").textContent = note.commentText;
      item.querySelector(".note-jump").addEventListener("click", () => {
        document.querySelector("#review-panel").close();
        document.querySelector(`#paragraph-${note.paragraphId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      list.append(item);
    });
  }

  async function finishReview() {
    if (!session || finished) return;
    showMessage("#review-message", "");
    try {
      await MaxQuillReaderFeedbackApi.finishReview(session.sessionToken);
      finished = true;
      session.finishedAt = new Date().toISOString();
      saveSession(session);
      updateReviewUi();
      hideSelectionActions(true);
      showMessage("#review-message", "Thanks — your feedback was submitted.");
    } catch (error) {
      showMessage("#review-message", error.message || "Could not finish review.");
    }
  }

  function setupReviewInteractions() {
    const body = () => document.querySelector("#chapter-body");
    const actions = document.querySelector("#selection-actions");
    document.addEventListener("pointerup", (event) => {
      if (body()?.contains(event.target)) handleTextSelection(40);
    });
    document.addEventListener("keyup", (event) => {
      if (body()?.contains(event.target)) handleTextSelection(40);
    });
    document.addEventListener("selectionchange", () => handleTextSelection(320));
    actions.addEventListener("pointerdown", () => { actionEngaged = true; });
    actions.addEventListener("click", (event) => {
      if (event.target.dataset.selectionAction === "comment") openEditor();
      actionEngaged = false;
    });
    addEventListener("scroll", () => { hideSelectionActions(false); showMessage("#selection-message", ""); }, { passive: true });
    document.querySelector("#annotation-form").addEventListener("submit", saveComment);
    document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeEditor));
    document.querySelector("#open-review-panel").addEventListener("click", () => document.querySelector("#review-panel").showModal());
    document.querySelector("[data-close-panel]").addEventListener("click", () => document.querySelector("#review-panel").close());
    document.querySelector("#finish-review").addEventListener("click", finishReview);
    document.querySelector("#finish-review-panel").addEventListener("click", finishReview);
  }

  async function enterReading() {
    document.querySelector("#invite-gate").hidden = true;
    document.querySelector("#review-bar").hidden = false;
    document.title = `${sourcePackage.title} | Reader feedback`;
    renderChapter();
    updateReviewUi();
  }

  async function startWithName() {
    const displayName = document.querySelector("#display-name").value.trim();
    showMessage("#gate-message", "");
    if (!displayName) {
      showMessage("#gate-message", "Enter your name to continue.");
      return;
    }
    try {
      const joined = await MaxQuillReaderFeedbackApi.joinInvite(inviteMeta.inviteId, displayName);
      session = {
        inviteId: joined.inviteId,
        reviewerId: joined.reviewerId,
        displayName: joined.displayName,
        sessionToken: joined.sessionToken,
        packageFingerprint: joined.packageFingerprint,
        bookId: joined.bookId,
        chapterId: joined.chapterId,
        chapterVersion: joined.chapterVersion
      };
      saveSession(session);
      comments = [];
      finished = false;
      await enterReading();
    } catch (error) {
      showMessage("#gate-message", error.message || "Could not start the invite.");
    }
  }

  async function resumeSession(existing) {
    session = existing;
    finished = Boolean(existing.finishedAt);
    try {
      comments = await MaxQuillReaderFeedbackApi.listOwnComments(session.sessionToken);
    } catch (_) {
      comments = [];
      session = null;
      writeStorage(sessionStorageKey(inviteMeta.inviteId), null);
      return false;
    }
    await enterReading();
    return true;
  }

  async function loadPackage(url, expectedFingerprint) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Chapter package returned ${response.status}`);
    const pkg = await MaxQuillReviewApi.packageIdentity(await response.json());
    if (pkg.packageFingerprint !== expectedFingerprint) {
      throw new Error("This invite points to a different draft than the published package.");
    }
    return pkg;
  }

  async function init() {
    setupSettings();
    setupReviewInteractions();
    const token = params().get("token");
    if (!token) {
      document.querySelector("#reader-content").innerHTML = '<p class="error-message reader-loading">Invite link is missing a token.</p>';
      return;
    }
    try {
      inviteMeta = await MaxQuillReaderFeedbackApi.getInvite(token);
      sourcePackage = await loadPackage(inviteMeta.packageUrl, inviteMeta.packageFingerprint);
      document.querySelector("#invite-title").textContent = inviteMeta.title || sourcePackage.title;
      document.querySelector("#invite-badge").textContent = `Ch ${inviteMeta.chapterNumber} · v${inviteMeta.chapterVersion}`;
      const existing = loadSession(inviteMeta.inviteId);
      if (existing && existing.packageFingerprint === inviteMeta.packageFingerprint) {
        const resumed = await resumeSession(existing);
        if (resumed) return;
      }
      document.querySelector("#invite-gate").hidden = false;
      document.querySelector("#reader-content").innerHTML = "";
      document.querySelector("#start-invite").addEventListener("click", startWithName);
      document.querySelector("#display-name").addEventListener("keydown", (event) => {
        if (event.key === "Enter") startWithName();
      });
    } catch (error) {
      console.error(error);
      document.querySelector("#reader-content").innerHTML =
        `<p class="error-message reader-loading">${error.message || "This invite could not be opened."}</p>`;
    }
  }

  init();
})();
