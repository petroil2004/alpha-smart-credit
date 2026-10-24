# Demo Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Шесть постоянных синтетических профилей с финансами и неизменным снимком при отправке.
**Architecture:** Новые CompanyData/CompanyMonth; фиксированный JSON набора, однократный транзакционный seed. Совместимое расширение company-profile, единый серверный период и DTO; общий read-only React-блок до/после отправки.
**Tech Stack:** существующие PostgreSQL/SQLAlchemy/FastAPI и React/TypeScript/Vitest. Без новых зависимостей/сервисов.
**Spec:** [Согласованная спецификация](../specs/2026-10-24-demo-profiles-design.md). Петя подтвердил «Да, реализуй этот этап»; прежнее выполнение самим Codex в этой папке сохраняется.

## Global Constraints

- Два существующих CLIENT/STAFF и прежние данные не перезаписывать; добавить CLIENT3…6. Данные полностью синтетические.
- Шесть завершённых календарных месяцев Europe/Moscow; ноль и null различаются; среднее только полного ряда, Decimal до копеек ROUND_HALF_UP.
- Seed один раз, 36 месяцев до prepared_on с корректным днём месяца; повтор/новая версия файла не обновляют сохранённые строки.
- Нет скоринга, внешних проверок, редактирования финансов, новых продуктов отправки и дополнительных шагов DRAFT.
- Рабочая БД/volume сохраняются; backend-тесты только credit_cabinet_submit_tests. Push/merge не выполнять.

## Review Focus

- Смена месяца/года между GET и POST не смешивает два периода и требует нового подтверждения (Tasks 1–2).
- Параллельный первый запуск либо расхождение существующего аккаунта не оставляет половину профиля и не раскрывает чужие данные (Task 1).
- Неполный/пустой/нулевой ряд не превращается в благоприятное среднее; одинаковая версия набора не скрывает изменение строки БД (Tasks 1–2).
- Старый снимок после расширения профиля остаётся историческим и не подтягивает сегодняшние данные (Tasks 2–3).
- Поздний профиль после смены компании/роли не появляется в новом кабинете; неизвестные или ошибочные данные не разрешают ложное подтверждение (Task 3).

### Task 1: Постоянные наборы и чтение профиля

Files: создать backend/app/demo_data/company-profiles.json, demo_profiles.py, profile_period.py, backend/tests/test_company_profiles.py; изменить models.py, seed.py, company_profile.py, main.py. Создать docs/technical/company-profile-contract.md.
Interfaces: ensure_demo_profiles(prepared_on:date|None=None) создаёт отсутствующие аккаунты и профили одной транзакцией, сериализует параллельные старты pg_advisory_xact_lock с постоянным task-key. get_company_profile(account,db,*,as_of:datetime|None=None)->dict читает CompanyData/CompanyMonth одним SELECT JOIN. period_for(datetime)->{start_date,end_date}; months_for(period)->date[6]. GET /company-profile требует CLIENT.
DTO сохраняет company_id/company_name/source/profile_version и добавляет details:{legal_form,tax_id,okved,registration_date,business_age_months,registration_status,is_bank_client}, prepared_on, data_version, as_of_date, finance:{period,months:[{month,income_rub,expenses_rub,income_source,expenses_source}],debt_payment_rub,debt_source,debt_as_of,average_income_rub,average_expenses_rub}. Деньги string|null, неизвестные metadata nullable; дата YYYY-MM-DD, month YYYY-MM. Источники BANK_DATA|null. Версия SHA256 канонического полного DTO без самого profile_version. Набор отсутствует: metadata null и шесть null-строк периода, без заимствования демо-значений.

- [x] Падающий test_profile_contains_six_persistent_months: CLIENT1 GET finance.months имеет6 строк, средние900000.00/600000.00, долг30000.00; до реализации нет finance. Expected RED.
- [x] Добавить модели: CompanyData PK company_id (metadata/date/version/debt), CompanyMonth PK company_id/month (Numeric18,2 values и отдельные источники). JSON ровно6 наборов по спецификации; новая seed-функция вызывается из прежнего startup seed, сохраняет IDs/имена и диагностирует mismatch без принудительного исправления. Профиль+месяцы атомарны; вставка аккаунтов тоже под seed-lock. Не чинить неполный старый профиль автоматической перезаписью.
- [x] Реализовать профиль/период/полные средние и fingerprint. Test unknown_zero_and_partial_rows, six_accounts_and_staff_access, existing_unknown_company_no_fallback, seed_repeat_parallel_mismatch_no_overwrite, month_year_leap_boundaries, independent_sources_version_changed. Expected targeted PASS, затем полный backend PASS. Коммит feat(data).

