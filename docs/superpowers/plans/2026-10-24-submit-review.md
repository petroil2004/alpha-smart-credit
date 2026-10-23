# Отправка заявки и просмотр сотрудником — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Отправить оборотный кредит из кабинета клиента и увидеть ту же заявку в кабинете сотрудника.

**Architecture:** Существующий API черновиков расширяется защищённой отправкой и отдельными методами сотрудника. Отправка атомарно сохраняет снимок и историю в PostgreSQL; frontend отделяет редактируемый DRAFT от карточки отправленной заявки. Существующие модули расчёта и автосохранения остаются источниками соответствующей логики.

**Tech Stack:** React 19, TypeScript, Vite, Vitest; FastAPI, SQLAlchemy, PostgreSQL 16, pytest; существующий Docker Compose.

**Spec:** [Согласованная спецификация](../specs/2026-10-24-submit-review-design.md). Петя согласовал её в чате 24.10.2026. Петя выбрал выполнение самим Codex в этом чате; задачи реализованы, результаты — в отчёте приёмки.

## Global Constraints

- Отправляется только `working_capital`; `equipment`/`overdraft` сохраняют работу с черновиками.
- Три шага, оформление, сохранение через 1500 мс, копейки и серверный калькулятор сохраняются.
- Никаких новых зависимостей, ставок, скоринговых весов, кредитных решений, реальных данных или LLM.
- Проверки backend используют только отдельную PostgreSQL-базу с суффиксом `_tests`.
- Перед запуском проверять существующие процессы и контейнеры. Не удалять volume, базы, черновики и сессии.
- Работа последовательно в `codex/petya-submit-review`; push/PR/merge не входят в текущее поручение.

## Review Focus

- Потеря ответа после commit: повтор прежнего ключа/тела возвращает одну отправку после перезагрузки (задачи 2, 3).
- Уходящий PATCH и нажатие отправки: используется фактически сохранённая последняя версия, ошибки сохранения не обходятся (задача 3).
- Смена CLIENT/STAFF в другой вкладке и запоздалый ответ: данные предыдущей роли не появляются в новой (задачи 1, 3).
- Конкурентные PATCH/DELETE/submit: один согласованный результат без частичного снимка и повторной истории (задача 2).
- Старая схема и неизвестные сведения компании: миграция сохраняет данные, отсутствие финансов не становится нулём/отказом (задачи 1, 2, 4).

### Task 1: Серверные роли и минимальные сведения компании

**Files:** изменить `backend/app/main.py`, `models.py`, `seed.py`, `schema_compat.py`; создать `backend/app/access.py`, `backend/app/problems.py`, `backend/app/company_profile.py`; тест `backend/tests/test_staff_access.py`; дополнить `docs/technical/api-contract.md` ссылкой на новый контракт `docs/technical/submission-contract.md`.

**Interfaces:**
- `problems.ApiProblem(status_code, code, message, fields=None)` и `validation_error(fields)` сохраняют текущий формат ошибок.
- `access.current_account(request, db) -> Account`, зависимости `CurrentAccount`, `ClientAccount`, `StaffAccount`; запрет роли — 403 FORBIDDEN, нет сессии — 401.
- `company_profile.get_company_profile(account: Account) -> dict`: `company_id`, `company_name`, `profile_version`, `source: BANK_DATA`; версия включает версию формата и отпечаток показанных данных, меняется с ними.
- `/me`/вход: CLIENT с прежним объектом company; STAFF с `company: null`. Аккаунт `demo-staff-1` не имеет клиентской компании.

- [x] Написать `test_staff_login_has_no_company`, `test_client_and_staff_endpoints_reject_wrong_role`, `test_company_profile_is_own_and_version_changes_with_displayed_data`: вход STAFF = 200, company is None; STAFF на клиентских действиях = 403; без входа = 401; профиль клиента содержит только собственные ID/название/версию/источник.
- [x] На отдельной тестовой PostgreSQL выполнить `pytest -q tests/test_staff_access.py`; зафиксировать падение на отсутствующем входе/профиле.
- [x] Вынести только общие ошибки/проверку сессии в указанные модули; назначить CLIENT всем текущим клиентским действиям. Добавить STAFF и повторяемое снятие NOT NULL с двух полей Account без переписывания клиентских записей. Некорректный CLIENT без компании не получает доступ.
- [x] Дописать тест миграции: прежняя сессия и черновик доступны после двух повторов обновления схемы; профиль не получает выдуманных ИНН/финансов. Выполнить `pytest -q tests/test_staff_access.py tests/test_applications.py tests/test_deletion.py tests/test_calculator_api.py` на тестовой базе, ожидать PASS.
- [x] Проверить diff и сохранить только файлы задачи коммитом `feat(auth): добавить роль сотрудника и сведения компании`.

### Task 2: Отправка, снимок, история и очередь

**Files:** создать `backend/app/submissions.py`, `backend/app/serialization.py`, `backend/tests/test_submissions.py`; изменить `models.py`, `main.py`, `schema_compat.py`, `docs/technical/submission-contract.md`.

