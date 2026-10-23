# Application actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Sequential inline execution and same checkout retained per user's existing preference; user approved this scope and instructed implementation, no further approval gates.

**Goal:** Перенести заготовку помощника под продукты, открывать карточку целиком и удалять только свои черновики.
**Architecture:** Existing FastAPI/SQLAlchemy routes + nullable creation receipt, small idempotent compatibility migration; existing React App owns delete action, list owns accessible buttons, DraftForm owns assistant expansion.
**Tech Stack:** Existing React/TS/Vitest, FastAPI/PostgreSQL/Docker, no new dependencies.
**Spec:** [Согласованный дизайн](../specs/2026-10-23-application-actions-design.md).

## Global Constraints
- No LLM integration, submission or archive; only DRAFT deletable.
- Existing working DB/volume preserved. Tests only credit_cabinet_fix_tests. No secrets in commits.
- Keep 1500ms autosave/version guards, UI wording and right process sidebar.
- Branch codex/petya-application-actions includes the two prior approved documentation commits from main adeaad6.

## Review Focus
1. Delete vs delayed save/another tab and stale version must not lose a newer update or recreate a deleted record.
2. Old POST replay, including existing creation receipt, must never resurrect a deleted application.
3. Migration on existing nullable/non-nullable PostgreSQL must preserve unrelated data and constraints.
4. Whole-card activation must retain keyboard semantics and not trigger when deleting/cancelling.
5. Account switch and network/server failure must not remove a wrong card or claim false success.

## Task 1: Backend deletion and compatibility
- [x] RED tests in backend/tests/test_deletion.py: DELETE success with persisted absence, replay410, 401/foreign404, non-DRAFT409, stale409, same-key independence, migration twice, concurrent PATCH/DELETE.
- [x] Implement nullable ApplicationCreation.application_id, app/schema_compat.py migration; run after create_all. Extend create replay for tombstones. Add versioned authenticated DELETE with row lock; unlink creation receipts, delete row, commit atomically.
- [x] Run dedicated PostgreSQL tests via temporary Compose backend container with source mounted; full backend suite. Document endpoint/migration, commit.

## Task 2: Frontend actions and placement
- [x] RED user-flow tests for product-step assistant/retained expansion, text and keyboard opening, delete confirm/cancel/error/delay, status visibility and profile switch.
- [x] Add Api.remove(id,version); App guarded delete, list removes only after204 and updates count. Accessible full-card open and separate delete button; keep arrow as decorative cue.
- [x] Move AssistantPreview out of NeedFields into product step below ProductFields, keep expansion state in DraftForm. Update old UI tests to same behavior on product step.
- [x] Full frontend tests/build; live browser backend/PostgreSQL QA on own synthetic application, responsive check; update truthful docs and common policy.
- [x] One final independent whole-branch review; single RED→GREEN fix pass if needed; keep branch for user, no unsolicited merge/push.

Verification note: desktop placement and mobile list were visually checked. Native browser confirmation and subsequent navigation stalled the automation; confirm/cancel are covered by component tests, live DELETE was verified through the real HTTP API/PostgreSQL on an executor-created temporary draft. Петя дополнительно проверил подтверждение удаления вручную и сообщил об успешной проверке перед отправкой ветки 23.10.2026.
