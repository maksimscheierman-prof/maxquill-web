(function (root, factory) {
  const contract = factory();
  if (typeof module === "object" && module.exports) module.exports = contract;
  else root.MaxQuillCompanionContract = contract;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MANIFEST_FIELDS = ["schemaVersion", "type", "bookId", "enabled", "checkpoints"];
  const CHECKPOINT_FIELDS = ["checkpointId", "ordinal", "chapterId", "sceneId", "projection"];
  const PROJECTION_FIELDS = ["current", "chapters", "locations", "maps", "characters", "assets"];
  const CURRENT_FIELDS = ["chapterId", "sceneId", "povCharacterId", "locationId", "mapId"];
  const CHAPTER_FIELDS = ["chapterId", "scenes"];
  const SCENE_FIELDS = ["sceneId", "povCharacterId", "locationId", "mapId"];
  const LOCATION_FIELDS = ["locationId", "readerSafeName", "parentLocationId", "mapId", "markerAnchor", "discovered"];
  const MAP_FIELDS = ["mapId", "visualAssetId", "hierarchyLevel", "parentMapId"];
  const CHARACTER_FIELDS = ["characterId", "introduced", "galleryUnlocked", "readerSafeProfile", "visualStateId", "portraitAssetId"];
  const PROFILE_FIELDS = ["name", "shortDescription", "affiliation"];
  const ASSET_FIELDS = ["assetId", "type", "reference", "altText"];
  const ASSET_TYPES = ["map", "portrait", "other"];
  const SUPPORTED_SCHEMA_VERSION = 1;
  const ID = {
    project: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    chapter: /^CH-\d{4,}$/,
    character: /^CHAR-\d{3,}$/,
    location: /^LOC-\d{3,}$/,
    scene: /^SCENE-\d{4,}$/,
    map: /^MAP-\d{3,}$/,
    asset: /^VASSET-\d{3,}$/,
    visualState: /^VSTATE-\d{3,}$/,
    checkpoint: /^CP-\d{4,}$/
  };

  function exactFields(value, allowed, label, errors) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    Object.keys(value).filter((key) => !allowed.includes(key)).forEach((key) => errors.push(`${label} contains unknown field "${key}".`));
    allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key)).forEach((key) => errors.push(`${label} is missing field "${key}".`));
  }

  function optionalId(value, pattern, label, errors) {
    if (value !== null && (typeof value !== "string" || !pattern.test(value))) errors.push(`${label} is invalid.`);
  }

  function result(errors) { return { valid: errors.length === 0, errors }; }

  function leak(value, errors, path) {
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, child]) => {
      if (/(author[_-]?only|production|secret|reveal_rules|visual_bible|generation)/i.test(key)) errors.push(`${path}.${key} is not reader-safe.`);
      leak(child, errors, `${path}.${key}`);
    });
  }

  function validateVisualCompanionManifest(manifest) {
    const errors = [];
    exactFields(manifest, MANIFEST_FIELDS, "VISUAL_COMPANION_MANIFEST", errors);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return result(errors);
    leak(manifest, errors, "manifest");
    if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) errors.push("Unsupported VISUAL_COMPANION_MANIFEST schemaVersion; expected 1.");
    if (manifest.type !== "visual_companion_manifest") errors.push('type must be "visual_companion_manifest".');
    if (typeof manifest.bookId !== "string" || !ID.project.test(manifest.bookId)) errors.push("bookId must be lowercase kebab-case.");
    if (typeof manifest.enabled !== "boolean") errors.push("enabled must be Boolean.");
    if (!Array.isArray(manifest.checkpoints)) errors.push("checkpoints must be an array.");
    else if (manifest.enabled === false && manifest.checkpoints.length) errors.push("disabled companion manifests must not include checkpoints.");
    else if (manifest.enabled) {
      const ids = new Set();
      let previous = 0;
      manifest.checkpoints.forEach((checkpoint, index) => {
        exactFields(checkpoint, CHECKPOINT_FIELDS, `checkpoints[${index}]`, errors);
        if (!checkpoint || typeof checkpoint !== "object") return;
        if (typeof checkpoint.checkpointId !== "string" || !ID.checkpoint.test(checkpoint.checkpointId)) errors.push(`checkpoints[${index}].checkpointId is invalid.`);
        else if (ids.has(checkpoint.checkpointId)) errors.push(`checkpointId "${checkpoint.checkpointId}" is duplicated.`);
        else ids.add(checkpoint.checkpointId);
        if (!Number.isInteger(checkpoint.ordinal) || checkpoint.ordinal <= previous) errors.push(`checkpoints[${index}].ordinal must increase.`);
        else previous = checkpoint.ordinal;
        if (typeof checkpoint.chapterId !== "string" || !ID.chapter.test(checkpoint.chapterId)) errors.push(`checkpoints[${index}].chapterId is invalid.`);
        optionalId(checkpoint.sceneId, ID.scene, `checkpoints[${index}].sceneId`, errors);
        validateProjection(checkpoint.projection, `checkpoints[${index}].projection`, errors);
      });
    }
    return result(errors);
  }

  function validateProjection(value, label, errors) {
    exactFields(value, PROJECTION_FIELDS, label, errors);
    if (!value || typeof value !== "object") return;
    exactFields(value.current, CURRENT_FIELDS, `${label}.current`, errors);
    if (value.current) {
      optionalId(value.current.chapterId, ID.chapter, `${label}.current.chapterId`, errors);
      optionalId(value.current.sceneId, ID.scene, `${label}.current.sceneId`, errors);
      optionalId(value.current.povCharacterId, ID.character, `${label}.current.povCharacterId`, errors);
      optionalId(value.current.locationId, ID.location, `${label}.current.locationId`, errors);
      optionalId(value.current.mapId, ID.map, `${label}.current.mapId`, errors);
    }
    if (!Array.isArray(value.chapters) || !Array.isArray(value.locations) || !Array.isArray(value.maps) || !Array.isArray(value.characters) || !Array.isArray(value.assets)) {
      errors.push(`${label} collections must be arrays.`);
      return;
    }
    value.chapters.forEach((chapter, index) => {
      exactFields(chapter, CHAPTER_FIELDS, `${label}.chapters[${index}]`, errors);
      if (typeof chapter?.chapterId !== "string" || !ID.chapter.test(chapter.chapterId)) errors.push(`${label}.chapters[${index}].chapterId is invalid.`);
      (chapter?.scenes || []).forEach((scene, sceneIndex) => {
        exactFields(scene, SCENE_FIELDS, `${label}.chapters[${index}].scenes[${sceneIndex}]`, errors);
        if (typeof scene?.sceneId !== "string" || !ID.scene.test(scene.sceneId)) errors.push(`${label}.scenes[${sceneIndex}].sceneId is invalid.`);
        optionalId(scene?.povCharacterId, ID.character, `${label}.scenes[${sceneIndex}].povCharacterId`, errors);
        optionalId(scene?.locationId, ID.location, `${label}.scenes[${sceneIndex}].locationId`, errors);
        optionalId(scene?.mapId, ID.map, `${label}.scenes[${sceneIndex}].mapId`, errors);
      });
    });
    value.locations.forEach((location, index) => {
      exactFields(location, LOCATION_FIELDS, `${label}.locations[${index}]`, errors);
      if (typeof location?.locationId !== "string" || !ID.location.test(location.locationId)) errors.push(`${label}.locations[${index}].locationId is invalid.`);
      if (location?.readerSafeName !== null && (typeof location?.readerSafeName !== "string" || !location.readerSafeName.trim())) errors.push(`${label}.locations[${index}].readerSafeName is invalid.`);
      optionalId(location?.parentLocationId, ID.location, `${label}.locations[${index}].parentLocationId`, errors);
      optionalId(location?.mapId, ID.map, `${label}.locations[${index}].mapId`, errors);
      if (location?.discovered !== true) errors.push(`${label}.locations[${index}].discovered must be true.`);
    });
    value.maps.forEach((map, index) => {
      exactFields(map, MAP_FIELDS, `${label}.maps[${index}]`, errors);
      if (typeof map?.mapId !== "string" || !ID.map.test(map.mapId)) errors.push(`${label}.maps[${index}].mapId is invalid.`);
      optionalId(map?.visualAssetId, ID.asset, `${label}.maps[${index}].visualAssetId`, errors);
      if (typeof map?.hierarchyLevel !== "string" || !map.hierarchyLevel.trim()) errors.push(`${label}.maps[${index}].hierarchyLevel is invalid.`);
      optionalId(map?.parentMapId, ID.map, `${label}.maps[${index}].parentMapId`, errors);
    });
    value.characters.forEach((character, index) => {
      exactFields(character, CHARACTER_FIELDS, `${label}.characters[${index}]`, errors);
      if (typeof character?.characterId !== "string" || !ID.character.test(character.characterId)) errors.push(`${label}.characters[${index}].characterId is invalid.`);
      if (character?.introduced !== true) errors.push(`${label}.characters[${index}].introduced must be true.`);
      if (typeof character?.galleryUnlocked !== "boolean") errors.push(`${label}.characters[${index}].galleryUnlocked must be Boolean.`);
      if (character?.readerSafeProfile !== null) {
        exactFields(character.readerSafeProfile, PROFILE_FIELDS, `${label}.characters[${index}].readerSafeProfile`, errors);
        if (typeof character?.readerSafeProfile?.name !== "string" || !character.readerSafeProfile.name.trim()) errors.push(`${label}.characters[${index}].readerSafeProfile.name is invalid.`);
      }
      optionalId(character?.visualStateId, ID.visualState, `${label}.characters[${index}].visualStateId`, errors);
      optionalId(character?.portraitAssetId, ID.asset, `${label}.characters[${index}].portraitAssetId`, errors);
      if (character && character.galleryUnlocked === false && (character.visualStateId !== null || character.portraitAssetId !== null)) {
        errors.push(`${label}.characters[${index}] must omit portrait assets while the gallery is locked.`);
      }
    });
    value.assets.forEach((asset, index) => {
      exactFields(asset, ASSET_FIELDS, `${label}.assets[${index}]`, errors);
      if (typeof asset?.assetId !== "string" || !ID.asset.test(asset.assetId)) errors.push(`${label}.assets[${index}].assetId is invalid.`);
      if (!ASSET_TYPES.includes(asset?.type)) errors.push(`${label}.assets[${index}].type is invalid.`);
      if (typeof asset?.reference !== "string" || !asset.reference.trim()) errors.push(`${label}.assets[${index}].reference is invalid.`);
      if (asset?.altText !== null && (typeof asset?.altText !== "string" || !asset.altText.trim())) errors.push(`${label}.assets[${index}].altText is invalid.`);
    });
  }

  return { SUPPORTED_SCHEMA_VERSION, validateVisualCompanionManifest };
});