**Interfaces:**
- APIRouter из `submissions.py`: POST `/api/v1/applications/{id}/submit`, GET `/api/v1/staff/applications`, GET `/api/v1/staff/applications/{id}`.
- `SubmitPayload`: только `version: StrictInt > 0`, `profile_version: StrictStr`, `catalog_version: StrictStr`, `confirmed: StrictBool`; подтверждение должно быть true. Заголовок `Idempotency-Key` — UUID.
- `serialize_application(application, db, *, detail=True) -> dict`: прежние поля + `submitted_at`, `company_name`; подробный ответ также содержит `submission` и `history`. Для DRAFT: submitted_at/submission null, history []; данные повторного запроса в ответ не входят.
- `ApplicationSubmission`: PK application_id; actor_id, idempotency_key, request_payload JSONB, submitted_at, snapshot JSONB; UNIQUE(actor_id, idempotency_key). `ApplicationEvent`: application_id, actor_id nullable, actor_role, occurred_at, from_status, to_status, reason_code, comment, catalog_version; nullable offer/check versions.
- `submission.snapshot`: `application` (поля запроса), `company` (профиль задачи 1), `calculation` (существующий AnnuityResult), `financial_period: {start_date,end_date}`, `confirmed_at`, `confirmed_by`. Имена/полный пример фиксируются контрактом перед кодом.
- `history`: список `{id, actor_id, actor_role, occurred_at, from_status, to_status, reason_code, comment, catalog_version, offer_version, check_version}` по времени/ID.

- [x] Написать `test_submit_records_snapshot_and_two_events`: корректный оборотный 3000000.00/36 → 200, UNDER_REVIEW, version + 1; два события CLIENT/SYSTEM, снимок расчёта 119279.48/4294061.28, данные банка отдельно от клиентского purpose.
- [x] Запустить `pytest -q tests/test_submissions.py::test_submit_records_snapshot_and_two_events` на тестовой БД; ожидать падение на отсутствующем методе.
- [x] Реализовать одну транзакцию с FOR UPDATE: собственная заявка → проверка квитанции → DRAFT/версии/подтверждение/поля → существующий точный калькулятор → снимок, квитанция и два события → UNDER_REVIEW. Чтение и открытие сотрудником не выполняют переходов.
- [x] Добавить тесты `test_submit_validation_preserves_draft`, `test_submit_rejects_unavailable_products`, `test_submit_checks_all_versions`, `test_staff_queue_excludes_drafts_and_unregistered_statuses`, `test_staff_card_and_client_isolation`. Проверить 300000–6000000, 12–36, копейки, пустую цель, false/пропуск подтверждения, лишние/неверные типы, 401/403/404/409/422 и неизвестные финансы без автоматического отказа.
- [x] Добавить `test_submit_replay_survives_new_session`, `test_submit_key_reuse_with_changed_body_conflicts`, `test_concurrent_submit_has_one_snapshot`, параметризованный `test_submit_races_patch_or_delete`; использовать существующий шаблон реальных блокировок PostgreSQL. Проверить прежнее тело/ключ → тот же результат без увеличения version; другой ключ не повторяет переход; ошибка не оставляет событий.
- [x] Добавить `test_financial_period_crosses_year` и границы месяца в Europe/Moscow; проверить апрель–сентябрь при подаче 24.10.2026 и июль–декабрь при подаче 01.01.2027. Период не пересчитывается при чтении. Смена текущего каталога/названия компании не переписывает сохранённый снимок.
- [x] Выполнить полный `pytest -q` на отдельной тестовой БД; проверить diff и коммит `feat(applications): отправлять заявку и показывать очередь сотруднику`.

### Task 3: Клиентская отправка и кабинет сотрудника

**Files:** изменить `frontend/src/types.ts`, `api.ts`, `App.tsx`, `hooks/useDraftAutosave.ts`, `components/DraftForm.tsx`, `components/ApplicationsList.tsx`, `components/draft/DraftReview.tsx`, `styles.css`, `test/api-fixtures.ts`, `api.test.ts`; создать `submission.ts`, `submission.test.ts`, `components/SubmittedApplication.tsx`, `components/StaffApplications.tsx`, `SubmissionFlow.test.tsx`, `StaffFlow.test.tsx`.

**Interfaces:**
- Session — discriminated union CLIENT/company и STAFF/company:null. Application status — DRAFT | UNDER_REVIEW; API читает известные серверные поля без превращения иных статусов в DRAFT.
- `Api.companyProfile(): Promise<CompanyProfile>`, `submit(id, input: SubmitInput, key): Promise<Application>`, `staffList(): Promise<{items: Application[]}>`, `staffGet(id): Promise<Application>`; transport/таймаут прежние.
- `SubmitInput = {version,profile_version,catalog_version,confirmed:true}`; типы снимка/истории соответствуют задаче 2.
- `submission.ts`: `readAttempt(userId,id)`, `saveAttempt(userId,id,attempt)`, `clearAttempt(userId,id)` для UUID/точного SubmitInput в sessionStorage; проверять схему прочитанного значения. Невозможность хранения явно блокирует отправку с объяснением, а не теряет квитанцию незаметно.
- `useDraftAutosave.flush()` возвращает подтверждённый исход; отправка получает последнюю сохранённую Application из контроллера/актуальной ссылки, а не устаревшего React-замыкания. Контроллер создаётся только для клиентского DRAFT.
- `SubmittedApplication` читает snapshot/history; `StaffApplications` показывает очередь, ошибки/повтор, пустое состояние и переход к карточке.

