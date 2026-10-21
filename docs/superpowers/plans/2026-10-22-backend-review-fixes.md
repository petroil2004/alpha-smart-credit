# Backend Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Petya explicitly requested fixing both reproduced findings and checking the result. Do not merge PR #3.

**Goal:** Не терять одновременные изменения черновика и возвращать 422 вместо 500 при превышении вместимости числовых полей.

**Architecture:** Existing FastAPI/SQLAlchemy/PostgreSQL. Lock the owned application row for PATCH before checking version. Validate stored money and day/month integers before commit. No schema migration or business-policy changes.

**Tech Stack:** Existing pinned Python dependencies, PostgreSQL, pytest, FastAPI TestClient, real SQLAlchemy connections.

**Spec:** docs/superpowers/specs/2026-10-21-credit-cabinet-design.md; agreed draft API from origin/codex/petya-client-draft:docs/technical/api-contract.md; reproduced PR #3 review findings.

## Global Constraints

- Work on codex/vitya-application-api; preserve Viktor's original commit and frontend branch.
- Same endpoints and error envelope: stale version → 409 VERSION_CONFLICT; invalid numeric input → 422 VALIDATION_ERROR with fields.
- PostgreSQL Numeric(18,2) stores at most 9999999999999999.99; Integer at most 2147483647. These are storage bounds, not credit product limits.
- No dependencies, schema changes, scoring rules or frontend edits.
- Automated tests must use separate credit_cabinet_fix_tests database, never the open cabinet's database.

## Review Focus

- Two simultaneous PATCH calls with version=1: exactly one success, one conflict, stored values match the winner.
- Equal-capacity and above-capacity numbers: exact cents preserved, rejected write leaves data/version unchanged.
- Very long monetary strings: field validation rather than Decimal exception.
- Both monetary and both duration fields: validation applies to each, including partial PATCH.
- Existing ownership/product/session behavior and failure paths retain their contract.

## Task 1: Atomic concurrent draft updates

**Files:** backend/app/main.py, backend/tests/test_applications.py.
**Interfaces:** application_for_account gains a keyword-only lock option, default false; PATCH locks before version comparison. GET retains normal reads.

- [x] Add a concurrent PostgreSQL test: hold row lock externally, launch two PATCH requests with independent DB sessions, observe two database lock waits, release gate, assert statuses [200,409], winner preserved and version=2.
- [x] Observe failure on original code (both 200), implement row lock, rerun full backend suite.
- [x] Check foreign/missing drafts and invalid payloads retain existing responses; commit focused fix.

## Task 2: Validate numeric storage capacity

**Files:** backend/app/main.py, backend/tests/test_applications.py, backend/README.md.
**Interfaces:** parse_money checks upper bound before quantize; duration checks enforce positive Integer range. Error fields keep API names.

- [ ] Add parameterized tests for both monetary fields at overflow and very long input, and both durations beyond Integer; assert 422 field error, no changed version/data and a later valid PATCH succeeds.
- [ ] Observe failures, implement bounds, verify exact maximum money/integer and small cent values remain accepted.
- [ ] Document technical bounds and concurrency behavior, run all backend tests and frontend suite/build, inspect browser ordinary/overdraft saving and field error handling with actual rebuilt backend.
- [ ] Fresh review of fix diff, resolve important findings with failing tests, then push existing PR branch; update PR description with actual verification. No merge.
