# MaxQuill Product Roadmap

This backlog records product direction; an entry does not claim current implementation.

## Visual Companion — planned, optional

Architecture and UX requirements are defined in `docs/visual-companion.md`.

1. **Contract fixture and validation:** agree a versioned reader-safe companion manifest with Book Architecture; accept absent metadata; reject raw author-only or unresolved reveal data.
2. **Map overlay MVP:** conditionally render a map control, touch-first overlay, one safe base map/crop, POV marker, accessibility fallback, and exact reading-position restoration.
3. **Hierarchy and discovery:** support available parent/child zoom levels, reader-safe discovered locations/layers, coarse positions, routes, and progress-checkpoint selection.
4. **Character Gallery MVP:** explicit navigation and `View Portrait`, text-only fallback, separate introduction/portrait unlocks, and no automatic portrait insertion in prose.
5. **Visual states:** expose only progress-valid alternate states and accessible reader-known descriptions.
6. **Operational hardening:** caching/version invalidation, asset integrity and licensing/provenance handling, responsive/performance testing, failure telemetry without story leakage, and reveal-safety fixtures.

Each phase must preserve normal reading for legacy books and packages. Review submission and queue transport remain an independent workstream.
