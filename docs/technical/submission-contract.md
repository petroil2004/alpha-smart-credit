# API отправки оборотного кредита и просмотра сотрудником

Версия проекта контракта: 24.10.2026. Основание — [согласованная спецификация](../superpowers/specs/2026-10-24-submit-review-design.md) и [план](../superpowers/plans/2026-10-24-submit-review.md). **Методы ещё не реализованы.** Этот документ конкретизирует обмен для реализации; [черновики](api-contract.md) и [калькулятор](loan-calculator-contract.md) сохраняют прежний смысл.

## Вход и роли

Прежние CLIENT `demo-client-1`/`demo-client-2` сохраняют ID, компанию и сессии. Новый аккаунт `demo-staff-1` имеет роль STAFF. POST `/api/v1/auth/demo-login` принимает прежнее тело `{"account_id":"demo-staff-1"}`; ответ 200 и HttpOnly-cookie:

```json
{"user":{"id":"demo-staff-1","name":"Демо-сотрудник","role":"STAFF"},"company":null}
```

GET `/api/v1/me` возвращает тот же объект. CLIENT по-прежнему получает ненулевой объект компании. Отсутствующая/истёкшая сессия — 401 UNAUTHENTICATED; неподдерживаемый аккаунт — 422 VALIDATION_ERROR. Сервер определяет роль по аккаунту сессии. Передача роли/компании в запросах не даёт прав.

Все существующие клиентские методы `/applications`, `/products`, `/calculations/annuity`, а также профиль и отправка требуют CLIENT; STAFF получает 403 FORBIDDEN. `/me`, вход и выход общие; health остаётся открытым. Сотрудник читает заявки только через `/staff/applications`.

## GET /api/v1/company-profile

Только CLIENT. Ответ 200:

```json
{"company_id":"demo-company-1","company_name":"ООО «Демо Торг»","profile_version":"company-v1:EXAMPLE_HASH","source":"BANK_DATA"}
```

`profile_version` — непрозрачная непустая серверная строка с версией формата и отпечатком показанных ID/названия; EXAMPLE_HASH является обозначением, а не готовой константой. Изменение показанных сведений меняет версию. Клиент не разбирает её и не вычисляет самостоятельно. Профиль берётся только из собственной компании аккаунта; это минимальные синтетические сведения, без выдуманных ИНН/финансов и без редактора.

## POST /api/v1/applications/{id}/submit

Только CLIENT и своя компания. Обязателен заголовок `Idempotency-Key: <UUID>`. Строгое JSON-тело, без других полей:

```json
{"version":4,"profile_version":"company-v1:EXAMPLE_HASH","catalog_version":"2026-10-23.1","confirmed":true}
```

`version` — положительное целое, не bool/строка; версии профиля/каталога — строки; confirmed — строго true. Параметры заявки берутся из сохранённого DRAFT. Клиент сначала завершает автосохранение, затем отправляет подтверждённую последнюю версию.

Проверки: рабочий продукт working_capital; непустая цель до 500 символов; сумма 300000.00–6000000.00 ₽ включительно с копейками; срок 12–36 целых месяцев; неприменимые поля овердрафта null. Диапазоны/ставка читаются из текущего каталога, а не копируются в другой набор серверных констант. Оборудование/овердрафт — 422 SUBMISSION_NOT_AVAILABLE; их черновики по-прежнему сохраняются. Отсутствие финансов/скоринга не блокирует отправку и не запускает отказ.

Успех — 200, подробный Application. Под блокировкой строки одной транзакцией сохраняются снимок, квитанция операции и два события, итоговый статус UNDER_REVIEW, version увеличена на один. История содержит DRAFT → SUBMITTED от CLIENT и SUBMITTED → UNDER_REVIEW от SYSTEM; это регистрация на рассмотрение, без имитации уже выполненных проверок.

Повтор прежнего ключа тем же автором для той же заявки и ровно того же JSON-тела возвращает 200 и тот же результат, включая после потери ответа/перезапуска. Права проверяются перед повтором, совпадение операции — до проверки устаревшей version. Область уникальности ключа — автор, а не только заявка. Тот же ключ для другой заявки или с изменённым телом — 409 IDEMPOTENCY_CONFLICT. Другой ключ на уже отправленную заявку — 409 APPLICATION_NOT_DRAFT. Прежний ключ создания черновика не является ключом отправки.

## Application и снимок

Прежние поля Application сохраняются. Список получает дополнительно `company_name: string` и `submitted_at: ISO-UTC | null`; GET карточки, POST создания, PATCH и submit дополнительно возвращают `submission: object | null` и `history: Event[]`. У DRAFT submission/submitted_at null и history пуст. Списки не передают полный снимок и историю. Новые поля не разрешают PATCH серверных данных.

Пример расширения подробной заявки оборотного кредита 3000000.00/36 после отправки (старые поля Application опущены только для краткости примера):

