(() => {
  "use strict";
  const BOOK_URL = "content/book-001/book.json";
  const PROGRESS_KEY = "maxquill:progress:book-001";
  const PREFS_KEY = "maxquill:reader-preferences";
  const MODE_KEY = "maxquill:reader-mode";
  const defaults = { theme: "dark", fontSize: "medium", textWidth: "normal", lineHeight: "normal" };
  let book, chapter, sourcePackage, reviewIdentity, progress, review, reviewJob = null, pendingSelection = null, editingId = null, scrollTimer, selectionTimer, pollTimer, actionEngaged = false, submitting = false, companionManifest = null, companionState = null, revisionContext = null;

  function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (error) { console.warn(`Could not read ${key}.`, error); return fallback; } }
  function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { console.warn(`Could not save ${key}.`, error); } }
  function reviewKey() { return MaxQuillReviewApi.reviewStorageKey(reviewIdentity); }
  function newReview() { return { packageFingerprint: reviewIdentity.packageFingerprint, completed: false, reviewedAt: null, annotations: [] }; }
  function saveReview() { writeStorage(reviewKey(), review); updateReviewUi(); }
  function chapterUrl(item) { return `reader.html?book=${encodeURIComponent(book.id)}&chapter=${item.number}&version=${item.version}`; }
  function packageUrl(bookId, number, version) { return `content/books/${encodeURIComponent(bookId)}/review/chapter_${String(number).padStart(4, "0")}_v${version}.json`; }
  function showMessage(selector, message) { const node = document.querySelector(selector); node.textContent = message; node.hidden = !message; }
  function hideSelectionActions(clearSelection = false) { document.querySelector("#selection-actions").hidden = true; if (clearSelection) pendingSelection = null; }
  function showingChanges() { return Boolean(revisionContext && revisionContext.session.viewMode === "changes"); }
  function showingOriginalNotes() { return Boolean(revisionContext && revisionContext.session.viewMode === "notes"); }
  function originalNotes() { return revisionContext?.ownerReview?.annotations || []; }
  function displayTitle() { return showingOriginalNotes() ? revisionContext.beforePackage.title : sourcePackage.title; }
  function refreshChapterTitle() {
    const heading = document.querySelector("#chapter-title");
    if (heading) heading.textContent = displayTitle();
    const actions = document.querySelector("#chapter-title-review");
    if (!actions) return;
    const reviewMode = document.documentElement.dataset.readerMode === "review";
    actions.hidden = !reviewMode || showingChanges() || showingOriginalNotes();
  }
  function openTitleEditor(existing = null, preset = "") {
    if (showingOriginalNotes()) { document.querySelector("#review-panel").showModal(); return; }
    pendingSelection = { target: "chapter_title", selectedText: sourcePackage.title };
    openEditor(existing, "other");
    if (preset && !existing) document.querySelector("#annotation-comment").value = preset;
  }
  function setRevisionView(mode) {
    if (!revisionContext) return;
    revisionContext.session = MaxQuillRevisionReview.setViewMode(revisionContext.session, mode);
    saveRevisionSession();
    const status = document.querySelector(".chapter-review-status");
    if (status) status.textContent = chapterStatusLine();
    hideSelectionActions(true);
    renderChapterBody();
    updateReviewUi();
  }
  function persistRevisionSource(jobId) {
    if (!jobId || !reviewIdentity || !sourcePackage) return;
    const ownerReview = review?.completed ? buildOwnerReviewPackage() : MaxQuillRevisionReview.ownerReviewFromLocal(review, sourcePackage);
    writeStorage(MaxQuillRevisionReview.sourceStorageKey(jobId), MaxQuillRevisionReview.createSourceRecord(jobId, reviewIdentity, sourcePackage, ownerReview));
  }
  function saveRevisionSession() {
    if (!revisionContext?.afterIdentity) return;
    writeStorage(MaxQuillRevisionReview.sessionStorageKey(revisionContext.afterIdentity), revisionContext.session);
  }
  function refreshRevisionModel() {
    if (!revisionContext) return;
    revisionContext.model = MaxQuillRevisionReview.applyAccepted(MaxQuillRevisionDiff.buildRevisionReviewModel(revisionContext.beforePackage, sourcePackage, revisionContext.ownerReview), revisionContext.session.acceptedChangeIds);
  }
  async function attachRevisionContext(resultJob, afterPackage) {
    if (!window.MaxQuillRevisionDiff || !window.MaxQuillRevisionReview) return null;
    const afterIdentity = await MaxQuillReviewApi.packageIdentity(afterPackage);
    const stored = MaxQuillRevisionReview.normalizeSourceRecord(readStorage(MaxQuillRevisionReview.sourceStorageKey(resultJob), null), { jobId: resultJob, bookId: afterPackage.bookId, chapterId: afterPackage.chapterId, chapterNumber: afterPackage.chapterNumber, chapterVersion: afterPackage.chapterVersion - 1 });
    let beforePackage = stored?.sourcePackage || null, ownerReview = stored?.ownerReview || null;
    if (!beforePackage && afterPackage.chapterVersion > 1) {
      try {
        const response = await fetch(packageUrl(afterPackage.bookId, afterPackage.chapterNumber, afterPackage.chapterVersion - 1));
        if (response.ok) {
          const candidate = await response.json(), validation = MaxQuillReviewContract.validateReviewReadyPackage(candidate);
          if (validation.valid && candidate.bookId === afterPackage.bookId && candidate.chapterId === afterPackage.chapterId && candidate.chapterNumber === afterPackage.chapterNumber && candidate.chapterVersion === afterPackage.chapterVersion - 1) beforePackage = candidate;
        }
      } catch (error) { console.warn("Could not load the previous review package.", error); }
    }
    if (!beforePackage) return null;
    const beforeIdentity = await MaxQuillReviewApi.packageIdentity(beforePackage);
    if (!ownerReview) ownerReview = MaxQuillRevisionReview.ownerReviewFromLocal(readStorage(MaxQuillReviewApi.reviewStorageKey(beforeIdentity), null), beforePackage);
    if (ownerReview && !MaxQuillReviewContract.validateOwnerReviewPackage(ownerReview, beforePackage).valid) ownerReview = null;
    revisionContext = { jobId: resultJob, beforePackage, beforeIdentity, afterIdentity, ownerReview, session: MaxQuillRevisionReview.normalizeSession(readStorage(MaxQuillRevisionReview.sessionStorageKey(afterIdentity), null), beforeIdentity, afterIdentity), model: null };
    refreshRevisionModel();
    return revisionContext;
  }
  function chapterStatusLine() {
    if (!revisionContext) return `Review Candidate · Version ${sourcePackage.chapterVersion} · REVIEW_READY`;
    const relation = MaxQuillRevisionReview.versionRelationLabel(revisionContext.beforePackage?.chapterVersion, sourcePackage.chapterVersion);
    return relation ? `Revision Ready · ${relation}` : `Revision Ready · Version ${sourcePackage.chapterVersion}`;
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  function renderPassage(target, text, tokens, keep) {
    if (!tokens || !tokens.length) { target.textContent = text || ""; return; }
    for (const token of tokens) {
      if (keep && token.type !== "equal" && token.type !== keep) continue;
      if (token.type === "equal") target.append(document.createTextNode(token.text));
      else {
        const semantic = token.type === "inserted" ? "revision-text revision-new" : "revision-text revision-changed";
        const mark = node("span", semantic, token.text);
        mark.setAttribute("data-diff", token.type === "inserted" ? "inserted" : "changed");
        target.append(mark);
      }
    }
    if (!target.childNodes.length) target.textContent = text || "";
  }
  function kindLabel(kind) { return { changed: "Changed", removed: "Removed", inserted: "Inserted", moved: "Moved", unchanged: "Unchanged", title: "Chapter title", title_unchanged: "Chapter title" }[kind] || kind; }
  function originLabel(origin) { return origin === "owner_requested" ? "Owner-requested change" : "Additional revision change"; }
  function proseRoleClass(role, side) {
    if (role === "context") return "revision-prose-context";
    if (side === "new") return "revision-text revision-new";
    if (role === "removed") return "revision-text revision-removed";
    return "revision-text revision-changed";
  }
  function appendPassageBlock(side, passages, label, ownerReviews, inlineTokens) {
    if (!passages?.length) {
      side.append(node("p", "revision-empty", "[none]"));
      return;
    }
    const block = node("div", "revision-prose");
    block.setAttribute("role", "group");
    block.setAttribute("aria-label", label);
    const isNew = label === "New Version";
    for (const passage of passages) {
      const body = node("p", `revision-prose-p${passage.changed ? "" : " is-context"}`);
      body.setAttribute("data-passage-role", passage.role || (passage.changed ? "changed" : "unchanged"));
      if (passage.id && isNew) {
        body.id = `paragraph-${passage.id}`;
        body.dataset.paragraphId = passage.id;
      }
      const roleClass = proseRoleClass(passage.role || (passage.changed ? (isNew ? "inserted" : "changed") : "context"), isNew ? "new" : "old");
      if (passages.length === 1 && inlineTokens?.length) {
        renderPassage(body, passage.text, inlineTokens, isNew ? "inserted" : "removed");
      } else if (passage.changed) {
        const mark = node("span", roleClass, passage.text);
        mark.setAttribute("data-diff", passage.role === "removed" ? "removed" : passage.role === "inserted" ? "inserted" : "changed");
        body.append(mark);
      } else body.textContent = passage.text;
      block.append(body);
    }
    side.append(block);
  }
  function appendSide(parent, label, passage, context, tokens, keep, paragraphId, ownerReviews) {
    const side = node("div", `revision-side revision-side-${label === "New Version" ? "new" : "old"}`);
    side.append(node("span", "revision-side-label", label));
    if (passage?.passages?.length) appendPassageBlock(side, passage.passages, label, ownerReviews, tokens);
    else {
      const showContext = Boolean(context?.previous || context?.next) && passage && passage.text.length > 420;
      if (showContext && context?.previous) side.append(node("p", "revision-context", `[…] ${context.previous}`));
      if (!passage) side.append(node("p", "revision-empty", "[none]"));
      else if (passage.text) {
        appendPassageBlock(side, [{ id: paragraphId || passage.id || null, text: passage.text, role: keep === "inserted" ? "inserted" : keep === "removed" ? "removed" : "changed", changed: true }], label, ownerReviews, tokens);
      }
      if (showContext && context?.next) side.append(node("p", "revision-context", `${context.next} […]`));
    }
    parent.append(side);
  }
  function appendOwnerReviews(card, reviews) {
    if (!reviews?.length) return;
    const section = node("div", "revision-owner-note");
    section.append(node("p", "revision-side-label", "Owner Review Note"));
    for (const note of reviews) {
      const block = node("div", "revision-review");
      block.append(node("p", "revision-note-category", note.category || "other"));
      if (note.selectedText) {
        const quote = document.createElement("q");
        quote.className = "revision-note-quote";
        quote.textContent = note.selectedText;
        block.append(quote);
      }
      const comment = document.createElement("blockquote");
      comment.className = "revision-note-comment";
      comment.textContent = note.comment;
      block.append(comment);
      section.append(block);
    }
    card.append(section);
  }
  function appendChangeCard(body, change, options = {}) {
    const card = node("article", `revision-change${change.kind === "title" ? " revision-title" : ""}${change.accepted ? " is-accepted" : ""}`);
    card.dataset.changeId = change.id;
    const header = node("div", "revision-change-header");
    const title = options.title || (change.origin === "owner_requested" ? "Revision" : "Additional revision change");
    header.append(node("p", "revision-kicker", title));
    header.append(node("span", "revision-kind-badge", kindLabel(change.kind)));
    card.append(header);
    if (change.origin === "additional_revision") card.append(node("p", "revision-origin", originLabel(change.origin)));
    const pair = node("div", "revision-pair");
    appendSide(pair, "New Version", change.after, change.afterContext, change.inline, "inserted", change.after?.id || null, null);
    appendSide(pair, "Old Version", change.before, change.beforeContext, change.inline, "removed", null, change.ownerReviews);
    card.append(pair);
    appendOwnerReviews(card, change.ownerReviews);
    const actions = node("div", "revision-actions");
    const accept = node("button", change.accepted ? "is-accepted" : "", change.accepted ? "Accepted" : "Accept"); accept.type = "button"; accept.dataset.changeAction = "accept"; accept.addEventListener("click", () => acceptChange(change.id));
    const comment = node("button", "", "Comment"); comment.type = "button"; comment.addEventListener("click", () => commentOnChange(change));
    const flag = node("button", "", "Flag"); flag.type = "button"; flag.addEventListener("click", () => commentOnChange(change, "other", "Flagged for revision."));
    actions.append(accept, comment, flag); card.append(actions); body.append(card);
  }
  function changeParagraph(change) {
    if (change.after?.id) return sourcePackage.content.find((item) => item.id === change.after.id) || null;
    return null;
  }
  function commentOnChange(change, category = "wording", preset = "") {
    if (change?.kind === "title" || change?.kind === "title_unchanged" || change?.annotation?.target === "chapter_title") {
      openTitleEditor(null, preset);
      return;
    }
    const paragraph = changeParagraph(change) || (change.after ? { id: change.after.id, text: change.after.text } : null);
    if (!paragraph) { showMessage("#selection-message", "Open the full chapter to comment near this removal."); return; }
    const candidate = { paragraphId: paragraph.id, startParagraphId: paragraph.id, endParagraphId: paragraph.id, selectedText: paragraph.text, selectionStart: 0, selectionEnd: paragraph.text.length };
    if (!MaxQuillSelectionLogic.validateSelectionCandidate(sourcePackage, candidate).valid) { showMessage("#selection-message", "This passage cannot be annotated."); return; }
    pendingSelection = candidate;
    openEditor(null, category);
    if (preset) document.querySelector("#annotation-comment").value = preset;
  }
  function acceptChange(changeId) {
    if (!revisionContext) return;
    revisionContext.session = MaxQuillRevisionReview.toggleAccepted(revisionContext.session, changeId);
    saveRevisionSession(); refreshRevisionModel(); renderChapterBody(); updateReviewUi();
  }
  function acceptAllChanges() {
    if (!revisionContext) return;
    revisionContext.session = MaxQuillRevisionReview.acceptAll(revisionContext.session, [
      ...(revisionContext.model?.titleChange ? [revisionContext.model.titleChange.id] : []),
      ...(revisionContext.model?.changes || []).map((change) => change.id)
    ]);
    saveRevisionSession(); refreshRevisionModel(); renderChapterBody(); updateReviewUi();
  }
  function renderRevisionChanges() {
    const body = document.querySelector("#chapter-body"); if (!body || !revisionContext?.model) return;
    body.replaceChildren();
    const model = revisionContext.model, toolbar = node("div", "revision-toolbar"), summary = node("p");
    summary.textContent = `${model.summary.total} ${model.summary.total === 1 ? "change" : "changes"} · ${model.summary.ownerRequested} owner-requested · ${model.summary.additional} additional${model.summary.unmatched ? ` · ${model.summary.unmatched} with no detectable text change` : ""}`;
    toolbar.append(summary);
    const legend = node("p", "revision-legend");
    legend.append(
      node("span", "revision-legend-new", "Green — New / Revised"),
      node("span", "revision-legend-changed", "Orange — Changed from old version"),
      node("span", "revision-legend-removed", "Red — Removed")
    );
    toolbar.append(legend);
    if (model.changes.length || model.titleChange) {
      const acceptAll = node("button", "", "Accept All"); acceptAll.type = "button"; acceptAll.addEventListener("click", acceptAllChanges); toolbar.append(acceptAll);
    }
    body.append(toolbar);
    if (!model.changes.length && !model.unmatchedReviewItems.length && !model.titleChange) {
      body.append(node("p", "revision-empty", "No detectable text changes. View the full chapter to read the revised version."));
      return;
    }
    if (model.titleChange) appendChangeCard(body, model.titleChange, { title: "Chapter title" });
    model.changes.forEach((change) => appendChangeCard(body, change));
    model.unmatchedReviewItems.forEach((item, index) => {
      const card = node("article", "revision-change");
      const titleItem = item.kind === "title_unchanged" || item.annotation?.target === "chapter_title";
      const header = node("div", "revision-change-header");
      header.append(node("p", "revision-kicker", titleItem ? "Chapter title" : "Owner Review Note"));
      header.append(node("span", "revision-kind-badge", "No text change"));
      card.append(header);
      card.append(node("p", "revision-alert", "Review item produced no detectable text change"));
      if (item.after || item.before) {
        const pair = node("div", "revision-pair");
        appendSide(pair, "New Version", item.after, null, null, null, item.after?.id || null, null);
        appendSide(pair, "Old Version", item.before || item.after, null, null, null, null, item.annotation ? [item.annotation] : []);
        card.append(pair);
      }
      appendOwnerReviews(card, item.annotation ? [item.annotation] : []);
      if (item.after) {
        const actions = node("div", "revision-actions");
        const comment = node("button", "", "Comment"); comment.type = "button"; comment.addEventListener("click", () => commentOnChange(item));
        const flag = node("button", "", "Flag"); flag.type = "button"; flag.addEventListener("click", () => commentOnChange(item, "other", "Flagged for revision."));
        actions.append(comment, flag); card.append(actions);
      }
      body.append(card);
    });
  }
  function renderChapterBody() {
    if (showingChanges()) renderRevisionChanges();
    else if (showingOriginalNotes()) renderParagraphs(revisionContext.beforePackage, originalNotes());
    else renderParagraphs();
    refreshChapterTitle();
  }

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
    window.getSelection()?.removeAllRanges(); renderChapterBody(); refreshChapterTitle();
  }
  function setupModes() { document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode))); setMode(readStorage(MODE_KEY, "read")); }
  function navMarkup(position) {
    const index = book.chapters.findIndex((item) => item.number === sourcePackage.chapterNumber), previous = book.chapters[index - 1], next = book.chapters[index + 1];
    return `<nav class="reader-nav ${position}" aria-label="${position === "top" ? "Chapter navigation" : "End of chapter navigation"}">${previous ? `<a class="nav-link previous" href="${chapterUrl(previous)}">&larr; Previous chapter</a>` : '<span class="nav-link previous disabled" aria-hidden="true">Previous</span>'}<a class="nav-link back" href="book.html?book=${encodeURIComponent(book.id)}">Back to book</a>${next ? `<a class="nav-link next" data-next-chapter href="${chapterUrl(next)}">Next chapter &rarr;</a>` : '<span class="nav-link next disabled" aria-hidden="true">Next</span>'}</nav>`;
  }
  function renderReader() {
    document.querySelector("#reader-content").innerHTML = `${navMarkup("top")}<article class="chapter-article" aria-labelledby="chapter-title"><header class="chapter-heading"><p class="eyebrow">Chapter ${sourcePackage.chapterNumber}</p><h1 id="chapter-title"></h1><div class="chapter-title-review" id="chapter-title-review" hidden><button type="button" id="comment-chapter-title">Comment</button><button type="button" id="suggest-chapter-title">Suggest change</button></div><p class="chapter-review-status">${chapterStatusLine()}</p></header><div class="chapter-body" id="chapter-body"></div></article>${navMarkup("bottom")}`;
    refreshChapterTitle(); renderChapterBody();
  }
  function appendHighlightedText(paragraph, item, annotations) {
    const usable = [...annotations].sort((a, b) => a.selectionStart - b.selectionStart).filter((note, index, all) => !all[index - 1] || note.selectionStart >= all[index - 1].selectionEnd); let cursor = 0;
    for (const note of usable) { paragraph.append(document.createTextNode(item.text.slice(cursor, note.selectionStart))); const mark = document.createElement("mark"); mark.className = "annotation-highlight"; mark.dataset.annotationId = note.id; mark.tabIndex = 0; mark.textContent = item.text.slice(note.selectionStart, note.selectionEnd); mark.setAttribute("aria-label", `${note.category} annotation: ${note.comment}`); paragraph.append(mark); cursor = note.selectionEnd; }
    paragraph.append(document.createTextNode(item.text.slice(cursor)));
  }
  function renderParagraphs(pkg = sourcePackage, annotations = review?.annotations || []) {
    const body = document.querySelector("#chapter-body"); if (!body || !pkg) return; body.replaceChildren(); const reviewMode = document.documentElement.dataset.readerMode === "review";
    for (const item of pkg.content) { const paragraph = document.createElement("p"); paragraph.id = `paragraph-${item.id}`; paragraph.dataset.paragraphId = item.id; const notes = reviewMode ? annotations.filter((note) => note.paragraphId === item.id && note.status === "open" && Number.isInteger(note.selectionStart)) : []; if (notes.length) appendHighlightedText(paragraph, item, notes); else paragraph.textContent = item.text; body.append(paragraph); }
  }
  function selectionDetails() {
    if (showingOriginalNotes()) return null;
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
    if (showingOriginalNotes()) { document.querySelector("#review-panel").showModal(); return; }
    editingId = note?.id || null; const source = note || pendingSelection; if (!source) return; showMessage("#annotation-message", "");
    document.querySelector("#annotation-title").textContent = note ? "Edit annotation" : (source.target === "chapter_title" ? "Chapter title" : "Add annotation");
    document.querySelector("#annotation-quote").textContent = (source.target === "chapter_title" || note?.target === "chapter_title") ? `Chapter title: “${source.selectedText || sourcePackage.title}”` : `“${source.selectedText}”`; document.querySelector("#annotation-type").value = note?.category || defaultCategory; document.querySelector("#annotation-comment").value = note?.comment || ""; document.querySelector("#annotation-status").value = note?.status || "open"; document.querySelector("#requires-canon-change").checked = note?.requiresCanonChange || false; document.querySelector("#delete-annotation").hidden = !note; document.querySelector("#annotation-dialog").showModal(); document.querySelector("#annotation-comment").focus();
  }
  function buildOwnerReviewPackage(annotations = review.annotations) { return { schemaVersion: 1, type: "owner_review", source: "owner", bookId: sourcePackage.bookId, chapterId: sourcePackage.chapterId, chapterNumber: sourcePackage.chapterNumber, chapterVersion: sourcePackage.chapterVersion, reviewedAt: review.reviewedAt || new Date().toISOString(), reviewStatus: "completed", annotations: annotations.map((note) => ({ ...note })) }; }
  function saveAnnotation(event) {
    event.preventDefault(); if (showingOriginalNotes()) { showMessage("#annotation-message", "The original review is read-only."); return; } const existing = editingId ? review.annotations.find((item) => item.id === editingId) : null, selection = existing || pendingSelection; if (!selection) return;
    const isTitle = existing?.target === "chapter_title" || selection.target === "chapter_title";
    const annotation = isTitle
      ? { id: existing?.id || annotationId(), target: "chapter_title", selectedText: sourcePackage.title, category: document.querySelector("#annotation-type").value, comment: document.querySelector("#annotation-comment").value.trim(), status: document.querySelector("#annotation-status").value, requiresCanonChange: document.querySelector("#requires-canon-change").checked }
      : { id: existing?.id || annotationId(), paragraphId: selection.paragraphId, selectedText: selection.selectedText, selectionStart: selection.selectionStart, selectionEnd: selection.selectionEnd, category: document.querySelector("#annotation-type").value, comment: document.querySelector("#annotation-comment").value.trim(), status: document.querySelector("#annotation-status").value, requiresCanonChange: document.querySelector("#requires-canon-change").checked };
    if (!annotation.comment) { showMessage("#annotation-message", "Add a comment before saving this note."); return; }
    if (!isTitle) {
      const paragraph = sourcePackage.content.find((item) => item.id === annotation.paragraphId); if (!paragraph || paragraph.text.substring(annotation.selectionStart, annotation.selectionEnd) !== annotation.selectedText) { showMessage("#annotation-message", "This selection no longer matches the original paragraph. Select the text again."); return; }
    }
    const validation = MaxQuillReviewContract.validateOwnerReviewPackage(buildOwnerReviewPackage([annotation]), sourcePackage); if (!validation.valid) { showMessage("#annotation-message", validation.errors.join(" ")); return; }
    if (existing) { const index = review.annotations.findIndex((item) => item.id === editingId); if (index >= 0) review.annotations[index] = annotation; } else review.annotations.push(annotation); review.completed = false; review.reviewedAt = null; saveReview(); closeEditor(); renderChapterBody();
  }
  function quickFlag() { if (!pendingSelection) return; openEditor(null, "other"); document.querySelector("#annotation-comment").value = "Flagged for revision."; }
  function closeEditor() { document.querySelector("#annotation-dialog").close(); hideSelectionActions(true); window.getSelection()?.removeAllRanges(); pendingSelection = null; editingId = null; actionEngaged = false; }
  function deleteAnnotation() { if (showingOriginalNotes() || !editingId) return; review.annotations = review.annotations.filter((note) => note.id !== editingId); review.completed = false; review.reviewedAt = null; saveReview(); closeEditor(); renderChapterBody(); }
  function updateReviewUi() {
    if (!review || !sourcePackage) return;
    const view = MaxQuillRevisionReview.revisionViewState({
      hasRevisionPair: Boolean(revisionContext),
      viewMode: revisionContext?.session?.viewMode || "changes",
      jobStatus: reviewJob?.status,
      originalNoteCount: originalNotes().length,
      changeCount: MaxQuillRevisionReview.changeCardCount(revisionContext?.model),
      currentNoteCount: review.annotations.length,
      beforeVersion: revisionContext?.beforePackage?.chapterVersion,
      afterVersion: sourcePackage.chapterVersion
    });
    document.querySelector("#review-chapter-status").textContent = view.versionLabel || chapterStatusLine();
    const countNode = document.querySelector("#open-note-count");
    countNode.textContent = view.noteCountLabel;
    countNode.hidden = view.countHidden;
    document.querySelector('[data-mode="review"]').textContent = view.modeSwitchLabel;
    const tabs = document.querySelector("#revision-tabs"), notesTab = document.querySelector("#tab-review-notes"), changesTab = document.querySelector("#tab-revision-changes");
    if (tabs) tabs.hidden = view.tabsHidden;
    if (notesTab) { notesTab.textContent = view.notesLabel; notesTab.setAttribute("aria-selected", String(view.notesPressed)); }
    if (changesTab) { changesTab.textContent = view.changesLabel; changesTab.setAttribute("aria-selected", String(view.changesPressed)); }
    const sourceNotes = showingOriginalNotes(), panelNotes = sourceNotes ? originalNotes() : review.annotations, panelVersion = sourceNotes ? revisionContext.beforePackage.chapterVersion : sourcePackage.chapterVersion;
    document.querySelector("#review-panel-title").textContent = "Review Notes";
    const eyebrow = document.querySelector("#review-panel .eyebrow");
    if (eyebrow) eyebrow.textContent = sourceNotes ? `Version ${panelVersion} · submitted` : `Version ${panelVersion}`;
    document.querySelector("#review-summary").innerHTML = `<p><strong>${panelNotes.length} ${panelNotes.length === 1 ? "note" : "notes"}</strong><br>${sourceNotes ? "Original Owner Review" : "Review"} for Version ${panelVersion} · ${sourceNotes ? "read-only" : (review.completed ? "Owner Review Complete" : "Review in progress")}</p>`;
    const list = document.querySelector("#review-note-list"); list.replaceChildren(); if (!panelNotes.length) { const empty = document.createElement("li"); empty.className = "empty-notes"; empty.textContent = sourceNotes ? "No original review notes." : "No notes yet. Select text in Review Mode to begin."; list.append(empty); }
    panelNotes.forEach((note, index) => {
      const item = document.createElement("li"); item.className = "review-note";
      item.innerHTML = '<button type="button" class="note-jump"><span></span><q></q><small></small></button>' + (sourceNotes ? "" : '<button type="button" class="note-edit">Edit</button>');
      item.querySelector("span").textContent = `${index + 1}. ${note.target === "chapter_title" ? "Chapter title" : note.category} · ${note.status}${note.requiresCanonChange ? " · Canon change" : ""}`;
      item.querySelector("q").textContent = note.selectedText; item.querySelector("small").textContent = note.comment;
      item.querySelector(".note-jump").addEventListener("click", () => {
        document.querySelector("#review-panel").close();
        if (note.target === "chapter_title") {
          if (sourceNotes && !showingOriginalNotes()) setRevisionView("notes");
          (document.querySelector('[data-change-id="title:chapter_title"]') || document.querySelector("#chapter-title"))?.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        if (sourceNotes && !showingOriginalNotes()) setRevisionView("notes");
        else if (!sourceNotes && revisionContext && showingChanges() && !document.querySelector(`#paragraph-${note.paragraphId}`)) setRevisionView("full");
        document.querySelector(`#paragraph-${note.paragraphId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      item.querySelector(".note-edit")?.addEventListener("click", () => { document.querySelector("#review-panel").close(); openEditor(note); });
      list.append(item);
    });
    const finish = document.querySelector("#finish-review"); finish.textContent = review.completed ? "Owner Review Complete" : "Finish Review"; finish.setAttribute("aria-pressed", String(review.completed)); finish.disabled = review.completed || sourceNotes; finish.hidden = sourceNotes;
    updateJobUi();
    document.querySelector("#review-job-status").hidden = sourceNotes;
    if (sourceNotes) document.querySelector("#submit-review").hidden = true;
  }
  function finishReview() { if (showingOriginalNotes()) return; const previousReviewedAt = review.reviewedAt; review.reviewedAt = new Date().toISOString(); const validation = MaxQuillReviewContract.validateOwnerReviewPackage(buildOwnerReviewPackage(), sourcePackage); if (!validation.valid) { review.reviewedAt = previousReviewedAt; showMessage("#review-message", `Review cannot be completed: ${validation.errors.join(" ")}`); return; } review.completed = true; showMessage("#review-message", "Review complete."); saveReview(); }
  function exportReview() {
    showMessage("#review-message", ""); if (!review.completed) { showMessage("#review-message", "Finish the review before exporting."); return; } const reviewPackage = buildOwnerReviewPackage(), validation = MaxQuillReviewContract.validateOwnerReviewPackage(reviewPackage, sourcePackage); if (!validation.valid) { showMessage("#review-message", `Export blocked: ${validation.errors.join(" ")}`); return; }
    const blob = new Blob([JSON.stringify(reviewPackage, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `${sourcePackage.bookId}-${sourcePackage.chapterId}-v${sourcePackage.chapterVersion}-owner-review.json`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function persistJob(job) { reviewJob = job; writeStorage(MaxQuillReviewApi.jobStorageKey(reviewIdentity), job); persistRevisionSource(job.jobId); updateJobUi(); }
  function updateJobUi() {
    if (!review || !sourcePackage) return; const submit = document.querySelector("#submit-review"), openRevision = document.querySelector("#open-revised-version"), toggleView = document.querySelector("#toggle-revision-view"), completion = document.querySelector("#review-job-status strong"), submitted = document.querySelector("#submission-state"), queue = document.querySelector("#queue-status");
    const state = MaxQuillSubmitFlow.reviewUiState(review, reviewJob, submitting, MaxQuillReviewApi.STATUS_LABELS);
    const view = MaxQuillRevisionReview.revisionViewState({ hasRevisionPair: Boolean(revisionContext), viewMode: revisionContext?.session?.viewMode || "changes", jobStatus: reviewJob?.status });
    completion.textContent = state.completion; submitted.hidden = state.submittedHidden; submitted.textContent = state.submitted; queue.hidden = state.queueHidden; queue.textContent = state.queue; queue.className = "";
    if (state.readerStatus && !revisionContext) document.querySelector("#review-chapter-status").textContent = state.readerStatus;
    if (reviewJob?.status === "REVISION_READY") queue.className = "is-ready"; if (reviewJob?.status === "FAILED") queue.className = "is-failed";
    submit.hidden = state.submitHidden; submit.disabled = state.submitDisabled; submit.textContent = state.submitText;
    openRevision.hidden = view.openRevisedHidden; openRevision.textContent = view.openRevisedLabel;
    toggleView.hidden = view.toggleHidden; toggleView.textContent = view.toggleLabel; toggleView.setAttribute("aria-pressed", String(view.togglePressed));
  }
  function submissionError(error) {
    if (error.kind === "conflict" || error.kind === "auth" || error.kind === "validation" || error.kind === "submit-network") return error.message;
    return `Backend rejected review. ${error.message || "The request could not be completed."}`;
  }
  function showSubmitToast(title, detail) {
    const toast = document.querySelector("#submit-toast"); document.querySelector("#submit-toast-title").textContent = title; document.querySelector("#submit-toast-detail").textContent = detail; toast.hidden = false; clearTimeout(showSubmitToast.timer); showSubmitToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
  }
  async function submitReview() {
    showMessage("#review-message", ""); if (showingOriginalNotes()) return; if (!review.completed) { showMessage("#review-message", "Finish the review before submitting."); return; }
    await MaxQuillSubmitFlow.submit({ api: MaxQuillReviewApi, buildPackage: buildOwnerReviewPackage, sourcePackage: reviewIdentity, persistJob, refreshJobStatus, startPolling, setSubmitting() {}, showError(message) { showMessage("#review-message", message); }, showSuccess: showSubmitToast, closePanel() { document.querySelector("#review-panel").close(); }, formatError: submissionError });
  }
  async function refreshJobStatus() {
    if (!reviewJob || ["REVISION_READY", "FAILED"].includes(reviewJob.status)) { stopPolling(); return; }
    try { const job = await MaxQuillReviewApi.getReviewJob(reviewJob.jobId, reviewIdentity); job.submittedAt = reviewJob.submittedAt; persistJob(job); if (job.status === "REVISION_READY") { showMessage("#review-message", "Revision ready. Review the changes when you are ready."); stopPolling(); } else if (job.status === "FAILED") { showMessage("#review-message", `Revision failed. ${job.error?.message || "Download the review JSON to retain the handoff."}`); stopPolling(); } }
    catch (error) { showMessage("#review-message", error.message || "Status check failed."); }
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  function startPolling() { stopPolling(); if (reviewJob && !["REVISION_READY", "FAILED"].includes(reviewJob.status)) pollTimer = setInterval(refreshJobStatus, 12000); }
  async function openRevisedVersion() {
    if (reviewJob?.status !== "REVISION_READY") return;
    const button = document.querySelector("#open-revised-version"); button.disabled = true; showMessage("#review-message", "Loading revision changes...");
    try {
      persistRevisionSource(reviewJob.jobId);
      const result = await MaxQuillReviewApi.getReviewResult(reviewJob.jobId, reviewIdentity);
      writeStorage(MaxQuillReviewApi.resultStorageKey(reviewJob.jobId), result);
      location.assign(`reader.html?book=${encodeURIComponent(result.bookId)}&chapter=${result.chapterNumber}&version=${result.chapterVersion}&resultJob=${encodeURIComponent(reviewJob.jobId)}`);
    } catch (error) { button.disabled = false; showMessage("#review-message", error.message || "Revised version could not be loaded."); }
  }
  function setupReview() {
    const body = document.querySelector("#chapter-body"), actions = document.querySelector("#selection-actions");
    body.addEventListener("pointerup", () => handleTextSelection(40)); body.addEventListener("keyup", () => handleTextSelection(40)); document.addEventListener("selectionchange", () => handleTextSelection(320));
    body.addEventListener("click", (event) => {
      const mark = event.target.closest("[data-annotation-id]"); if (!mark) return;
      if (showingOriginalNotes()) { const note = originalNotes().find((item) => item.id === mark.dataset.annotationId); if (note) document.querySelector("#review-panel").showModal(); return; }
      openEditor(review.annotations.find((item) => item.id === mark.dataset.annotationId));
    });
    actions.addEventListener("pointerdown", () => { actionEngaged = true; }); actions.addEventListener("click", (event) => { if (event.target.dataset.selectionAction === "comment") openEditor(); if (event.target.dataset.selectionAction === "flag") quickFlag(); actionEngaged = false; });
    addEventListener("scroll", () => { hideSelectionActions(false); showMessage("#selection-message", ""); }, { passive: true }); addEventListener("resize", () => { hideSelectionActions(false); handleTextSelection(180); }); addEventListener("orientationchange", () => { hideSelectionActions(false); handleTextSelection(250); });
    const submitHandler = MaxQuillSubmitFlow.createSubmitHandler({ submitAction: submitReview, setSubmitting(value) { submitting = value; updateJobUi(); }, showUnexpectedError(message) { showMessage("#review-message", message); } });
    document.querySelector("#annotation-form").addEventListener("submit", saveAnnotation); document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeEditor)); document.querySelector("#delete-annotation").addEventListener("click", deleteAnnotation); document.querySelector("#open-review-panel").addEventListener("click", () => document.querySelector("#review-panel").showModal()); document.querySelector("[data-close-panel]").addEventListener("click", () => document.querySelector("#review-panel").close()); document.querySelector("#finish-review").addEventListener("click", finishReview); document.querySelector("#submit-review").addEventListener("click", submitHandler); document.querySelector("#open-revised-version").addEventListener("click", openRevisedVersion); document.querySelector("#tab-review-notes").addEventListener("click", () => setRevisionView("notes")); document.querySelector("#tab-revision-changes").addEventListener("click", () => setRevisionView("changes")); document.querySelector("#toggle-revision-view").addEventListener("click", () => setRevisionView("full")); document.querySelector("#comment-chapter-title")?.addEventListener("click", () => openTitleEditor()); document.querySelector("#suggest-chapter-title")?.addEventListener("click", () => openTitleEditor(null, "Change chapter title to \"\"")); addEventListener("pagehide", stopPolling); updateReviewUi();
  }
  function saveProgress(markRead = false) { const read = new Set(progress.readChapters || []); if (markRead) read.add(String(sourcePackage.chapterNumber)); const furthest = window.MaxQuillCompanion ? MaxQuillCompanion.advanceFurthestChapter(progress, sourcePackage.chapterNumber, markRead) : Math.max(Number(progress.furthestChapter || 0), ...[...read].map(Number)); progress = { bookId: book.id, currentChapter: String(sourcePackage.chapterNumber), furthestChapter: furthest, readingProgress: Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)), lastOpened: new Date().toISOString(), readChapters: [...read], scrollPositions: { ...(progress.scrollPositions || {}), [sourcePackage.chapterId]: Math.round(scrollY) } }; writeStorage(PROGRESS_KEY, progress); if (window.MaxQuillCompanion) companionState = MaxQuillCompanion.getCompanionState(companionManifest, { progress, viewedChapterId: sourcePackage.chapterId }); }
  function setupProgress() { const saved = Number(progress.scrollPositions?.[sourcePackage.chapterId] || 0); requestAnimationFrame(() => scrollTo({ top: saved, behavior: "instant" })); addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { const max = Math.max(1, document.documentElement.scrollHeight - innerHeight); saveProgress(scrollY / max >= .88); }, 400); }, { passive: true }); addEventListener("pagehide", () => saveProgress()); document.querySelectorAll("[data-next-chapter]").forEach((link) => link.addEventListener("click", () => saveProgress(true))); }
  async function init() {
    setupSettings(); try {
      if (!window.MaxQuillReviewContract || !window.MaxQuillSelectionLogic || !window.MaxQuillReviewApi || !window.MaxQuillSubmitFlow || !window.MaxQuillRevisionDiff || !window.MaxQuillRevisionReview) throw new Error("Review validation support is unavailable."); const bookResponse = await fetch(BOOK_URL); if (!bookResponse.ok) throw new Error(`Book data returned ${bookResponse.status}`); book = await bookResponse.json();
      const params = new URLSearchParams(location.search), requestedBook = params.get("book") || book.id, requestedNumber = Number.parseInt(params.get("chapter") || String(book.chapters[0].number), 10); chapter = book.chapters.find((item) => item.number === requestedNumber); if (requestedBook !== book.id || !chapter) throw new Error("The requested review candidate is not available."); const version = Number.parseInt(params.get("version") || String(chapter.version), 10), resultJob = params.get("resultJob"); if (!Number.isInteger(version) || version < 1) throw new Error("The requested chapter version is invalid.");
      if (resultJob) { const original = { bookId: requestedBook, chapterId: chapter.chapterId, chapterNumber: requestedNumber, chapterVersion: version - 1 }; try { sourcePackage = await MaxQuillReviewApi.getReviewResult(resultJob, original); writeStorage(MaxQuillReviewApi.resultStorageKey(resultJob), sourcePackage); } catch (error) { const cached = readStorage(MaxQuillReviewApi.resultStorageKey(resultJob), null), cachedValidation = MaxQuillReviewContract.validateReviewReadyPackage(cached); if (!cachedValidation.valid || cached?.bookId !== requestedBook || cached?.chapterId !== chapter.chapterId || cached?.chapterNumber !== requestedNumber || cached?.chapterVersion !== version) throw error; sourcePackage = cached; } } else { const response = await fetch(packageUrl(requestedBook, requestedNumber, version)); if (!response.ok) throw new Error(`Review candidate returned ${response.status}`); sourcePackage = await response.json(); }
      const validation = MaxQuillReviewContract.validateReviewReadyPackage(sourcePackage); if (!validation.valid) throw new Error(`Contract validation failed: ${validation.errors.join(" ")}`); if (sourcePackage.bookId !== requestedBook || sourcePackage.chapterNumber !== requestedNumber || sourcePackage.chapterVersion !== version || sourcePackage.chapterId !== chapter.chapterId) throw new Error("Contract validation failed: package identity does not match the requested review candidate.");
      reviewIdentity = await MaxQuillReviewApi.packageIdentity(sourcePackage); if (resultJob) await attachRevisionContext(resultJob, sourcePackage); progress = readStorage(PROGRESS_KEY, { bookId: book.id, readChapters: [], scrollPositions: {} }); review = readStorage(reviewKey(), newReview()); if (!review || typeof review !== "object" || review.packageFingerprint !== reviewIdentity.packageFingerprint || !Array.isArray(review.annotations) || typeof review.completed !== "boolean") review = newReview(); if (review.completed && !review.reviewedAt) { review.reviewedAt = new Date().toISOString(); writeStorage(reviewKey(), review); } reviewJob = MaxQuillReviewApi.normalizeJob(readStorage(MaxQuillReviewApi.jobStorageKey(reviewIdentity), null), reviewIdentity); if (window.MaxQuillCompanion) { const loaded = await MaxQuillCompanion.loadCompanionManifest(MaxQuillCompanion.companionUrl(book.id)); companionManifest = loaded.manifest; companionState = MaxQuillCompanion.getCompanionState(companionManifest, { progress, viewedChapterId: sourcePackage.chapterId }); } document.title = `Chapter ${sourcePackage.chapterNumber}: ${sourcePackage.title} | MaxQuill`; renderReader(); setupModes(); if (revisionContext) setMode("review"); setupReview(); saveProgress(); setupProgress(); if (reviewJob) { await refreshJobStatus(); startPolling(); }
    } catch (error) { console.error("Could not open chapter.", error); document.querySelector("#reader-content").innerHTML = `<p class="error-message reader-loading">This review candidate could not be opened. ${String(error.message || error)} <a href="book.html">Return to the book</a>.</p>`; }
  }
  init();
})();
