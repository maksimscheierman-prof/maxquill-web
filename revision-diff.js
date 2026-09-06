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
    const usedBefore = new Set();
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
        usedBefore.add(beforeIndex);
        ops.push({ kind: "changed", beforeIndex, afterIndex: afterIndexes[best] });
      }
    }
    const remainingBefore = beforeIndexes.filter((index) => !usedBefore.has(index));
    const remainingAfter = afterIndexes.filter((_, position) => !usedAfter.has(position));
    const rewriteCount = Math.min(remainingBefore.length, remainingAfter.length);
    for (let index = 0; index < rewriteCount; index += 1) {
      ops.push({ kind: "changed", beforeIndex: remainingBefore[index], afterIndex: remainingAfter[index] });
    }
    for (let index = rewriteCount; index < remainingBefore.length; index += 1) {
      ops.push({ kind: "removed", beforeIndex: remainingBefore[index], afterIndex: null });
    }
    for (let index = rewriteCount; index < remainingAfter.length; index += 1) {
      ops.push({ kind: "inserted", beforeIndex: null, afterIndex: remainingAfter[index] });
    }
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

  const OWNER_CLUSTER_MAX_SPAN = 10;
  const ADDITIONAL_CLUSTER_GAP = 2;

  function changeIndexes(change) {
    return {
      before: Number.isInteger(change.before?.index) ? change.before.index : null,
      after: Number.isInteger(change.after?.index) ? change.after.index : null
    };
  }

  function clusterBounds(changeList) {
    let minBefore = Infinity, maxBefore = -Infinity, minAfter = Infinity, maxAfter = -Infinity;
    for (const change of changeList) {
      const indexes = changeIndexes(change);
      if (indexes.before != null) { minBefore = Math.min(minBefore, indexes.before); maxBefore = Math.max(maxBefore, indexes.before); }
      if (indexes.after != null) { minAfter = Math.min(minAfter, indexes.after); maxAfter = Math.max(maxAfter, indexes.after); }
    }
    return {
      minBefore: Number.isFinite(minBefore) ? minBefore : null,
      maxBefore: Number.isFinite(maxBefore) ? maxBefore : null,
      minAfter: Number.isFinite(minAfter) ? minAfter : null,
      maxAfter: Number.isFinite(maxAfter) ? maxAfter : null
    };
  }

  function changeTouchesBounds(change, bounds, pad = 1) {
    const indexes = changeIndexes(change);
    if (bounds.minBefore != null && indexes.before != null) {
      if (indexes.before >= bounds.minBefore - pad && indexes.before <= bounds.maxBefore + pad) return true;
    }
    if (bounds.minAfter != null && indexes.after != null) {
      if (indexes.after >= bounds.minAfter - pad && indexes.after <= bounds.maxAfter + pad) return true;
    }
    return false;
  }

  function spanTooLarge(bounds) {
    const beforeSpan = bounds.minBefore != null ? bounds.maxBefore - bounds.minBefore : 0;
    const afterSpan = bounds.minAfter != null ? bounds.maxAfter - bounds.minAfter : 0;
    return beforeSpan > OWNER_CLUSTER_MAX_SPAN || afterSpan > OWNER_CLUSTER_MAX_SPAN;
  }

  function seedsForAnnotation(annotation, changes, before) {
    const seeds = [];
    const quote = normalizeText(annotation.selectedText || annotation.quote || "");
    const anchorIndex = before.findIndex((paragraph) => paragraph.id === annotation.paragraphId);
    for (const change of changes) {
      if (change.before?.id && change.before.id === annotation.paragraphId) { seeds.push(change); continue; }
      if (quote && change.before?.text && normalizeText(change.before.text).includes(quote)) { seeds.push(change); continue; }
      if (anchorIndex >= 0 && change.before?.index === anchorIndex) seeds.push(change);
    }
    if (seeds.length || anchorIndex < 0) return [...new Set(seeds)];
    return [];
  }

  function preferSeedOwner(change, annotationIds, notes, before) {
    if (annotationIds.length === 1) return annotationIds[0];
    const byParagraph = annotationIds.find((id) => {
      const note = notes.find((item) => item.id === id);
      return note?.paragraphId && change.before?.id === note.paragraphId;
    });
    if (byParagraph) return byParagraph;
    const ranked = [...annotationIds].sort((leftId, rightId) => {
      const left = notes.find((item) => item.id === leftId);
      const right = notes.find((item) => item.id === rightId);
      const leftIndex = before.findIndex((paragraph) => paragraph.id === left?.paragraphId);
      const rightIndex = before.findIndex((paragraph) => paragraph.id === right?.paragraphId);
      const changeIndex = change.before?.index ?? change.after?.index ?? 0;
      return Math.abs(leftIndex - changeIndex) - Math.abs(rightIndex - changeIndex);
    });
    return ranked[0];
  }

  function pathClear(from, to, stableIndexes) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return true;
    const start = Math.min(from, to), end = Math.max(from, to);
    for (let index = start + 1; index < end; index += 1) if (stableIndexes.has(index)) return false;
    return true;
  }

  function changeReachableWithoutStableGap(change, bounds, stableBefore, stableAfter) {
    const indexes = changeIndexes(change);
    if (indexes.before == null && indexes.after == null) return false;
    if (bounds.minBefore == null && bounds.minAfter == null) return true;
    if (indexes.before != null && bounds.minBefore != null) {
      if (indexes.before >= bounds.minBefore - 1 && indexes.before <= bounds.maxBefore + 1 && pathClear(indexes.before < bounds.minBefore ? bounds.minBefore : bounds.maxBefore, indexes.before, stableBefore)) return true;
    }
    if (indexes.after != null && bounds.minAfter != null) {
      if (indexes.after >= bounds.minAfter - 1 && indexes.after <= bounds.maxAfter + 1 && pathClear(indexes.after < bounds.minAfter ? bounds.minAfter : bounds.maxAfter, indexes.after, stableAfter)) return true;
    }
    return false;
  }

  function expandOwnerCluster(seedChanges, allChanges, claimed, foreignSeedIds, stableBefore = new Set(), stableAfter = new Set()) {
    const cluster = [...seedChanges];
    const clusterIds = new Set(cluster.map((change) => change.id));
    let grew = true;
    while (grew) {
      grew = false;
      const bounds = clusterBounds(cluster);
      if (spanTooLarge(bounds)) break;
      for (const change of allChanges) {
        if (clusterIds.has(change.id) || claimed.has(change.id)) continue;
        if (foreignSeedIds.has(change.id)) continue;
        if (!changeTouchesBounds(change, bounds, 1)) continue;
        if (!changeReachableWithoutStableGap(change, bounds, stableBefore, stableAfter)) continue;
        const next = [...cluster, change];
        if (spanTooLarge(clusterBounds(next))) continue;
        cluster.push(change);
        clusterIds.add(change.id);
        grew = true;
      }
    }
    return cluster.sort((left, right) => left.displayIndex - right.displayIndex || (left.before?.index ?? -1) - (right.before?.index ?? -1));
  }

  function contextPadForIndexes(content, indexes) {
    if (!indexes.length) return 1;
    const shortCount = indexes.filter((index) => (content[index]?.text || "").length < 90).length;
    return shortCount >= Math.ceil(indexes.length / 2) ? 2 : 1;
  }

  function collectBlockIndexes(content, touchedIndexes) {
    const sorted = [...new Set(touchedIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < content.length))].sort((a, b) => a - b);
    if (!sorted.length) return [];
    const pad = contextPadForIndexes(content, sorted);
    const start = Math.max(0, sorted[0] - pad);
    const end = Math.min(content.length - 1, sorted[sorted.length - 1] + pad);
    const indexes = [];
    for (let index = start; index <= end; index += 1) indexes.push(index);
    return indexes;
  }

  function buildPassageList(content, indexes, touched, roleForIndex) {
    return indexes.map((index) => {
      const paragraph = content[index];
      const changed = touched.has(index);
      return {
        id: paragraph.id,
        text: paragraph.text,
        index,
        role: changed ? roleForIndex(index) : "context",
        changed
      };
    });
  }

  function joinPassages(passages) {
    return passages.map((passage) => passage.text).join("\n\n");
  }

  function dominantKind(hunks) {
    const kinds = new Set(hunks.map((hunk) => hunk.kind));
    if (kinds.size === 1) return hunks[0].kind;
    if (kinds.has("changed") || (kinds.has("removed") && kinds.has("inserted"))) return "changed";
    if (kinds.has("inserted")) return "inserted";
    if (kinds.has("removed")) return "removed";
    return "changed";
  }

  function makeGroupedChange({ id, origin, ownerReviews, hunks, beforeContent, afterContent, sourceOwnerNoteId = null }) {
    const beforeTouched = new Set();
    const afterTouched = new Set();
    const beforeRoles = new Map();
    const afterRoles = new Map();
    for (const hunk of hunks) {
      if (Number.isInteger(hunk.before?.index)) {
        beforeTouched.add(hunk.before.index);
        const role = Number.isInteger(hunk.after?.index) || hunk.kind === "changed" || hunk.kind === "moved" ? "changed" : "removed";
        const existing = beforeRoles.get(hunk.before.index);
        if (existing !== "changed") beforeRoles.set(hunk.before.index, role);
      }
      if (Number.isInteger(hunk.after?.index)) {
        afterTouched.add(hunk.after.index);
        const role = Number.isInteger(hunk.before?.index) || hunk.kind === "changed" || hunk.kind === "moved" ? "changed" : "inserted";
        if (!afterRoles.has(hunk.after.index) || role === "changed") afterRoles.set(hunk.after.index, role);
      }
    }
    const beforeIndexes = collectBlockIndexes(beforeContent, [...beforeTouched]);
    const afterIndexes = collectBlockIndexes(afterContent, [...afterTouched]);
    const beforePassages = buildPassageList(beforeContent, beforeIndexes, beforeTouched, (index) => beforeRoles.get(index) || "removed");
    const afterPassages = buildPassageList(afterContent, afterIndexes, afterTouched, (index) => afterRoles.get(index) || "inserted");
    const beforeText = joinPassages(beforePassages);
    const afterText = joinPassages(afterPassages);
    const firstBefore = beforePassages.find((passage) => passage.changed) || beforePassages[0] || null;
    const firstAfter = afterPassages.find((passage) => passage.changed) || afterPassages[0] || null;
    const change = {
      id,
      kind: dominantKind(hunks),
      origin,
      ownerReviews: ownerReviews || [],
      sourceOwnerNoteId,
      hunks: hunks.map((hunk) => ({ id: hunk.id, kind: hunk.kind, before: hunk.before, after: hunk.after })),
      memberIds: hunks.map((hunk) => hunk.id),
      before: beforePassages.length ? { id: firstBefore?.id || null, text: beforeText, index: beforeIndexes[0] ?? null, passages: beforePassages } : null,
      after: afterPassages.length ? { id: firstAfter?.id || null, text: afterText, index: afterIndexes[0] ?? null, passages: afterPassages } : null,
      beforeContext: null,
      afterContext: null,
      inline: hunks.length === 1 && hunks[0].inline ? hunks[0].inline : null,
      accepted: false,
      displayIndex: Math.min(...hunks.map((hunk) => hunk.displayIndex))
    };
    return change;
  }

  function groupAdditionalChanges(changes, beforeContent, afterContent) {
    if (!changes.length) return [];
    const sorted = [...changes].sort((left, right) => left.displayIndex - right.displayIndex || (left.before?.index ?? -1) - (right.before?.index ?? -1));
    const groups = [];
    let current = [sorted[0]];
    for (let index = 1; index < sorted.length; index += 1) {
      const prev = current[current.length - 1];
      const next = sorted[index];
      const prevBounds = clusterBounds(current);
      const nextIndexes = changeIndexes(next);
      const nearBefore = prevBounds.maxBefore != null && nextIndexes.before != null && nextIndexes.before - prevBounds.maxBefore <= ADDITIONAL_CLUSTER_GAP;
      const nearAfter = prevBounds.maxAfter != null && nextIndexes.after != null && nextIndexes.after - prevBounds.maxAfter <= ADDITIONAL_CLUSTER_GAP;
      const nearDisplay = next.displayIndex - prev.displayIndex <= ADDITIONAL_CLUSTER_GAP;
      if (nearBefore || nearAfter || nearDisplay) current.push(next);
      else { groups.push(current); current = [next]; }
    }
    groups.push(current);
    return groups.map((hunks) => makeGroupedChange({
      id: hunks.length === 1 ? hunks[0].id : `additional:${hunks.map((hunk) => hunk.id).join("+")}`,
      origin: "additional_revision",
      ownerReviews: [],
      hunks,
      beforeContent,
      afterContent
    }));
  }

  function linkOwnerReviewToChanges(changes, annotations, beforeContent, afterContent) {
    const before = Array.isArray(beforeContent) ? beforeContent : [];
    const after = Array.isArray(afterContent) ? afterContent : [];
    const notes = Array.isArray(annotations) ? annotations.filter((note) => note && note.target !== "chapter_title") : [];
    const unchangedBefore = new Set();
    const unchangedAfterByBeforeId = new Map();
    const exactPairs = longestCommonSubsequence(before, after, (left, right) => normalizeText(left.text) === normalizeText(right.text));
    for (const [beforeIndex, afterIndex] of exactPairs) {
      unchangedBefore.add(before[beforeIndex].id);
      unchangedAfterByBeforeId.set(before[beforeIndex].id, after[afterIndex]);
    }

    const exactBeforeIndexes = new Set(exactPairs.map((pair) => pair[0]));
    const exactAfterIndexes = new Set(exactPairs.map((pair) => pair[1]));
    const notesByPosition = [...notes].sort((left, right) => {
      const leftIndex = before.findIndex((paragraph) => paragraph.id === left.paragraphId);
      const rightIndex = before.findIndex((paragraph) => paragraph.id === right.paragraphId);
      return (leftIndex < 0 ? Infinity : leftIndex) - (rightIndex < 0 ? Infinity : rightIndex);
    });

    const seedsByNote = new Map();
    const claimantsByChange = new Map();
    for (const annotation of notesByPosition) {
      const seeds = seedsForAnnotation(annotation, changes, before);
      seedsByNote.set(annotation.id, seeds);
      for (const change of seeds) {
        if (!claimantsByChange.has(change.id)) claimantsByChange.set(change.id, []);
        claimantsByChange.get(change.id).push(annotation.id);
      }
    }

    const exclusiveSeedsByNote = new Map(notesByPosition.map((note) => [note.id, []]));
    const allSeededChangeIds = new Set();
    for (const [changeId, annotationIds] of claimantsByChange) {
      allSeededChangeIds.add(changeId);
      const ownerId = preferSeedOwner(changes.find((change) => change.id === changeId), annotationIds, notesByPosition, before);
      const change = changes.find((item) => item.id === changeId);
      if (change && exclusiveSeedsByNote.has(ownerId)) exclusiveSeedsByNote.get(ownerId).push(change);
    }

    const claimed = new Set();
    const ownerCards = [];
    const unmatchedReviewItems = [];

    for (const annotation of notesByPosition) {
      const seeds = exclusiveSeedsByNote.get(annotation.id) || [];
      if (!seeds.length) {
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
        continue;
      }
      const foreignSeedIds = new Set([...allSeededChangeIds].filter((changeId) => !seeds.some((seed) => seed.id === changeId)));
      const cluster = expandOwnerCluster(seeds, changes, claimed, foreignSeedIds, exactBeforeIndexes, exactAfterIndexes);
      for (const change of cluster) claimed.add(change.id);
      ownerCards.push(makeGroupedChange({
        id: `owner:${annotation.id}`,
        origin: "owner_requested",
        ownerReviews: [annotation],
        sourceOwnerNoteId: annotation.id,
        hunks: cluster,
        beforeContent: before,
        afterContent: after
      }));
    }

    const leftover = changes.filter((change) => !claimed.has(change.id));
    const additionalCards = groupAdditionalChanges(leftover, before, after);
    const grouped = [...ownerCards, ...additionalCards].sort((left, right) => left.displayIndex - right.displayIndex || String(left.id).localeCompare(String(right.id)));
    return { changes: grouped, unmatchedReviewItems };
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
