# Client Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox syntax for tracking. Backend is implemented separately by Viktor; do not duplicate it.

**Goal:** Клиент входит в демонстрационный кабинет, создаёт и сохраняет черновик по общему API, видит ошибки без потери ввода и повторно открывает сохранённую заявку.

**Architecture:** React + TypeScript frontend в отдельной папке. Обычные запросы к `/api/v1` через Vite proxy. Backend и PostgreSQL реализует Виктор в другой ветке; тестовый HTTP-слой используется только в проверках frontend, не как скрытая замена backend.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, jsdom; точные версии зафиксировать в package-lock.json после проверки совместимости с Node 22.20.0. Только npm внутри frontend, без второго lock-файла в корне.

**Spec:** `docs/superpowers/specs/2026-10-21-credit-cabinet-design.md` и `docs/technical/api-contract.md`.

## Global Constraints

- Петя меняет frontend и свой контракт/документацию; backend, compose.yaml и корневую .env.example ведёт Виктор.
- API: `/api/v1`, демонстрационная серверная cookie-сессия, два изолированных клиента.
- Три кода продуктов: working_capital, equipment, overdraft; черновик может быть неполным.
- Деньги в API — положительная десятичная строка до двух знаков или null. Сроки — положительные целые или null.
- Никаких ставок, скоринга и окончательных кредитных порогов в этом шаге.
- Без автоматического сохранения в localStorage при недоступном сервере.
- Исходные данные сохраняются в форме при ошибке; чужие данные не остаются при смене аккаунта.
- Работа в codex/petya-client-draft; проверка другим участником до merge.

## Review Focus

- Сбой сервера после ввода: сохранение не объявляется успешным, ввод остаётся.
- Устаревшая версия из другого окна: 409 не перезаписывает данные автоматически.
- Повторный щелчок или повтор создания после ошибки: используется один ключ и нет параллельных созданий.
- Смена компании: не показываются заявки и несохранённая форма прошлого клиента.
- Смена обычного продукта на овердрафт и обратно: неприменимые поля сбрасываются.

## Task 1: API boundary and exact draft formatting

**Files:** Create frontend/package.json, package-lock.json, index.html, tsconfig.json, vite.config.ts, src/api.ts, src/types.ts, src/draft.ts, src/draft.test.ts, src/api.test.ts. Configuration belongs to this task, not a standalone setup deliverable.

**Interfaces:** `api.me/login/logout/list/create/get/update`; `DraftFields` contains every editable API field; `Application` includes server id/company/status/version/timestamps. `toDraftPayload` normalizes strings and clears inapplicable fields. `ApiError` retains status, code and field errors. Constructors/options allow injecting fetch in tests, without production test-only cleanup methods.

- [ ] Write tests for monetary input `1 500,25` → `1500.25`, empty → null, negative/double-decimal → field error, ordinary/overdraft/null product clearing, integer days/months.
- [ ] Run tests: expected RED because formatting behavior does not exist; distinguish missing implementation from broken tooling.
- [ ] Implement formatting and types without floating-point conversion of money; accept spaces and comma only in UI, send canonical strings.
- [ ] Test API boundary: create sends Idempotency-Key and `{}`, update sends version, cookie credentials are preserved, 409 and field errors survive, malformed/non-JSON failure is a readable error.
- [ ] Run tests, implement the boundary, rerun full suite: expected PASS.
- [ ] Commit the passing focused change with a feat(frontend) message.

## Task 2: Cabinet and editable draft

**Files:** Create src/App.tsx, src/App.test.tsx, src/components/DraftForm.tsx, src/components/ApplicationsList.tsx, src/styles.css, src/main.tsx, src/test/setup.ts, src/test/api-fixtures.ts and frontend/README.md. Update root README only with actual verified frontend instructions.

**Interfaces:** Consume Task 1 API/formatting. App owns session, list, selected server application, editable fields, pending action and errors. Components show and edit values; they do not invent server calculations or persist data in the browser.

- [ ] Write user-level tests with real React components and a fetch-boundary double that enforces contract routes and full response shapes. Cases: login/list; create; edit/save/reopen; save failure retains input; 409 explicit reload; account switch clears previous data; product switch resets fields; duplicate click disabled; failed create retry reuses key.
- [ ] Run tests: expected RED for missing UI behavior.
- [ ] Implement the cabinet, accessible labels/buttons, loading/empty/error states and demo login. Saving uses the returned server version and values. Draft unsaved-state indicator remains until server confirmation.
- [ ] Add deterministic client-side routing by selected id in URL hash so a refreshed page can open the same server draft; list remains the fallback for missing/inaccessible ids. Test initial hash behavior; do not introduce a heavy router for this slice.
- [ ] Run full suite and production TypeScript/Vite build: expected PASS.
- [ ] Start frontend and inspect actual UI in browser: login, empty/error and populated form. Browser may use a temporary contract server when Viktor backend is unavailable; disclose this and leave no fake backend in production source.
- [ ] Document npm ci, npm run dev, npm test, npm run build, backend address/proxy, limits of current slice and joint real-backend acceptance checklist.
- [ ] Review whole diff, commit checked changes, push branch and open PR when authorized by task scope. Do not merge without human review.

## Integration handoff

The frontend tests verify behavior against the agreed HTTP contract. They do not prove persistence or access control of Viktor's implementation. Once backend is available, run the seven joint scenarios from the contract, including actual PostgreSQL persistence, before describing the full slice as integrated.
