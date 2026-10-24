# Уточнения внутри заявки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Сотрудник запрашивает сведения, клиент отвечает с документом и вопросами, та же заявка возвращается на рассмотрение.

**Architecture:** Отдельные таблицы запросов, сообщений, bytea-вложений и квитанций дополняют существующие Application/снимок. Новый router использует прежние сессии/роли и блокировку Application. Отдельный UI уточнений и очередь сохранения не включают DRAFT-autosave для отправленной заявки.

**Tech Stack:** существующие React/TypeScript/Vite/Vitest, FastAPI/SQLAlchemy/PostgreSQL/pytest. Без новых зависимостей и сервисов.

**Spec:** [Согласованная спецификация](../specs/2026-10-24-clarifications-design.md). Петя согласовал и поручил приступить; сохраняется выбранное native-выполнение в этом чате с независимым итоговым обзором. Технический план выполняется в рамках этого поручения.

## Global Constraints

- Не изменять исходный снимок/расчёт/финансовый период; ответы SELF_REPORTED, без скоринга/OCR/LLM.
- Одна открытая просьба на заявку; UNDER_REVIEW → NEEDS_INFO → UNDER_REVIEW только при явном действии.
- PDF/TXT до 5242880 байт, до пяти прикреплённых файлов; UTF-8 TXT без NUL, PDF начинается %PDF-.
- Запрос/ответ до 2000 символов, причина/сообщение до 1000; непустой текст без оценки убедительности.
- PostgreSQL bytea, прежний compose-проект/volume, тесты только на выделенной `_tests` БД; никаких очисток рабочих данных.
- Работа в codex/petya-clarifications, без push/merge до отдельного поручения.

## Review Focus

- Сообщение и загрузка не закрывают запрос; отправка ждёт всех подтверждений и последней revision (Tasks 1–3).
- Потерянный ответ и прежний ключ после следующего запроса возвращают текущее состояние, без второго перехода (Tasks 1,3).
- Подмена app/request/file ID и смена роли между запросами не раскрывают данные (Tasks 1–3).
- Поток без Content-Length и обман MIME/имени не обходят предел/формат; откреплённый файл не воскрешает поздний PUT (Task 2).
- Параллельные вкладки и завершение во время загрузки дают конфликт без частичной записи и потери нового ввода (Tasks 1–3).

### Task 1: Запрос, ответ, сообщения, права и история

Files: создать `backend/app/info_requests.py`, `backend/app/info_common.py`, `backend/app/info_serialization.py`, `backend/tests/test_info_requests.py`; изменить `models.py`, `serialization.py`, `submissions.py`, `main.py`. Контракт `docs/technical/clarifications-contract.md`.

Interfaces: POST STAFF `/staff/applications/{id}/info-requests` `{version,question,reason,document_required}`; PATCH CLIENT `/applications/{id}/info-requests/{rid}/reply` `{revision,reply_text}`; POST CLIENT `/.../reply/submit` `{version,revision}`; POST обеих ролей `/[staff/]applications/{id}/info-requests/{rid}/messages` `{text}`. POST с Idempotency-Key UUID. Ответ каждой мутации — текущий подробный Application. GET карточки добавляет `info_requests: InfoRequest[]`; summary — `next_action`.

- [x] Написать падающий тест полного текстового цикла: create → NEEDS_INFO, draft reply сохраняется без закрытия, messages не меняют revision/статус, submit → UNDER_REVIEW, снимок и период те же. Проверить отсутствие методов до реализации.
- [x] Реализовать модели InfoRequest (revision, reply_text, closed_at, авторы/время), InfoMessage, InfoOperation с глобальной уникальностью actor/key и сигнатурой пути/тела; partial unique index одного открытого запроса. Общая загрузка доступной реальной отправленной Application с FOR UPDATE; роль и принадлежность всех ID обязательны.
- [x] Реализовать ограничения/переходы/события с actor/time/reason. PATCH неполного ответа допустим, поздний PATCH после закрытия запрещён. Повтор POST проверяется до статуса/версии, сохраняет текущую карточку. Сообщения независимы от revision. STAFF очередь и GET включают NEEDS_INFO; порядок updated_at DESC/id DESC, обновляется только при переходе.
- [x] Тесты: чужая компания и роли, несовпадающие ID, пустые/лишние/неверные поля, версия/revision, один открытый запрос и повторный следующий, старые ключи с другим телом/путём, повтор после перезапуска, параллельные create/save/submit/message, отсутствие частичных событий, неизменность прежних записей при повторном create_all. `pytest -q tests/test_info_requests.py`, затем полный backend на `_tests`; коммит feat(info).

### Task 2: Постоянные файлы и безопасное скачивание

Files: создать `backend/app/info_files.py`, `backend/tests/test_info_files.py`; дополнить `models.py`, `info_serialization.py`, router и контракт.

Interfaces: PUT CLIENT `/applications/{id}/info-requests/{rid}/attachments/{fid}?filename=...&revision=N` raw File body. UUID fid — ключ загрузки, ответ Application. POST CLIENT `/.../attachments/{fid}/detach` `{revision}`; GET обеих ролей `/[staff/]applications/{id}/info-requests/{rid}/attachments/{fid}` — bytes attachment. В JSON только metadata `{id,filename,content_type,size_bytes,created_at,actor_id}` активных файлов.

