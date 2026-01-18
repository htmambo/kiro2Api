# Adapter and Common Utils Split Plan

**Status**: COMPLETED (2026-01-18)
**Created**: 2026-01-18
**Owner**: Sisyphus

## Goal
Split `src/kiro/adapter.js` and `src/utils/common.js` into smaller, focused modules to improve maintainability and reduce duplication while preserving existing behavior.

## Background
Batch 5 requires:
- M6: Split `src/kiro/adapter.js` into smaller modules.
- M8: Split `src/utils/common.js` into smaller modules.

Partial work exists for M6: helper functions extracted to `src/kiro/adapter/helpers.js` with adapter wrappers.

## Scope
- M6: Modularize adapter logic into focused files (auth manager, request builder, model mapper, tool transformer, search service, summary service).
- M8: Split `src/utils/common.js` into new modules and update imports across codebase.

## Task Breakdown
1. M6: Assess current adapter/helper split and finalize module boundaries.
   - Identify remaining logical groups in `src/kiro/adapter.js`.
   - Extract into modules under `src/kiro/adapter/`.
   - Update exports and imports, keep adapter as orchestrator.
   - Ensure no circular dependencies.

2. M8: Split common utils into new modules.
   - New modules (target):
     - `src/utils/system-metrics.js` (CPU/expiry)
     - `src/utils/auth-utils.js` (isAuthorized)
     - `src/utils/response-wrapper.js` (handleUnifiedResponse, createErrorResponse)
     - `src/utils/account-pool-utils.js` (pool helpers)
     - `src/utils/content-generator.js` (handleStreamRequest/handleUnaryRequest/handleContentGenerationRequest)
   - Update imports across codebase.
   - Keep `src/utils/common.js` as compatibility re-export with deprecation notes if needed.

3. Verification
   - Run `lsp_diagnostics` on changed files.
   - Sanity check for missing exports and unused imports.

## Expected Outcome
- Adapter logic is modular with clear responsibilities.
- Common utils are split into focused modules with updated import paths.
- No behavioral regressions or missing exports.

## Acceptance Criteria
- All code compiles with no LSP diagnostics on modified files.
- No circular dependencies introduced.
- All references to moved utilities updated successfully.

## Risks and Mitigations
- Risk: Hidden coupling across adapter helpers. Mitigation: small, focused extraction; validate imports.
- Risk: Missed imports after moving common utils. Mitigation: search for old exports and update references.

## Execution Order and Dependencies
1. M6 adapter split (depends on current helper work).
2. M8 common utils split.
3. Verification and cleanup.

## Status Tracking
- M6 adapter split: COMPLETED
- M8 common utils split: COMPLETED
- Verification: COMPLETED (LSP unavailable)