```json
{
  "status":"UNDER_REVIEW",
  "version":5,
  "company_name":"ООО «Демо Торг»",
  "submitted_at":"2026-10-24T10:00:00Z",
  "submission":{
    "submitted_at":"2026-10-24T10:00:00Z",
    "submitted_by":"demo-client-1",
    "snapshot":{
      "application":{
        "purpose":"Закупка товаров для магазина",
        "product_code":"working_capital",
        "amount_rub":"3000000.00",
        "term_months":36,
        "usage_days":null,
        "expected_inflow_date":null,
        "expected_inflow_amount_rub":null
      },
      "company":{"company_id":"demo-company-1","company_name":"ООО «Демо Торг»","profile_version":"company-v1:EXAMPLE_HASH","source":"BANK_DATA"},
      "calculation":{
        "product_code":"working_capital","amount_rub":"3000000.00","term_months":36,
        "catalog_version":"2026-10-23.1","annual_rate_percent":"25.00",
        "monthly_payment_rub":"119279.48","total_payment_rub":"4294061.28","overpayment_rub":"1294061.28"
      },
      "financial_period":{"start_date":"2026-04-01","end_date":"2026-09-30"},
      "confirmed_at":"2026-10-24T10:00:00Z",
      "confirmed_by":"demo-client-1"
    }
  },
  "history":[
    {"id":1,"actor_id":"demo-client-1","actor_role":"CLIENT","occurred_at":"2026-10-24T10:00:00Z","from_status":"DRAFT","to_status":"SUBMITTED","reason_code":"CLIENT_SUBMITTED","comment":null,"catalog_version":"2026-10-23.1","offer_version":null,"check_version":null},
    {"id":2,"actor_id":null,"actor_role":"SYSTEM","occurred_at":"2026-10-24T10:00:00Z","from_status":"SUBMITTED","to_status":"UNDER_REVIEW","reason_code":"REGISTERED_FOR_REVIEW","comment":null,"catalog_version":"2026-10-23.1","offer_version":null,"check_version":null}
  ]
}
```

Время — ISO 8601 UTC, UUID/ID/даты примера не фиксированные. Период — шесть завершённых месяцев по дате отправки Europe/Moscow, неизменяемый при чтении. Денежные значения снимка — строки с двумя знаками. Снимок не меняется после обновления текущего профиля/каталога. История упорядочена по времени и ID; SYSTEM не притворяется действием сотрудника. Источники клиентских параметров и BANK_DATA не смешиваются; финансовых значений в этом этапе нет.

Ключ операции и сохранённое тело запроса для повтора не выдаются в публичном ответе.

## Методы сотрудника

GET `/api/v1/staff/applications`: только STAFF; 200 `{"items":[ApplicationSummary]}`. Summary имеет все прежние поля Application, company_name и submitted_at, без submission/history. Только UNDER_REVIEW с настоящей сохранённой отправкой, по submitted_at DESC, id DESC. Пустой результат — items: []. DRAFT разных компаний не раскрываются.

GET `/api/v1/staff/applications/{id}`: только STAFF; 200 подробный Application со снимком и историей. Отсутствующая заявка, DRAFT или статус без записи отправки — 404. CLIENT на обоих методах получает 403. GET не меняет статус/версию и не запускает проверки.

GET клиента `/applications/{id}` сохраняет изоляцию по компании и позволяет читать собственную отправленную заявку. PATCH/DELETE после отправки запрещены сервером; интерфейс показывает карточку для чтения. Отмена, назначение сотрудника и решения — будущие отдельные действия.

## Ошибки

Прежний конверт `{"error":{"code":"...","message":"...","fields":{}}}`. fields необязателен.

| HTTP | code | Значение |
| --- | --- | --- |
| 401 | UNAUTHENTICATED | Нет действующей сессии |
| 403 | FORBIDDEN | Метод недоступен роли |
| 404 | NOT_FOUND | Заявка отсутствует или недоступна |
| 409 | VERSION_CONFLICT | Изменился черновик |
| 409 | PROFILE_VERSION_CONFLICT | Изменились подтверждаемые сведения компании |
| 409 | CATALOG_VERSION_CONFLICT | Изменились условия каталога |
| 409 | APPLICATION_NOT_DRAFT | Уже отправлено другой операцией |
| 409 | IDEMPOTENCY_CONFLICT | Ключ повторно использован для другого содержания |
| 422 | VALIDATION_ERROR | Формат/обязательные поля, включая confirmed |
| 422 | SUBMISSION_NOT_AVAILABLE | Отправка equipment/overdraft пока недоступна |
| 500 | SERVER_ERROR | Общая ошибка без внутренних подробностей |

fields используют purpose/product_code/amount_rub/term_months/confirmed и имена прежних полей овердрафта при их неприменимости. Ошибки не меняют DRAFT/версию и не оставляют частичную историю. При 409/401 интерфейс останавливает автоматические действия. Потеря ответа не считается неуспехом транзакции: клиент выясняет состояние GET карточки либо повтором сохранённого ключа/тела, без молчаливой отправки изменённых параметров.

## Приёмка

Контракт должен быть подтверждён отдельными автоматическими тестами PostgreSQL и ручным путём клиент → отправка → перезагрузка → сотрудник → та же карточка. Прежние черновики/сессии и квитанции создания сохраняются. До выполнения этих проверок документ не подтверждает реализацию API.
