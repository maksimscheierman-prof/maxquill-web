"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const contract = require("../companion-contract.js");
const companion = require("../companion.js");
const reviewContract = require("../contract.js");

function current(overrides = {}) {
  return { chapterId: "CH-0001", sceneId: "SCENE-0001", povCharacterId: "CHAR-001", locationId: "LOC-001", mapId: "MAP-001", ...overrides };
}

function projection(overrides = {}) {
  return {
    current: current(),
    chapters: [{ chapterId: "CH-0001", scenes: [{ sceneId: "SCENE-0001", povCharacterId: "CHAR-001", locationId: "LOC-001", mapId: "MAP-001" }] }, { chapterId: "CH-0005", scenes: [{ sceneId: "SCENE-0005", povCharacterId: "CHAR-001", locationId: "LOC-001", mapId: "MAP-001" }] }, { chapterId: "CH-0020", scenes: [{ sceneId: "SCENE-0020", povCharacterId: "CHAR-001", locationId: "LOC-002", mapId: "MAP-002" }] }],
    locations: [{ locationId: "LOC-001", readerSafeName: "Harbor City", parentLocationId: null, mapId: "MAP-001", markerAnchor: { system: "logical", value: "docks" }, discovered: true }],
    maps: [{ mapId: "MAP-001", visualAssetId: "VASSET-001", hierarchyLevel: "city", parentMapId: null }],
    characters: [{ characterId: "CHAR-001", introduced: true, galleryUnlocked: true, readerSafeProfile: { name: "Mara", shortDescription: null, affiliation: null }, visualStateId: "VSTATE-001", portraitAssetId: "VASSET-003" }],
    assets: [{ assetId: "VASSET-001", type: "map", reference: "assets/maps/city.png", altText: "City map" }, { assetId: "VASSET-003", type: "portrait", reference: "assets/portraits/mara-early.png", altText: "Early portrait" }],
    ...overrides
  };
}

function laterProjection() {
  const value = projection();
  value.current = current({ chapterId: "CH-0020", sceneId: "SCENE-0020", locationId: "LOC-002", mapId: "MAP-002" });
  value.locations = [
    ...value.locations,
    { locationId: "LOC-002", readerSafeName: "Later District", parentLocationId: "LOC-001", mapId: "MAP-002", markerAnchor: { system: "logical", value: "gate" }, discovered: true }
  ];
  value.maps.push({ mapId: "MAP-002", visualAssetId: "VASSET-002", hierarchyLevel: "district", parentMapId: "MAP-001" });
  value.characters.push({ characterId: "CHAR-002", introduced: true, galleryUnlocked: true, readerSafeProfile: { name: "Ilan", shortDescription: null, affiliation: null }, visualStateId: "VSTATE-004", portraitAssetId: "VASSET-006" });
  value.assets.push({ assetId: "VASSET-002", type: "map", reference: "assets/maps/later.png", altText: "Later map" }, { assetId: "VASSET-006", type: "portrait", reference: "assets/portraits/ilan.png", altText: "Ilan" });
  return value;
}

function manifest() {
  return {
    schemaVersion: 1,
    type: "visual_companion_manifest",
    bookId: "demo-book",
    enabled: true,
    checkpoints: [
      { checkpointId: "CP-0001", ordinal: 1, chapterId: "CH-0001", sceneId: "SCENE-0001", projection: projection() },
      { checkpointId: "CP-0002", ordinal: 2, chapterId: "CH-0005", sceneId: "SCENE-0005", projection: projection({ current: current({ chapterId: "CH-0005", sceneId: "SCENE-0005" }) }) },
      { checkpointId: "CP-0003", ordinal: 3, chapterId: "CH-0020", sceneId: "SCENE-0020", projection: laterProjection() }
    ]
  };
}

test("valid companion manifest and disabled empty package pass", () => {
  assert.equal(contract.validateVisualCompanionManifest(manifest()).valid, true);
  assert.equal(contract.validateVisualCompanionManifest({ schemaVersion: 1, type: "visual_companion_manifest", bookId: "demo-book", enabled: false, checkpoints: [] }).valid, true);
});

