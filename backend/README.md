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

При стандартных демонстрационных настройках один раз создайте отдельную тестовую БД:

```bash
docker compose exec -T db psql -U credit -d postgres -c 'CREATE DATABASE credit_cabinet_tests'
```

Затем запускайте проверки так:

```bash
docker compose run --rm --no-deps \
  -e DATABASE_URL=postgresql+psycopg://credit:credit@db:5432/credit_cabinet_tests \
  backend pytest -q
```

При изменённых имени пользователя или пароле в `.env` замените демонстрационные значения в командах. Повторно создавать существующую тестовую БД не нужно.

Проверки запускаются внутри отдельного контейнера backend против PostgreSQL-сервиса `db`. SQLite не применяется. Тесты очищают схему указанной через `DATABASE_URL` базы: не направляйте их на `credit_cabinet` с вашими сохранёнными черновиками или на другую рабочую БД.

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

Проверка версии и запись выполняются с блокировкой строки PostgreSQL: при двух одновременных сохранениях одной версии один запрос получает 200, второй — 409. Второй запрос не перезаписывает результат первого.

Суммы хранятся в `Numeric(18,2)` и технически не могут превышать `9999999999999999.99`; дни и месяцы хранятся в `Integer` и не могут превышать `2147483647`. Превышение возвращает 422 с указанием поля, не меняя черновик или его версию. Это вместимость хранения, а не кредитные лимиты: окончательные ограничения продуктов согласовываются отдельно.

Тесты включают одновременные запросы с реальными блокировками PostgreSQL, переполнение обоих денежных и обоих целочисленных полей и сохранение граничных значений без потери точности. Для проверки используйте отдельную тестовую БД: тестовая очистка схемы удаляет её содержимое.

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
