# Backend первого шага: вход и черновики

Сервер реализует согласованный с frontend API для демонстрационного входа и черновиков. Данные хранятся в PostgreSQL. Реализованы только `DRAFT`, два синтетических аккаунта, cookie-сессия, изоляция компаний, защита от повторного создания и версия черновика.

Скоринг, банковские решения, ставки, отправка на рассмотрение, выдача и Ollama в этот шаг не входят.

## Запуск

Требуется Docker Compose. Из корня репозитория:

```bash
cp .env.example .env
docker compose up --build -d
curl http://127.0.0.1:8000/api/v1/health
```

Ожидаемый ответ:

```json
{"status":"ok"}
```

PostgreSQL не публикуется на хост. Backend доступен только на `127.0.0.1:8000`; frontend Vite по умолчанию перенаправляет `/api` на этот адрес.

## Проверки на PostgreSQL

После запуска контейнеров выполнить:

```bash
docker compose exec backend pytest -q
```

Проверки запускаются внутри контейнера backend против PostgreSQL-сервиса `db`. SQLite не применяется. Они очищают только демонстрационную схему указанной Compose-базы, поэтому не выполняйте их против другой БД.

Проверить сохранение после перезапуска вручную:

```bash
docker compose restart backend
```

После команды браузер с уже выданной cookie должен получить `GET /api/v1/me` со статусом 200, а черновик остаться в `GET /api/v1/applications`. Для полного удаления демонстрационных данных используйте `docker compose down -v`.

## Демонстрационные запросы

Вход первого клиента:

```bash
curl -i -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"account_id":"demo-client-1"}' \
  http://127.0.0.1:8000/api/v1/auth/demo-login
```

Ответ: 200 и объект `user`/`company`; заголовок `Set-Cookie` содержит HttpOnly `credit_cabinet_session`.

Создание пустого черновика:

```bash
curl -b cookies.txt \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 4f65e9d1-71fb-4ae8-8ecb-900d4d804b3f' \
  -d '{}' \
  http://127.0.0.1:8000/api/v1/applications
```

Ответ: 201 и объект Application со статусом `DRAFT`, версией `1` и пустыми полями. Повтор того же запроса с тем же ключом вернёт 200 и тот же `id`.

Изменение черновика (подставьте `APPLICATION_ID` из ответа):

```bash
curl -b cookies.txt \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"version":1,"product_code":"working_capital","amount_rub":"125000.00","term_months":12}' \
  http://127.0.0.1:8000/api/v1/applications/APPLICATION_ID
```

Ответ: 200, `amount_rub` в формате строки с двумя знаками и `version: 2`. Если указанная версия устарела, сервер возвращает 409 `VERSION_CONFLICT` и не меняет заявку. Неприменимые к продукту поля возвращают 422 `VALIDATION_ERROR`.

## Адреса для frontend

Все запросы frontend идут через `/api/v1` того же origin:

- `POST /api/v1/auth/demo-login` — 200 и cookie;
- `GET /api/v1/me` — 200, без cookie 401 `UNAUTHENTICATED`;
- `POST /api/v1/auth/logout` — 204;
- `GET /api/v1/applications` — 200 `{ "items": [...] }`;
- `POST /api/v1/applications` — 201, либо 200 при повторе `Idempotency-Key`;
- `GET /api/v1/applications/{id}` — 200 для своей заявки, иначе 404 `NOT_FOUND`;
- `PATCH /api/v1/applications/{id}` — 200, 409 при устаревшем `version`, 422 для неверных полей.

OpenAPI и Swagger доступны по `http://127.0.0.1:8000/docs`.
