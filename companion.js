(function (root, factory) {
  const api = factory(root.MaxQuillCompanionContract);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaxQuillCompanion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (contractModule) {
  "use strict";

  function contract() {
    if (typeof module === "object" && module.exports) return require("./companion-contract.js");
    return contractModule;
  }

  function emptyState(error) {
    return {
      available: false,
      checkpointId: null,
      furthestChapter: 0,
      viewedChapterId: null,
      projection: null,
      current: null,
      locations: [],
      maps: [],
      characters: [],
      assets: [],
      error: error || null
    };
  }

  function chapterNumberFrom(value) {
    if (value == null || value === "") return null;
    if (Number.isInteger(value)) return value;
    const match = String(value).match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function furthestReachedChapter(progress) {
    const read = (progress?.readChapters || []).map(chapterNumberFrom).filter((value) => Number.isInteger(value) && value > 0);
    const stored = chapterNumberFrom(progress?.furthestChapter);
    return Math.max(0, stored || 0, ...read);
  }

  function advanceFurthestChapter(progress, openedChapter, markRead = false) {
    const opened = chapterNumberFrom(openedChapter);
    const read = new Set(progress?.readChapters || []);
    if (markRead && opened) read.add(String(opened));
    const previous = Math.max(furthestReachedChapter({ ...progress, readChapters: [...read] }), 0);
    if (!opened) return previous;
    if (markRead || opened <= previous + 1) return Math.max(previous, opened);
    return previous;
  }

  function checkpointForProgress(manifest, furthestChapter) {
    if (!manifest?.enabled || !Array.isArray(manifest.checkpoints) || !manifest.checkpoints.length) return null;
    const eligible = manifest.checkpoints.filter((item) => {
      const chapter = chapterNumberFrom(item.chapterId);
      return Number.isInteger(chapter) && chapter <= furthestChapter;
    });
    return eligible.at(-1) || null;
  }

  function getCompanionState(manifest, { progress = {}, viewedChapterId = null, viewedSceneId = null } = {}) {
    if (!manifest) return emptyState();
    const validation = contract().validateVisualCompanionManifest(manifest);
    if (!validation.valid) return emptyState(validation.errors[0]);
    if (!manifest.enabled) return emptyState();
    const furthest = furthestReachedChapter(progress);
    const checkpoint = checkpointForProgress(manifest, furthest);
    if (!checkpoint) return emptyState();
    const projection = checkpoint.projection;
    const viewedNumber = chapterNumberFrom(viewedChapterId);
    const viewedChapter = Number.isInteger(viewedNumber)
      ? projection.chapters.find((item) => chapterNumberFrom(item.chapterId) === viewedNumber) || null
      : null;
    const viewedScene = viewedSceneId
      ? viewedChapter?.scenes.find((item) => item.sceneId === viewedSceneId) || null
      : viewedChapter?.scenes?.[0] || null;
    return {
      available: true,
      checkpointId: checkpoint.checkpointId,
      furthestChapter: furthest,
      viewedChapterId: viewedChapter?.chapterId || null,
      projection,
      current: viewedScene ? {
        chapterId: viewedChapter.chapterId,
        sceneId: viewedScene.sceneId,
        povCharacterId: viewedScene.povCharacterId,
        locationId: viewedScene.locationId,
        mapId: viewedScene.mapId
      } : projection.current,
      locations: projection.locations,
      maps: projection.maps,
      characters: projection.characters,
      assets: projection.assets,
      error: null
    };
  }

  async function loadCompanionManifest(url, fetchImpl = fetch) {
    try {
      const response = await fetchImpl(url);
      if (response.status === 404) return { manifest: null, available: false };
      if (!response.ok) return { manifest: null, available: false, error: `Companion manifest returned ${response.status}` };
      const manifest = await response.json();
      const validation = contract().validateVisualCompanionManifest(manifest);
      if (!validation.valid) return { manifest: null, available: false, error: validation.errors[0] };
      return { manifest, available: manifest.enabled === true };
    } catch (error) {
      return { manifest: null, available: false, error: error.message || "Companion manifest could not be loaded." };
    }
  }

  function companionUrl(bookId) {
    return `content/books/${encodeURIComponent(bookId)}/companion.json`;
  }

  return { emptyState, chapterNumberFrom, furthestReachedChapter, advanceFurthestChapter, checkpointForProgress, getCompanionState, loadCompanionManifest, companionUrl };
});
