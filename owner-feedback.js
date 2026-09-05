(() => {
  "use strict";

  const BOOK_URL = "content/book-001/book.json";
  let book = null;
  let packages = new Map();
  let overview = null;
  let activeView = null;
  let activeComments = null;

  function showMessage(selector, message) {
    const node = document.querySelector(selector);
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
  }

  function packagePath(bookId, number, version) {
    return `content/books/${encodeURIComponent(bookId)}/review/chapter_${String(number).padStart(4, "0")}_v${version}.json`;
  }

  async function loadPackage(chapter) {
    const key = `${chapter.number}:${chapter.version}`;
    if (packages.has(key)) return packages.get(key);
    const response = await fetch(packagePath(book.id, chapter.number, chapter.version));
    if (!response.ok) throw new Error(`Package for chapter ${chapter.number} v${chapter.version} returned ${response.status}`);
    const pkg = await MaxQuillReviewApi.packageIdentity(await response.json());
    packages.set(key, pkg);
    return pkg;
  }

  async function fillChapterSelect() {
    const select = document.querySelector("#invite-chapter");
    select.replaceChildren();
    for (const chapter of book.chapters) {
      try {
        const pkg = await loadPackage(chapter);
        const option = document.createElement("option");
        option.value = JSON.stringify({
          chapterId: pkg.chapterId,
          chapterNumber: pkg.chapterNumber,
          chapterVersion: pkg.chapterVersion,
          packageFingerprint: pkg.packageFingerprint,
          title: pkg.title
        });
        option.textContent = `CH${String(pkg.chapterNumber).padStart(3, "0")} · ${pkg.title} · v${pkg.chapterVersion}`;
        select.append(option);
      } catch (error) {
        console.warn(error);
      }
    }
    if (!select.options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No review packages available";
      select.append(option);
      select.disabled = true;
    }
  }

  async function createInvite(event) {
    event.preventDefault();
    showMessage("#invite-message", "");
    const raw = document.querySelector("#invite-chapter").value;
    if (!raw) {
      showMessage("#invite-message", "Choose a chapter package first.");
      return;
    }
    const body = JSON.parse(raw);
    try {
      const invite = await MaxQuillReaderFeedbackApi.createInvite({
        bookId: book.id,
        chapterId: body.chapterId,
        chapterNumber: body.chapterNumber,
        chapterVersion: body.chapterVersion,
        packageFingerprint: body.packageFingerprint,
        title: body.title
      });
      const url = new URL(invite.inviteUrlPath || invite.invitePath, location.origin).href;
      document.querySelector("#invite-link-box").hidden = false;
      document.querySelector("#invite-link-text").textContent = url;
      document.querySelector("#copy-invite-link").onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          showMessage("#invite-message", "Invite link copied.");
        } catch (_) {
          showMessage("#invite-message", "Copy failed — select the link manually.");
        }
      };
      showMessage("#invite-message", "Invite created.");
      await refreshOverview();
    } catch (error) {
      showMessage("#invite-message", error.message || "Invite could not be created.");
    }
  }

  function chapterLabel(chapterId) {
    const match = /^chapter_(\d+)$/.exec(chapterId || "");
    return match ? `CH${match[1].slice(-3).padStart(3, "0")}` : chapterId;
  }

  function renderOverview() {
    const list = document.querySelector("#feedback-chapter-list");
    list.replaceChildren();
    const chapters = overview?.chapters || [];
    document.querySelector("#overview-meta").textContent =
      chapters.length ? `${chapters.length} with feedback` : "No reader feedback yet";

    const byKey = new Map(chapters.map((row) => [`${row.chapterId}:${row.chapterVersion}:${row.packageFingerprint}`, row]));

    for (const chapter of book.chapters) {
      const pkg = packages.get(`${chapter.number}:${chapter.version}`);
      if (!pkg) continue;
      const stats = byKey.get(`${pkg.chapterId}:${pkg.chapterVersion}:${pkg.packageFingerprint}`);
      const item = document.createElement("li");
      item.className = "feedback-chapter-item";
      if (!stats || stats.commentCount === 0) {
        item.innerHTML = `<div><strong></strong><p class="muted">No reader feedback</p></div>`;
        item.querySelector("strong").textContent = `${chapterLabel(pkg.chapterId)} · ${pkg.title}`;
        item.classList.add("is-empty");
      } else {
        item.innerHTML =
          `<div><strong></strong><p class="muted"></p></div><button type="button" class="primary-button view-feedback">View Feedback</button>`;
        item.querySelector("strong").textContent = `${chapterLabel(pkg.chapterId)} · ${pkg.title}`;
        const names = (stats.readerNames || []).join(", ");
        item.querySelector(".muted").textContent =
          `${stats.readerCount} readers · ${stats.commentCount} comments · ${stats.locationCount} locations${names ? ` · ${names}` : ""} · v${stats.chapterVersion}`;
        item.querySelector(".view-feedback").addEventListener("click", () => openInline(pkg, stats));
      }
      list.append(item);
    }

    for (const stats of chapters) {
      const known = book.chapters.some((chapter) => {
        const pkg = packages.get(`${chapter.number}:${chapter.version}`);
        return pkg && pkg.chapterId === stats.chapterId && pkg.chapterVersion === stats.chapterVersion &&
          pkg.packageFingerprint === stats.packageFingerprint;
      });
      if (known || stats.commentCount === 0) continue;
      const item = document.createElement("li");
      item.className = "feedback-chapter-item";
      item.innerHTML =
        `<div><strong></strong><p class="muted"></p></div><button type="button" class="primary-button view-feedback">View Feedback</button>`;
      item.querySelector("strong").textContent = `${chapterLabel(stats.chapterId)} · historical draft`;
      item.querySelector(".muted").textContent =
        `${stats.readerCount} readers · ${stats.commentCount} comments · ${stats.locationCount} locations · v${stats.chapterVersion}`;
      item.querySelector(".view-feedback").addEventListener("click", () => openInlineFromStats(stats));
      list.append(item);
    }
  }

  async function refreshOverview() {
    overview = await MaxQuillReaderFeedbackApi.chapterOverview(book.id);
    renderOverview();
  }

  async function openInlineFromStats(stats) {
    try {
      const response = await fetch(packagePath(book.id, Number(stats.chapterId.replace(/\D/g, "")), stats.chapterVersion));
      if (!response.ok) throw new Error("Historical package is not available in content.");
      const pkg = await MaxQuillReviewApi.packageIdentity(await response.json());
      if (pkg.packageFingerprint !== stats.packageFingerprint) {
        throw new Error("Published package fingerprint does not match stored feedback.");
      }
      await openInline(pkg, stats);
    } catch (error) {
      alert(error.message || "Could not open feedback.");
    }
  }

  async function openInline(pkg, stats) {
    activeView = { pkg, stats };
    document.querySelector("#inline-section").hidden = false;
    document.querySelector("#inline-chapter-eyebrow").textContent = `Chapter ${pkg.chapterNumber}`;
    document.querySelector("#inline-chapter-title").textContent = pkg.title;
    document.querySelector("#inline-heading").textContent = `${chapterLabel(pkg.chapterId)} feedback`;
    document.querySelector("#inline-section").scrollIntoView({ behavior: "smooth", block: "start" });
    await loadInlineComments();
  }

  async function loadInlineComments() {
    if (!activeView) return;
    const reviewerId = document.querySelector("#reader-filter").value || undefined;
    const status = document.querySelector("#status-filter").value || undefined;
    activeComments = await MaxQuillReaderFeedbackApi.chapterComments({
      bookId: book.id,
      chapterId: activeView.pkg.chapterId,
      chapterVersion: activeView.pkg.chapterVersion,
      packageFingerprint: activeView.pkg.packageFingerprint,
      reviewerId,
      status
    });
    const filter = document.querySelector("#reader-filter");
    const previous = filter.value;
    filter.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All readers";
    filter.append(all);
    for (const reader of activeComments.readers || []) {
      const option = document.createElement("option");
      option.value = reader.reviewerId;
      option.textContent = reader.displayName;
      filter.append(option);
    }
    if ([...filter.options].some((option) => option.value === previous)) filter.value = previous;
    document.querySelector("#inline-chapter-meta").textContent =
      `${activeComments.readerCount} readers · ${activeComments.commentCount} comments · Version ${activeView.pkg.chapterVersion}`;
    renderInlineChapter();
  }

  function renderInlineChapter() {
    const body = document.querySelector("#inline-chapter-body");
    const pkg = activeView.pkg;
    const groups = MaxQuillReaderFeedbackApi.groupCommentsByLocation(activeComments.comments);
    const byParagraph = new Map();
    for (const group of groups) {
      if (!byParagraph.has(group.paragraphId)) byParagraph.set(group.paragraphId, []);
      byParagraph.get(group.paragraphId).push(group);
    }
    body.replaceChildren();
    for (const item of pkg.content) {
      const paragraph = document.createElement("p");
      paragraph.id = `feedback-paragraph-${item.id}`;
      paragraph.dataset.paragraphId = item.id;
      const groupsHere = byParagraph.get(item.id) || [];
      if (groupsHere.length) appendInlineHighlights(paragraph, item, groupsHere);
      else paragraph.textContent = item.text;
      body.append(paragraph);
      for (const group of groupsHere) body.append(renderGroupCard(group));
    }
  }

  function appendInlineHighlights(paragraph, item, groups) {
    const marks = groups
      .map((group) => ({
        selectionStart: group.selectionStart,
        selectionEnd: group.selectionEnd,
        key: group.key,
        count: group.comments.length
      }))
      .sort((a, b) => a.selectionStart - b.selectionStart)
      .filter((note, index, all) => !all[index - 1] || note.selectionStart >= all[index - 1].selectionEnd);
    let cursor = 0;
    for (const note of marks) {
      paragraph.append(document.createTextNode(item.text.slice(cursor, note.selectionStart)));
      const mark = document.createElement("mark");
      mark.className = "annotation-highlight reader-feedback-mark";
      mark.textContent = item.text.slice(note.selectionStart, note.selectionEnd);
      mark.setAttribute("aria-label", `${note.count} reader comments`);
      paragraph.append(mark);
      cursor = note.selectionEnd;
    }
    paragraph.append(document.createTextNode(item.text.slice(cursor)));
  }

  function renderGroupCard(group) {
    const card = document.createElement("aside");
    card.className = "reader-feedback-card";
    card.dataset.locationKey = group.key;
    const openCount = group.comments.filter((item) => item.status === "open").length;
    card.innerHTML =
      `<header><span class="eyebrow">Reader feedback · ${group.comments.length}</span><q></q></header><ul class="reader-feedback-list"></ul>`;
    card.querySelector("q").textContent = group.selectedText;
    const list = card.querySelector(".reader-feedback-list");
    for (const comment of group.comments) {
      const item = document.createElement("li");
      item.className = comment.status === "resolved" ? "is-resolved" : "";
      item.innerHTML =
        `<div class="reader-feedback-meta"><strong></strong><span></span></div><blockquote></blockquote><div class="reader-feedback-actions"></div>`;
      item.querySelector("strong").textContent = comment.reviewerDisplayName;
      item.querySelector("span").textContent =
        `${comment.category || "General"}${comment.status === "resolved" ? " · resolved" : openCount ? "" : ""}`;
      item.querySelector("blockquote").textContent = comment.commentText;
      if (comment.status !== "resolved") {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Resolve";
        button.addEventListener("click", async () => {
          try {
            await MaxQuillReaderFeedbackApi.resolveComment(comment.commentId);
            await loadInlineComments();
            await refreshOverview();
          } catch (error) {
            alert(error.message || "Could not resolve comment.");
          }
        });
        item.querySelector(".reader-feedback-actions").append(button);
      }
      list.append(item);
    }
    return card;
  }

  async function init() {
    try {
      const response = await fetch(BOOK_URL);
      if (!response.ok) throw new Error(`Book returned ${response.status}`);
      book = await response.json();
      document.title = `${book.title} · Reader Feedback | MaxQuill`;
      document.querySelector("#book-heading").textContent = book.title;
      await fillChapterSelect();
      document.querySelector("#invite-form").addEventListener("submit", createInvite);
      document.querySelector("#close-inline").addEventListener("click", () => {
        document.querySelector("#inline-section").hidden = true;
        activeView = null;
      });
      document.querySelector("#reader-filter").addEventListener("change", loadInlineComments);
      document.querySelector("#status-filter").addEventListener("change", loadInlineComments);
      await refreshOverview();
    } catch (error) {
      console.error(error);
      document.querySelector("#owner-feedback-root").innerHTML =
        `<p class="error-message">${error.message || "Owner feedback could not be loaded."}</p>`;
    }
  }

  init();
})();
