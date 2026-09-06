(function (root, factory) {
  const diff = factory();
  if (typeof module === "object" && module.exports) module.exports = diff;
  else root.MaxQuillRevisionDiff = diff;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIMILARITY_THRESHOLD = 0.34;
  const CONTEXT_CHARS = 160;

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function wordTokens(text) {
    return normalizeText(text).toLowerCase().match(/[\p{L}\p{N}’']+/gu) || [];
  }

  function jaccard(a, b) {
    const left = new Set(wordTokens(a)), right = new Set(wordTokens(b));
    if (!left.size && !right.size) return 1;
    let inter = 0;
    for (const token of left) if (right.has(token)) inter += 1;
    return inter / (left.size + right.size - inter);
  }

  function similarity(a, b) {
    const left = wordTokens(a), right = wordTokens(b);
    if (!left.length && !right.length) return 1;
    const lcs = longestCommonSubsequence(left, right, (x, y) => x === y).length;
    return Math.max(jaccard(a, b), lcs / Math.max(left.length, right.length, 1));
  }

  function longestCommonSubsequence(left, right, equal) {
    const n = left.length, m = right.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] = equal(left[i - 1], right[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const pairs = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (equal(left[i - 1], right[j - 1])) { pairs.push([i - 1, j - 1]); i -= 1; j -= 1; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) i -= 1;
      else j -= 1;
    }
    return pairs.reverse();
  }

  function clip(text, max = CONTEXT_CHARS) {
    const value = normalizeText(text);
    if (!value) return null;
    return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
  }

  function contextAround(content, index) {
    return {
      previous: index > 0 ? clip(content[index - 1]?.text) : null,
      next: index >= 0 && index < content.length - 1 ? clip(content[index + 1]?.text) : null
    };
  }

  function tokenizeInline(text) {
    return String(text || "").split(/(\s+)/).filter((part) => part.length > 0);
  }

  function inlineDiff(beforeText, afterText) {
    const before = tokenizeInline(beforeText);
    const after = tokenizeInline(afterText);
    const pairs = longestCommonSubsequence(before, after, (left, right) => left === right);
    const tokens = [];
    let i = 0, j = 0;
    for (const [bi, aj] of pairs) {
      if (i < bi) tokens.push({ type: "removed", text: before.slice(i, bi).join("") });
      if (j < aj) tokens.push({ type: "inserted", text: after.slice(j, aj).join("") });
      tokens.push({ type: "equal", text: before[bi] });
      i = bi + 1; j = aj + 1;
    }
    if (i < before.length) tokens.push({ type: "removed", text: before.slice(i).join("") });
    if (j < after.length) tokens.push({ type: "inserted", text: after.slice(j).join("") });
    return tokens.filter((token) => token.text);
  }

  function changeId(change) {
    return [change.kind, change.before?.id || "-", change.after?.id || "-", String(change.before?.index ?? ""), String(change.after?.index ?? "")].join(":");
  }

  function passage(paragraph, index) {
    if (!paragraph) return null;
    return { id: paragraph.id, text: paragraph.text, index };
  }

  function uniqueExactMoves(before, after, leftoverBefore, leftoverAfter) {
    const beforeByText = new Map(), afterByText = new Map();
    for (const index of leftoverBefore) {
      const key = normalizeText(before[index].text);
      if (!beforeByText.has(key)) beforeByText.set(key, []);
      beforeByText.get(key).push(index);
    }
    for (const index of leftoverAfter) {
      const key = normalizeText(after[index].text);
      if (!afterByText.has(key)) afterByText.set(key, []);
      afterByText.get(key).push(index);
    }
    const moves = [];
    for (const [text, beforeIndexes] of beforeByText) {
      const afterIndexes = afterByText.get(text);
      if (beforeIndexes.length === 1 && afterIndexes?.length === 1) {
        moves.push({ beforeIndex: beforeIndexes[0], afterIndex: afterIndexes[0] });
      }
    }
    return moves;
  }

  function pairGap(before, after, beforeIndexes, afterIndexes) {
    const usedAfter = new Set();
    const ops = [];
    for (const beforeIndex of beforeIndexes) {
      let best = -1, bestScore = SIMILARITY_THRESHOLD;
      afterIndexes.forEach((afterIndex, position) => {
        if (usedAfter.has(position)) return;
        const score = similarity(before[beforeIndex].text, after[afterIndex].text);
        if (score > bestScore) { bestScore = score; best = position; }
      });
      if (best >= 0) {
        usedAfter.add(best);
        ops.push({ kind: "changed", beforeIndex, afterIndex: afterIndexes[best] });
      } else ops.push({ kind: "removed", beforeIndex, afterIndex: null });
    }
    afterIndexes.forEach((afterIndex, position) => {
      if (!usedAfter.has(position)) ops.push({ kind: "inserted", beforeIndex: null, afterIndex });
    });
    return ops;
  }

  function diffParagraphs(beforeContent, afterContent) {
    const before = Array.isArray(beforeContent) ? beforeContent : [];
    const after = Array.isArray(afterContent) ? afterContent : [];
    const exactPairs = longestCommonSubsequence(before, after, (left, right) => normalizeText(left.text) === normalizeText(right.text));
    const exactBefore = new Set(exactPairs.map((pair) => pair[0]));
    const exactAfter = new Set(exactPairs.map((pair) => pair[1]));
    const leftoverBefore = before.map((_, index) => index).filter((index) => !exactBefore.has(index));
    const leftoverAfter = after.map((_, index) => index).filter((index) => !exactAfter.has(index));
    const leftoverBeforeSet = new Set(leftoverBefore);
    const leftoverAfterSet = new Set(leftoverAfter);
    const moves = uniqueExactMoves(before, after, leftoverBefore, leftoverAfter);
    for (const move of moves) {
      leftoverBeforeSet.delete(move.beforeIndex);
      leftoverAfterSet.delete(move.afterIndex);
    }

    const ops = moves.map((move) => ({ kind: "moved", beforeIndex: move.beforeIndex, afterIndex: move.afterIndex }));
    const anchors = [[-1, -1], ...exactPairs, [before.length, after.length]];
    for (let i = 0; i < anchors.length - 1; i++) {
      const beforeIndexes = [];
      const afterIndexes = [];
      for (let index = anchors[i][0] + 1; index < anchors[i + 1][0]; index++) if (leftoverBeforeSet.has(index)) beforeIndexes.push(index);
      for (let index = anchors[i][1] + 1; index < anchors[i + 1][1]; index++) if (leftoverAfterSet.has(index)) afterIndexes.push(index);
      ops.push(...pairGap(before, after, beforeIndexes, afterIndexes));
    }

    return ops.map((op) => {
      const change = {
        kind: op.kind,
        before: passage(before[op.beforeIndex], op.beforeIndex),
        after: passage(after[op.afterIndex], op.afterIndex),
        beforeContext: Number.isInteger(op.beforeIndex) ? contextAround(before, op.beforeIndex) : { previous: null, next: null },
        afterContext: Number.isInteger(op.afterIndex) ? contextAround(after, op.afterIndex) : { previous: null, next: null },
        inline: op.kind === "changed" && Number.isInteger(op.beforeIndex) && Number.isInteger(op.afterIndex)
          ? inlineDiff(before[op.beforeIndex].text, after[op.afterIndex].text)
          : null,
        origin: "additional_revision",
        ownerReviews: [],
        accepted: false
      };
      change.id = changeId(change);
      change.displayIndex = change.after?.index ?? change.before?.index ?? 0;
      return change;
    }).sort((left, right) => left.displayIndex - right.displayIndex || (left.before?.index ?? -1) - (right.before?.index ?? -1));
  }

  function linkOwnerReviewToChanges(changes, annotations, beforeContent, afterContent) {
    const before = Array.isArray(beforeContent) ? beforeContent : [];
    const after = Array.isArray(afterContent) ? afterContent : [];
    const notes = Array.isArray(annotations) ? annotations : [];
    const unchangedBefore = new Set();
    const unchangedAfterByBeforeId = new Map();
    const exactPairs = longestCommonSubsequence(before, after, (left, right) => normalizeText(left.text) === normalizeText(right.text));
    for (const [beforeIndex, afterIndex] of exactPairs) {
      unchangedBefore.add(before[beforeIndex].id);
      unchangedAfterByBeforeId.set(before[beforeIndex].id, after[afterIndex]);
    }
    const byBeforeId = new Map();
    for (const change of changes) {
      if (!change.before?.id) continue;
      if (!byBeforeId.has(change.before.id)) byBeforeId.set(change.before.id, []);
      byBeforeId.get(change.before.id).push(change);
    }
    const unmatchedReviewItems = [];
    for (const annotation of notes) {
      if (annotation?.target === "chapter_title") continue;
      const linked = byBeforeId.get(annotation.paragraphId) || [];
      if (linked.length) {
        for (const change of linked) {
          change.ownerReviews.push(annotation);
          change.origin = "owner_requested";
        }
        continue;
      }
      if (unchangedBefore.has(annotation.paragraphId)) {
        const beforeParagraph = before.find((paragraph) => paragraph.id === annotation.paragraphId);
        const afterParagraph = unchangedAfterByBeforeId.get(annotation.paragraphId);
        unmatchedReviewItems.push({
          id: `unmatched:${annotation.id}`,
          kind: "unchanged",
          reason: "no_detectable_text_change",
          annotation,
          before: beforeParagraph ? { id: beforeParagraph.id, text: beforeParagraph.text, index: before.indexOf(beforeParagraph) } : null,
          after: afterParagraph ? { id: afterParagraph.id, text: afterParagraph.text, index: after.indexOf(afterParagraph) } : null
        });
      } else {
        unmatchedReviewItems.push({
          id: `unmatched:${annotation.id}`,
          kind: "unmapped",
          reason: "no_detectable_text_change",
          annotation,
          before: null,
          after: null
        });
      }
    }
    return { changes, unmatchedReviewItems };
  }

  function isChapterTitleAnnotation(note) {
    return Boolean(note && note.target === "chapter_title");
  }

  function titleNotesFrom(ownerReview) {
    return (ownerReview?.annotations || []).filter(isChapterTitleAnnotation);
  }

  function diffChapterTitle(beforePackage, afterPackage, ownerReview) {
    const beforeTitle = beforePackage?.title || "";
    const afterTitle = afterPackage?.title || "";
    const notes = titleNotesFrom(ownerReview);
    if (beforeTitle === afterTitle) {
      return {
        titleChange: null,
        unmatched: notes.map((annotation) => ({
          id: `unmatched:${annotation.id}`,
          kind: "title_unchanged",
          reason: "no_detectable_text_change",
          annotation,
          before: { id: null, text: beforeTitle, index: -1 },
          after: { id: null, text: afterTitle, index: -1 }
        }))
      };
    }
    return {
      titleChange: {
        id: "title:chapter_title",
        kind: "title",
        origin: notes.length ? "owner_requested" : "additional_revision",
        ownerReviews: notes,
        before: { id: null, text: beforeTitle, index: -1 },
        after: { id: null, text: afterTitle, index: -1 },
        beforeContext: null,
        afterContext: null,
        inline: inlineDiff(beforeTitle, afterTitle),
        displayIndex: -1
      },
      unmatched: []
    };
  }

  function buildRevisionReviewModel(beforePackage, afterPackage, ownerReview) {
    const beforeContent = beforePackage?.content || [];
    const afterContent = afterPackage?.content || [];
    const changes = diffParagraphs(beforeContent, afterContent);
    const linked = linkOwnerReviewToChanges(changes, ownerReview?.annotations, beforeContent, afterContent);
    const title = diffChapterTitle(beforePackage, afterPackage, ownerReview);
    const unmatchedReviewItems = [...title.unmatched, ...linked.unmatchedReviewItems];
    return {
      beforeVersion: beforePackage?.chapterVersion ?? null,
      afterVersion: afterPackage?.chapterVersion ?? null,
      titleChange: title.titleChange,
      changes: linked.changes,
      unmatchedReviewItems,
      summary: {
        total: linked.changes.length + (title.titleChange ? 1 : 0),
        ownerRequested: linked.changes.filter((change) => change.origin === "owner_requested").length + (title.titleChange?.origin === "owner_requested" ? 1 : 0),
        additional: linked.changes.filter((change) => change.origin === "additional_revision").length + (title.titleChange?.origin === "additional_revision" ? 1 : 0),
        unmatched: unmatchedReviewItems.length
      }
    };
  }

  return {
    SIMILARITY_THRESHOLD,
    normalizeText,
    jaccard,
    similarity,
    inlineDiff,
    diffParagraphs,
    linkOwnerReviewToChanges,
    isChapterTitleAnnotation,
    diffChapterTitle,
    buildRevisionReviewModel
  };
});
