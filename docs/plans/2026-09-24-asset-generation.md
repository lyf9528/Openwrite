# Asset generation implementation plan

**Goal:** Make asset creation easier with local generation and Chinese progression labels.

**Architecture:** Generate candidates locally, preview before applying, preserve filled fields by default. Keep English enum values in storage. Use the existing progression YAML contract for abilities, limitations and requirements; preserve unknown stage fields on edit.

**Tech Stack:** React, TypeScript, Vitest; existing Studio asset API.

## Tasks
1. Add typed local generators for IDs, names and genre-based progression stages in `packages/studio-panel/src/client/asset-generation.ts`.
2. Add generation controls and editable stage fields, integrated into `AssetEditor.tsx` and `AssetsView.tsx`. Add Chinese/English interface labels to `locales.ts`.
3. Verify candidate application, duplicate/invalid IDs, stage round trips and enum compatibility through component tests; run panel build and component suite.

## Accepted scope
Local templates first; AI generation using existing world context is a later extension. Genres: cultivation, fantasy, urban supernatural, science fiction, martial arts. Conditions: surname, world category, ability direction, stage count. No generated candidate persists before Create/Save. Existing IDs are immutable. Existing unrelated working-tree changes remain intact.

## Verification results
- Panel TypeScript checks and bundle build: passed.
- Final targeted component run: 11 tests passed (generation, asset view and draft storage).
- Broader component run: 299 tests passed; theme-contract suite could not load because `@deepseek-ai/dsh-client-ui-theme` is absent.
- Panel smoke could not start because the existing root installation lacks `proper-lockfile`.
- A direct Python backend round-trip probe could not start because the system Python lacks PyYAML; payload compatibility was checked against the bundled backend source. No live workspace data was written.
- `git diff --check`: passed.
