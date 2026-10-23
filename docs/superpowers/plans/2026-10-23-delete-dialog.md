# Delete dialog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Same checkout/inline method retained. User directly authorized fix; no extra approval needed. Open PR #8 gets the fixes in its existing branch.

**Goal:** Надёжная корзина и подтверждение удаления внутри сайта.
**Architecture:** DeleteDraftDialog uses native HTML dialog/showModal; App owns pending target and existing run/delete queue; CSS centers trash without transform.
**Tech Stack:** Existing React/TS/Vitest, no backend/dependencies.
**Spec:** [Дизайн исправления](../specs/2026-10-23-delete-dialog-design.md).

## Global Constraints
- Only DRAFT; same versioned DELETE, existing ownership/status guards.
- No existing working records deleted for UI QA; cancel only.
- Preserve current PR/branch, no merge.

## Review Focus
1. Dialog remains open and prevents a second DELETE while request is pending.
2. Error remains actionable inside modal; cancel makes stale list refresh accessible.
3. Focus/keyboard and StrictMode effects do not close/reopen unexpectedly.
4. Trash pointer region stays fixed during active state at desktop/mobile widths.
5. Company changes clear the old target, no foreign-card deletion.

## Task 1: Fix and verify
- [x] RED: adapt ApplicationActions tests to visible confirmation + Cancel/Delete, add repeated opening/no window.confirm, Escape/focus, pending repeat guard and inline retry.
- [x] Add focused dialog component, App target state/open/confirm/cancel; error inside dialog; retain auth/version logic. Fix row-delete centering/active CSS.
- [x] Frontend full suite/build; native browser repeat/cancel/hold and mobile screenshot without actual deletion; independent read-only review and single test-backed fix pass if necessary.
- [x] Update truthful docs and commit verified fix. Delivery after verification: push existing PR #8, no merge.

Result: 117 frontend tests and TypeScript/Vite build pass. In browser: four repeated open/cancel cycles, a 450ms pointer hold, initial Cancel focus, Tab to Delete, Escape cancellation, and a 390px modal with no horizontal overflow. Independent review found no issues. Real records were not deleted; the synthetic draft «Проверка окна удаления» remains for user testing.
