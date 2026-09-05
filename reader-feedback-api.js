(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaxQuillReaderFeedbackApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  class ReaderFeedbackError extends Error {
    constructor(kind, message, status = 0) {
      super(message);
      this.name = "ReaderFeedbackError";
      this.kind = kind;
      this.status = status;
    }
  }

  async function responseJson(response) {
    try { return await response.json(); } catch (_) { return null; }
  }

  function errorFrom(response, data, fallback) {
    if (response.status === 401 || response.status === 403) return new ReaderFeedbackError("auth", "Authentication is required.", response.status);
    const message = typeof data?.error?.message === "string" ? data.error.message : fallback;
    return new ReaderFeedbackError("rejected", message, response.status);
  }

  async function getInvite(token, fetchImpl = root.fetch) {
    const response = await fetchImpl(`/api/invites/${encodeURIComponent(token)}`);
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Invite could not be loaded.");
    return data;
  }

  async function joinInvite(token, displayName, fetchImpl = root.fetch) {
    const response = await fetchImpl(`/api/invites/${encodeURIComponent(token)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName })
    });
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Could not join invite.");
    return data;
  }

  function sessionHeaders(sessionToken) {
    return { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` };
  }

  async function createComment(sessionToken, comment, fetchImpl = root.fetch) {
    const response = await fetchImpl("/api/reader/comments", {
      method: "POST",
      headers: sessionHeaders(sessionToken),
      body: JSON.stringify(comment)
    });
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Comment could not be saved.");
    return data;
  }

  async function listOwnComments(sessionToken, fetchImpl = root.fetch) {
    const response = await fetchImpl("/api/reader/comments", { headers: { Authorization: `Bearer ${sessionToken}` } });
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Comments could not be loaded.");
    return data.comments || [];
  }

  async function finishReview(sessionToken, fetchImpl = root.fetch) {
    const response = await fetchImpl("/api/reader/finish", { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` } });
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Review could not be finished.");
    return data;
  }

  async function createInvite(body, fetchImpl = root.fetch) {
    const response = await fetchImpl("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Invite could not be created.");
    return data;
  }

  async function chapterOverview(bookId, fetchImpl = root.fetch) {
    const response = await fetchImpl(`/api/invites/overview?bookId=${encodeURIComponent(bookId)}`);
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Overview could not be loaded.");
    return data;
  }

  async function chapterComments(query, fetchImpl = root.fetch) {
    const params = new URLSearchParams({
      bookId: query.bookId,
      chapterId: query.chapterId,
      chapterVersion: String(query.chapterVersion),
      packageFingerprint: query.packageFingerprint
    });
    if (query.reviewerId) params.set("reviewerId", query.reviewerId);
    if (query.status) params.set("status", query.status);
    const response = await fetchImpl(`/api/invites/comments?${params}`);
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Comments could not be loaded.");
    return data;
  }

  async function resolveComment(commentId, fetchImpl = root.fetch) {
    const response = await fetchImpl(`/api/reader-comments/${encodeURIComponent(commentId)}/resolve`, { method: "POST" });
    const data = await responseJson(response);
    if (!response.ok) throw errorFrom(response, data, "Comment could not be resolved.");
    return data;
  }

  function groupCommentsByLocation(comments) {
    const groups = new Map();
    for (const comment of comments || []) {
      const key = `${comment.paragraphId}:${comment.selectionStart}:${comment.selectionEnd}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          paragraphId: comment.paragraphId,
          selectionStart: comment.selectionStart,
          selectionEnd: comment.selectionEnd,
          selectedText: comment.selectedText,
          comments: []
        });
      }
      groups.get(key).comments.push(comment);
    }
    return [...groups.values()].sort((a, b) => a.paragraphId.localeCompare(b.paragraphId) || a.selectionStart - b.selectionStart);
  }

  return {
    ReaderFeedbackError, getInvite, joinInvite, createComment, listOwnComments, finishReview,
    createInvite, chapterOverview, chapterComments, resolveComment, groupCommentsByLocation
  };
});
