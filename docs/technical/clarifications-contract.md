# Контракт уточнений — 24.10.2026

Основание: [согласованная спецификация](../superpowers/specs/2026-10-24-clarifications-design.md), [план](../superpowers/plans/2026-10-24-clarifications.md). В разработке; до проверки методы не объявляются работающими.

База `/api/v1`. STAFF использует `/staff/applications/{app_id}/info-requests`, CLIENT — `/applications/{app_id}/info-requests`. Для сообщений/скачивания есть оба ролевых пути. Сессии и права прежние; CLIENT только своей компании, STAFF только реально отправленные заявки. Несовпадающие app/request/file ID — 404. Неверная роль — 403, нет сессии — 401.

| Метод | Путь после ролевой базы | Тело |
| --- | --- | --- |
| POST STAFF | пустой | `{version,question,reason,document_required}` |
| PATCH CLIENT | `/{rid}/reply` | `{revision,reply_text}` |
| POST CLIENT | `/{rid}/reply/submit` | `{version,revision}` |
| POST обе роли | `/{rid}/messages` | `{text}` |
| PUT CLIENT | `/{rid}/attachments/{fid}?filename=...&revision=N` | raw File body, Content-Type application/pdf или text/plain |
| POST CLIENT | `/{rid}/attachments/{fid}/detach` | `{revision}` |
| GET обе роли | `/{rid}/attachments/{fid}` | bytes в attachment, безопасное UTF-8 имя, nosniff |

POST создания, сообщения и submit требуют UUID Idempotency-Key; область ключа — actor_id, сигнатура включает действие, app/rid и точное тело. Повтор возвращает текущий подробный Application, без нового эффекта; другое содержание ключа — 409 IDEMPOTENCY_CONFLICT. PUT использует UUID fid и hash/name/type содержимого как отдельную квитанцию; повтор проверяется до устаревшей revision/закрытия. Откреплённое — 410 ATTACHMENT_DETACHED, без восстановления.

Мутации возвращают 200 и текущий подробный Application. Новое `info_requests: InfoRequest[]` упорядочено created_at/id. InfoRequest: `id,question,reason,document_required,revision,reply_text,source:SELF_REPORTED,created_at,created_by,reply_by,closed_at,closed_by,messages,attachments`. Закрытие фиксирует reply_text и активные файлы; дальнейшие изменения запрещены. Message: `id,text,actor_id,actor_role,created_at`. Attachment: `id,filename,content_type,size_bytes,actor_id,created_at`; bytes/hash/квитанции в JSON не выдаются. В summary нет запросов/переписки, добавляется next_action CLIENT/STAFF/null.

Создание: Application.version+1 и UNDER_REVIEW→NEEDS_INFO; закрытие: version+1, request.revision+1 и NEEDS_INFO→UNDER_REVIEW. PATCH reply/upload/detach меняют только request.revision; сообщения не меняют её. Всё под блокировкой Application. Неизменённый PATCH reply не увеличивает revision (позволяет безопасно подтвердить уже записанное значение после потери ответа). Повтор PATCH с прежней revision допускается только когда reply_text уже равен сохранённому и запрос открыт; иначе VERSION_CONFLICT. Исходный snapshot/расчёт/период не изменяются.

Форматы: строгие JSON-типы, положительные целые версии (не bool); question/reply_text до 2000, reason/text сообщения до 1000. Обязательное непустое question/reason/message, reply draft может быть пуст; финальный reply непуст. document_required — bool. При обязательном документе ≥1 активного файла. PDF/TXT ≤5242880 байт, ≥1 байта; PDF %PDF-, TXT UTF-8 без NUL; имя безопасное до128 символов. До5 активных файлов. Превышение потока/header —413, неверный формат —415, ошибки полей —422, устаревшие версии/закрытый запрос/состояние —409. Неверное имя/расширение/тип/пустой файл —415. Content-Length не является единственной проверкой размера.

В событиях истории для сообщений/сохранения/файлов одинаковые from_status/to_status; тексты и metadata доступны в защищённой карточке, бинарное содержимое в историю не включается. Списки STAFF включают UNDER_REVIEW/NEEDS_INFO, сортировка updated_at DESC/id DESC; updated_at изменяется на переходе, не при сообщениях/файлах.

Ответы клиента и загруженные файлы — SELF_REPORTED; пока это текст/документ, не структурированная финансовая анкета и не автоматически подтверждённые банковские значения.