- [x] Дополнить тестовый API профилем/STAFF/отправкой и написать `test submit waits for pending save and uses returned version`, `test failed save prevents submission`, `test submitted card survives reopening`; запуск `npm test -- src/SubmissionFlow.test.tsx` должен показать отсутствие функции интерфейса.
- [x] Расширить типы/transport, разделить загрузку списка и карточки по роли. Проверка сессии сравнивает user.id, роль и для CLIENT компанию; очистить роль/данные при смене. Сохранить действия текущего клиентского кабинета и прямые ссылки.
- [x] Добавить компанию на параметры и сводку; подтверждение/кнопку только working_capital. Сбрасывать подтверждение при изменении показанного ввода/профиля/каталога; после сохранения того же ввода не терять его. Не показывать несуществующие финансовые проверки.
- [x] Реализовать очередь flush → сохранение квитанции → submit → read-only карточка. Раздельно обработать ошибку поля, конфликт, 401, неизвестный исход. После timeout/не-JSON сохранять точный прежний запрос; после reload сначала GET/повтор прежней попытки, без требования нового подтверждения для повтора уже явно подтверждённой операции. Новый изменённый запрос требует нового подтверждения после выяснения старого исхода.
- [x] Написать `test confirmation resets on edited data`, `test invalid purpose returns to details`, `test unsupported products still save draft`, `test lost response retries same key after remount`, `test unavailable sessionStorage blocks submit clearly`. Проверить отсутствие помощника/редактирования/удаления после отправки, отдельное «Сохранить и выйти».
- [x] Написать `test staff sees queue and frozen snapshot`, `test staff cannot create draft`, `test role switch drops delayed response`, `test client cannot open staff URL`, `test same_company_different_user_invalidates_session`. Реализовать вход STAFF/очередь/карточку без будущих действий, сохранить клавиатуру и узкий экран.
- [x] Выполнить `npm test` и `npm run build` из frontend; ожидать все прежние 118 и новые проверки без ошибок. Проверить diff и коммит `feat(ui): отправлять заявки и добавить просмотр сотруднику`.

### Task 4: Сквозная приёмка и документация результата

**Files:** обновить `README.md`, `frontend/README.md`, `backend/README.md`, `docs/technical/submission-contract.md`; создать `docs/technical/2026-10-24-submit-review-verification.md`.

**Interfaces:** работающий UI ↔ backend по контракту задач 1–3; схемы БД совместимы с сохранёнными черновиками и сессиями.

- [x] Проверить `git status`, прослушиваемые порты и `docker ps`; определить существующий compose-проект. Убедиться в наличии отдельной `_tests` базы чтением списка БД; создавать только её, если отсутствует. Тесты направлять туда явно. Не печатать секреты .env.
- [x] Для серверных проверок использовать существующий backend-образ с тестовыми исходниками через read-only mount и отдельным DATABASE_URL; временный контейнер тестов не запускает второй сервер/БД. Если образ требует пересборки, собрать существующий сервис. Обновить рабочий backend только после тестов, сохраняя существующий compose project/volume.
- [x] Выполнить полный backend pytest, frontend `npm test` и `npm run build`; затем проверить браузером на отдельной синтетической заявке: CLIENT → оборотный → параметры → подтверждение → отправка → reload → STAFF → очередь/карточка → второй CLIENT без доступа. На 390px проверить отправку и карточку; клавиатурой — подтверждение/отправку/возврат.
- [x] Перезапустить только существующий backend после фиксации тестовой заявки; повторный вход/чтение сохраняют её и снимок. Проверить отсутствие потери прежних черновиков по ID/счётчику без вывода содержимого пользовательских данных в отчёт.
- [x] Записать фактические команды, числа тестов, результат ручного пути и ограничения. Не утверждать готовность скоринга/решений/всех продуктов. Обновить документацию и статус спецификации только согласно фактическому результату.
- [x] Выполнить `git diff --check`, просмотреть итоговый diff и отдельную проверку ветки; исправления проверять затронутыми тестами. Сохранить документы коммитом `docs: описать отправку и приёмку кабинета сотрудника`.

## Самопроверка плана

Все десять разделов спецификации покрыты: роли/профиль/миграция — задача 1; отправка/снимок/история/серверные ошибки — задача 2; три шага/подтверждение/повторы/смена роли/экраны — задача 3; реальные сервер/БД, перезапуск, ограничения и документация — задача 4. Пять рисков Review Focus имеют конкретные тесты. Кредитные правила и отправка других продуктов не расширяются. План задаёт зависимости задач, но не заменяет реализацию.