- [x] Падающий тест: обязательный документ блокирует submit, TXT upload → метаданные/те же bytes при GET → успешное завершение → файл сохраняется и изменения запрещены.
- [x] Реализовать InfoAttachment (bytea с deferred loading, sha256, имя/тип/размер, detached_at). Ограниченный Request.stream до 5 МиБ, пустой/неверный формат 415, размер 413; нормализовать имя, attachment+nosniff. После чтения повторно проверить состояние под блокировкой; проверить revision, число активных файлов, фиксировать одним commit и событием.
- [x] Повтор fid сравнивает hash/name/type, не увеличивает revision/историю; другое тело 409, откреплённое 410. После close повтор прежнего PUT возвращает текущую карточку, новая загрузка запрещена. Detach повторяем, bytes не в JSON и не выдаются после detach; клиент видит пять активных слотов.
- [x] Тесты: PDF/TXT, UTF-8/NUL, пустое/ложный MIME/имя/путь, ровно лимит и превышение, поток без Content-Length, шестой файл, чужие/mismatched ID, оба ролевых скачивания, повтор/открепление/поздний PUT, загрузка против close и двух вкладок, перезапуск с теми же bytes. Полный backend; коммит feat(files).

### Task 3: Интерфейс, последовательное сохранение и повторы

Files: создать `frontend/src/info-api.ts`, `info-queue.ts`, `components/InfoRequests.tsx`, `InfoRequests.test.tsx`, `info-queue.test.ts`; изменить `types.ts`, `api.ts`, `App.tsx`, `SubmittedApplication.tsx`, `StaffApplications.tsx`, `styles.css`, тестовые fixtures при необходимости.

Interfaces: отдельный `createInfoApi(apiTransport)` или обёртка `createInfoApi(fetch)` с методами request/reply/submit/message/upload/detach/download, прежний Api расширяется совместимо. `InfoQueue` сериализует ответ/файлы, хранит revision и последний подтверждённый Application, flush возвращает исход. InfoRequests получает api, session, application, onUpdated, onSessionChanged и регистрирует flush/dirty для ухода из карточки.

- [x] Написать падающие React-тесты: STAFF запрос → CLIENT видит NEEDS_INFO; автоответ сохраняется, отправка ждёт задержанный save/upload; вопрос не закрывает; кнопки/история после закрытия. Новые API тестируются на fetch-границе, исходные сценарии сохраняются.
- [x] Добавить формы с явными действиями и пределами; на NEEDS_INFO убрать текст «действия пока не требуются», показать разное следующее действие ролям. Архивные запросы read-only; активный блок открыт. Файлы и переписка в отдельных блоках. Никаких изменений трёх шагов DRAFT или помощника после отправки.
- [x] Автосохранение reply через 1500мс с последней revision; файлы/открепление в той же очереди, сообщения независимо. Текст нового ввода не заменять старым ответом. При 401/409 останавливать автоматику, сохранять ввод и предлагать вход/явное обновление. Обычный выход/смена профиля ждёт flush; перед закрытием страницы предупреждение dirty.
- [x] UUID/точные POST-квитанции хранить в sessionStorage по user/app/request/action; повтор с прежним телом, в том числе после reload, без дубля. Сохранять файл/UUID до подтверждения upload; после reload просить перевыбрать неподтверждённый файл или проверить карточку. Рабочее восстановление повреждённой квитанции после защищённого GET. Проверять user/role/company до и после async, игнорировать disposed callbacks. Первоначальный submit из PR10 принимает актуальный NEEDS_INFO при корректном повторе.
- [x] Тесты ошибок/повторов/повреждённого storage, конфликтов и смены роли, недоступного файла, повторного запроса после закрытия, независимости чата от текста, клавиатуры. `npm --prefix frontend test` и `npm --prefix frontend run build`; коммит feat(ui).

### Task 4: Реальный путь, совместимость и итоговый обзор

Files: README frontend/backend/root, контракт, `docs/technical/2026-10-24-clarifications-verification.md`.

- [ ] Проверить процессы/контейнеры и отдельную тестовую базу; сохранить количество/хеш прежних заявок. Выполнить полный backend pytest (read-only исходники в тестовом контейнере, выделенная `_tests` база), frontend tests/build.
- [ ] Обновить только существующий backend после проверок. На отдельной синтетической заявке пройти STAFF запрос с документом → CLIENT вопрос → STAFF ответ → CLIENT текст/TXT → submit → STAFF скачивает те же bytes. Проверить исходный снимок, закрытую историю, следующую просьбу, reload/restart и чужой доступ. Широкий экран/390px и клавиатура; размер браузера восстановить.
- [ ] Записать фактические результаты, ограничения и новые тестовые записи; проверить ссылки/JSON/diff, сохранить документы. Независимый read-only обзор всей ветки; каждый существенный дефект — воспроизводящий RED→GREEN тест и исправление, затем полный набор. Push/merge не выполнять.

## Самопроверка

Все разделы спецификации покрыты четырьмя задачами. Состояние/ревизии/квитанции общие между backend, файлами и UI; исходный снимок не редактируется. Выбор PostgreSQL и native-выполнения уже согласован. Существенных открытых пользовательских решений нет; новый план не меняет согласованный объём.
