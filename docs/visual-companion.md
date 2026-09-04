# Visual Companion Product Direction

Status: **PLANNED / NOT IMPLEMENTED**. This document defines a future optional MaxQuill reader feature; it does not add UI or change current package contracts.

## Product boundary

MaxQuill may render chapter-aware maps and an optional Character Gallery from a versioned, reader-safe companion manifest produced by a book pipeline conforming to Book Architecture. MaxQuill never treats imagery as canon, edits manuscript state, or receives an unfiltered Production Visual Bible.

The feature degrades completely:

- no companion metadata means the existing reader is unchanged;
- no map for the current chapter/checkpoint means no map control;
- no portrait permits a text-only gallery entry or no entry;
- no gallery capability means normal reading;
- older review and book packages remain accepted unchanged.

Visual Companion must not be added to the Architecture-owned Review Ready or Owner Review contracts merely for reader presentation. Its manifest, asset delivery, validation, and cache lifecycle are separate from review submission and review-queue transport.

## Reader data requirements

MaxQuill expects an already-filtered projection for a book/chapter/progress checkpoint, not raw production records. A future versioned manifest should provide only applicable fields:

- stable book, chapter, checkpoint, POV, location, map, character, asset, and visual-state IDs;
- available map levels and parent/child navigation, safe asset references, crops/layers, logical or coordinate marker anchors, optional safe waypoints, and fallback/alt text;
- only discovered locations with names, visibility, visited/access state, and descriptions allowed at that checkpoint;
- only reader-introduced character entries and unlocked portraits/visual states, with reader-known descriptions, affiliations, and first appearance where allowed;
- asset version/integrity, approval, provenance/licensing, and accessibility metadata needed for delivery.

MaxQuill must reject or hide invalid data and fail closed. It must never infer visibility from the presence of raw fields, calculate spoilers from production rules, or expose sibling states/assets that are not included in the safe projection. Server/package generation is the primary secrecy boundary; client-side conditional rendering is defense in depth.

Reader progress selects the maximum authorized checkpoint no later than the reader's current progress. Opening an older chapter must not silently advance unlock state. The concrete progress/unlock policy remains a product decision, but a reader at an early chapter can never receive or render later-chapter gallery or map truth.

## Map experience

When safe map content exists, show a small, accessible map control in the chapter header/navigation area, preferably upper-left without displacing the title. Activating it opens an overlay, modal, or companion sheet rather than navigating away.

The view shows the closest available map level, current POV marker when permitted, discovered reader-safe locations/layers, and optional navigation only among supplied zoom levels. Alternate POV chapters use the supplied POV; MaxQuill never assumes one protagonist. Coarse/unknown position uses an area marker or omits the marker rather than displaying false precision.

Mobile and tablet requirements:

- touch targets of at least the current reader control standard;
- fast open/close, Escape/backdrop/explicit-close behavior, focus trapping and restoration;
- preserve scroll and reading progress while open and restore the exact chapter position on close;
- no required page transition, accidental progress update, or chapter reload;
- pan/zoom gestures that do not trap page scrolling unexpectedly;
- responsive safe areas, orientation changes, reduced-motion support, keyboard access, labels, and nonvisual fallback text;
- clear loading/error behavior that leaves prose readable.

## Character Gallery

The Gallery is opt-in and reader-invoked through Book Companion/main navigation, a separate Gallery entry, or an optional `View Portrait` action on a known character. Portraits are never inserted automatically into prose or forced at first introduction.

An unlocked entry may show only the supplied reader-safe name, portrait, short known description, allowed affiliation, allowed first appearance, and unlocked alternative visual states. Introduction and portrait unlock are independent: a character may appear as text-only while their face remains intentionally concealed. Later age, outfit, injury, promotion, transformation, identity, allegiance, ability, relationship, or title states remain unavailable until separately supplied for the current checkpoint.

The production Visual Bible is author/production-facing and may include secrets, future designs, complete canon appearance, and generation references. It is never a MaxQuill reader input. The Reader Gallery consumes only its filtered derivative.

## Handoff and ownership

Book Architecture owns semantic location identity, scene/chapter location and POV conventions, character presence/introduction conventions, reveal/discovery semantics, visual-asset references, and the exportable reader-safe companion contract. A concrete book owns its locations, maps, canonical appearances, reveal timing, approvals, and visual states.

MaxQuill owns the conditional map icon, overlays, map/marker rendering, zoom UX, Gallery interaction, progress integration, preferences, accessibility, cache behavior, and mobile experience. It may validate the handoff and display less than supplied, but it must not derive or reveal protected truth.

## Acceptance criteria before implementation ships

- A legacy book with no companion manifest renders identically to today.
- The map control exists only for a valid current safe map.
- Closing a map returns to the exact scroll position.
- Alternate POV markers use data, not a hardcoded character.
- Fixture tests prove unrevealed locations, layers, names, portraits, and future visual states never enter the rendered model.
- Early-chapter progress cannot access later-checkpoint data through URLs, cached payloads, DOM state, or asset enumeration.
- Missing/broken assets retain accessible prose and fallbacks.
- Review Ready and Owner Review validation and submission tests remain unchanged and passing.