test("unknown schema versions and author-only leaks are rejected", () => {
  const future = manifest(); future.schemaVersion = 2;
  assert.equal(contract.validateVisualCompanionManifest(future).valid, false);
  const leak = manifest(); leak.authorOnly = true;
  assert.equal(contract.validateVisualCompanionManifest(leak).valid, false);
  const lockedPortrait = manifest();
  lockedPortrait.checkpoints[0].projection.characters[0].galleryUnlocked = false;
  assert.equal(contract.validateVisualCompanionManifest(lockedPortrait).valid, false);
});

test("missing companion and disabled books leave the reader unchanged", () => {
  assert.equal(companion.getCompanionState(null).available, false);
  assert.equal(companion.getCompanionState({ schemaVersion: 1, type: "visual_companion_manifest", bookId: "demo-book", enabled: false, checkpoints: [] }).available, false);
});

test("reader at chapter 20 keeps unlocks while viewing chapter 5", () => {
  const progress = { furthestChapter: 20, readChapters: ["1", "5", "20"], currentChapter: "5" };
  const state = companion.getCompanionState(manifest(), { progress, viewedChapterId: "chapter_0005", viewedSceneId: "SCENE-0005" });
  assert.equal(state.available, true);
  assert.equal(state.checkpointId, "CP-0003");
  assert.equal(state.furthestChapter, 20);
  assert.equal(state.current.chapterId, "CH-0005");
  assert.equal(state.current.locationId, "LOC-001");
  assert.equal(state.locations.some((item) => item.locationId === "LOC-002"), true);
  assert.equal(state.characters.some((item) => item.characterId === "CHAR-002"), true);
});

test("a new reader in chapter 5 cannot see chapter 20 visuals", () => {
  const progress = { furthestChapter: 5, readChapters: ["1", "5"], currentChapter: "5" };
  const state = companion.getCompanionState(manifest(), { progress, viewedChapterId: "CH-0005" });
  assert.equal(state.checkpointId, "CP-0002");
  assert.equal(state.locations.some((item) => item.locationId === "LOC-002"), false);
  assert.equal(state.maps.some((item) => item.mapId === "MAP-002"), false);
  assert.equal(state.characters.some((item) => item.characterId === "CHAR-002"), false);
});

test("opening a later chapter URL does not advance companion unlocks", () => {
  const progress = { furthestChapter: 1, readChapters: ["1"], currentChapter: "20" };
  assert.equal(companion.advanceFurthestChapter(progress, 20, false), 1);
  const state = companion.getCompanionState(manifest(), { progress: { ...progress, furthestChapter: companion.advanceFurthestChapter(progress, 20, false) }, viewedChapterId: "CH-0020" });
  assert.equal(state.checkpointId, "CP-0001");
  assert.equal(state.locations.some((item) => item.locationId === "LOC-002"), false);
});

test("opening an earlier chapter does not reduce furthest progress", () => {
  const progress = { furthestChapter: 20, readChapters: ["20"], currentChapter: "5" };
  assert.equal(companion.advanceFurthestChapter(progress, 5, false), 20);
});

test("404 companion files degrade to an unavailable state", async () => {
  const loaded = await companion.loadCompanionManifest("content/books/demo-book/companion.json", async () => ({ ok: false, status: 404, json: async () => ({}) }));
  assert.equal(loaded.available, false);
  assert.equal(loaded.manifest, null);
});

test("review contracts still reject companion fields", () => {
  const source = { schemaVersion: 1, type: "review_ready_chapter", bookId: "demo-book", chapterId: "chapter_0001", chapterNumber: 1, chapterVersion: 1, status: "REVIEW_READY", title: "One", exportedAt: "2026-08-28T10:00:00.000Z", content: [{ id: "p001", text: "Example paragraph." }] };
  source.companion = manifest();
  assert.equal(reviewContract.validateReviewReadyPackage(source).valid, false);
});