### Task 2: Атомарное подтверждение и неизменный снимок

Files: submissions.py, tests/test_profile_snapshots.py, main.py по необходимости.
Interfaces: submission берёт now один раз до profile/version проверки, передаёт as_of=now в get_company_profile(account,db), использует тот же profile.finance.period для financial_period. Старый ключ ищется до нового профиля как прежде. Внешний SubmitInput не меняется.

- [x] RED test_month_rollover_requires_new_confirmation: смена месяца между GET/POST даёт409, повтор с новым профилем фиксирует один период; test_new_snapshot_freezes_finances_and_replays_old_version: изменение профиля не меняет GET/повтор старой отправки. Старые snapshot без details/finance сохранить побайтно при startup/GET.
- [x] Переделать вызовы общего profile/period; атомарная единая проекция для версии/снимка. Дата на сервере фиксируется один раз. Tests profile_conflict_after_finance_source_or_null_change; month_rollover_conflict; incomplete_finances_still_submit; legacy_snapshot_not_augmented; concurrency/update yields consistent DTO without mixing. Expected targeted/full backend PASS. Коммит feat(submission).

### Task 3: Просмотр профиля и финансов в интерфейсе

Files: types.ts, App.tsx, components/CompanyDataView.tsx, DraftForm.tsx, SubmittedApplication.tsx, styles.css; test/company-fixtures.ts, CompanyDataView.test.tsx, ProfileFlow.test.tsx, api-fixtures.ts.
Interfaces: CompanyProfile расширяется optional details/finance/etc для старых снимков/fixtures. CompanyDataView({profile?:CompanyProfile, historical?:boolean, pending?:boolean}) — только чтение, details и6 строк по серверу без пересчёта средних. DraftForm использует существующий companyProfile/retry/confirmationStamp; SubmittedApplication только snapshot.company. Добавить6 вариантов demo-login, без нового auth API.

- [x] RED tests readable_profile_and_finances, partial_expenses_null_vs_zero, legacy_snapshot_missing_no_live_fetch, six_profiles_login, refresh_version_resets_confirmation; задержанный профиль после смены user/role не вызывает отображения/подтверждения. Expected отсутствующий компонент/поля.
- [x] Добавить раскрываемый профиль/финансы на параметрах/проверке и в отправленной карточке, прежний дизайн. Не показывать блок на продукте. Источники/даты/пропуски/неполный ряд с ясными подписями; историческое «Не зафиксировано при отправке». Обновление профиля доступно явно, сбрасывает подтверждение. Сессия проверяется до/после получения профиля; stale/disposed ответы игнорировать.
- [x] Frontend tests + build PASS, без изменения исходных трёх шагов/калькулятора/уточнений. Коммит feat(ui).

### Task 4: Реальная база, документация и итоговая рецензия

Files: README/backend/frontend README и docs/technical/2026-10-24-demo-profiles-verification.md.
- [ ] Сохранить прежние applications/submissions/info tables, проверить процессы. Полный backend на _tests, frontend test/build. Обновить только существующий backend alpha-credit-pr3.
- [ ] На реальном API/UI: шесть аккаунтов, T1 полные суммы, T4 null, T5 статус без автоматического решения; новая оборотная заявка со снимком, чужой доступ, старые заявки без новых исторических данных. Перезапуск сохраняет исходные строки/наборы. Широкий экран/390px и клавиатура, размер восстановить. Expected сохранность и совпадение финансового снимка.
- [ ] Записать факты/ограничения/синтетические записи, проверить ссылки/diff, коммит docs. Один свежий read-only whole-branch reviewer; существенные находки RED→GREEN и полный набор, без повторной рецензии. Отчёт с решениями, без push/merge.

## Самопроверка

Все разделы спецификации покрыты. Seed и snapshot потребляют один DTO и календарь; UI не рассчитывает риск и деньги. Поля новых проверок/редактирования не добавляются. Основные рискованные границы представлены тестами в owning task.
