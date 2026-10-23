# Three-step cabinet redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Перенести утверждённый дизайн и сократить оформление до трёх шагов без потери сохранённых данных.

**Architecture:** Существующее состояние черновика и очередь автосохранения сохраняются. Меняются карта шагов, поля и представление; изображения отдельными локальными файлами. Серверный контракт прежний.

**Tech Stack:** React 19, TypeScript, Vite, Vitest; существующий FastAPI/PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-23-three-step-redesign.md`

## Global Constraints

- Три продукта и два согласованных типа роли; API этой задачей не расширяется.
- Ассистент только на первом шаге «Продукт»; ввод/отправка пока отключены.
- `purpose`: существующий текст до 500 символов; отдельная обязательная категория исключена.
- Автосохранение 1500ms, деньги до копеек; расчёт backend, не одобрение.
- Последнее действие «Сохранить и выйти». Удаление только DRAFT с существующим dialog.
- Сохранить доступность клавиатуры и отсутствие горизонтального переполнения на 390px.

## Review Focus

- Старая цель, в том числе прежняя готовая фраза, открывается как исходный текст и переживает сохранение.
- Ошибка скрытой суммы/цели на проверке возвращает к параметрам и фокусирует поле.
- Овердрафт сохраняет сумму и ожидаемые поступления без аннуитетного расчёта.
- Помощник раскрывается без API-вызова, скрыт на других шагах и сохраняет раскрытие при возврате.
- Неуспех сохранения/выхода/удаления не скрывается декоративным успехом; запросы не дублируются.

### Task 1: Договорённости и маршрут из трёх шагов

**Files:** docs/team, docs/business, docs/technical; README; frontend/src/draft-steps.ts, components/DraftForm.tsx, components/draft/DraftFields.tsx, DraftReview.tsx; wizard/need/autosave/calculator tests.

**Interfaces:** Consumes `DraftFields`, `onChange`, `useLoanCalculator`, существующее `purpose`; produces `DraftStep = product | details | review`, все поля кроме product_code принадлежат details. `PurposeField` — обычный textarea.

- [x] Обновить актуальные договорённости и снять обязательную категорию цели, сохранив исторические планы как историю.
- [x] Написать тесты: новый черновик сразу показывает продукты; три шага; цель только под расчётом; старые цели сохраняются; ошибки цели/суммы направляются к параметрам; овердрафт редактирует общую сумму.
- [x] Выполнить `cd frontend && npm test -- src/ThreeStepFlow.test.tsx`, увидеть ожидаемые FAIL старого маршрута.
- [x] Убрать need/буфер Other, перенести цель и сумму в details, исправить переходы сводки; адаптировать прежние проверки маршрута, не удалять проверки автосохранения и ошибок.
- [x] `cd frontend && npm test` → все тесты PASS; сохранить понятным коммитом docs/feat.

### Task 2: Локальные иллюстрации и утверждённое оформление

**Files:** frontend/public/images/credit/*; frontend/src/styles.css; App.tsx, ApplicationsList.tsx, products.ts, DraftForm.tsx, draft/LoanCalculator.tsx, draft/DraftFields.tsx; frontend/README.md.

**Interfaces:** consumes прежние props/API; products связывает code с локальной картинкой и CSS-классом; изменяется только layout, не источник расчётных данных.

- [x] Подготовить PNG hero, working-capital, equipment, overdraft с прозрачностью; проверить и положить в public/images/credit. Не использовать макеты целиком как фон.
- [x] Перенести общий header, hero, одинаковые значки заявки, пастельные продукты, assistant strip, калькулятор в две колонки и простую сводку. Удалить прежний sidebar и конкурирующие CSS-правила.
- [x] Сохранить пустые/ошибочные/загружаемые состояния, auth, dialog, focus-visible, reduced-motion; узкий экран складывает колонки.
- [x] `cd frontend && npm test && npm run build` → PASS; проверить размеры ассетов и diff; сохранить коммит feat(ui).

### Task 3: Проверка в браузере и независимое ревью

**Files:** output/three-step-redesign (снимки и отчёт, игнорируются Git), README при выявленном ограничении.

**Interfaces:** локальные Vite/backend; только синтетическая новая заявка для ручной проверки, не чужие сохранённые черновики.

- [x] Проверить desktop и 390px через браузер: главная, новый/старый DRAFT, три продукта, калькулятор, цель под ним, review/edit/back, refresh, assistant toggle, dialog/cancel.
- [x] Проверить сохранение на настоящем backend/PostgreSQL и отметить ограничения. Сделать скриншоты всех трёх шагов и главной.
- [x] Повторить тесты/сборку после необходимых исправлений; проверить документы на устаревший маршрут.
- [x] Независимый reviewer всей ветки; важные замечания исправить с воспроизводящим тестом и полной зелёной проверкой.
- [x] Итог: локальная ветка и результат для просмотра; push/PR только по поручению пользователя, merge — после проверки.
