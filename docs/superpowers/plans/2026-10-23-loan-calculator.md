# Каталог и калькулятор обычных кредитов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development if selected by the user. Steps use checkbox (`- [x]`) syntax for tracking. Код начинается после проверки этого плана Петей.

**Goal:** Клиент выбирает обычный кредит, меняет сумму и срок ползунками или вручную, получает серверный расчёт и независимо сохраняет черновик.

**Architecture:** В существующий FastAPI добавляются авторизованные каталог и чистый аннуитетный калькулятор. Существующий React-черновик использует общий ввод и серверные пределы; отдельный hook управляет загрузкой и актуальностью результата. База и контракт сохранения не меняются.

**Tech Stack:** Python 3.12, Decimal, FastAPI/Pydantic, React 19, TypeScript, Vitest/Testing Library, существующие PostgreSQL и Docker Compose. Новых зависимостей нет.

**Spec:** [Общая утверждённая спецификация](../specs/2026-10-23-credit-policy-alignment-design.md), [детальный контракт первого этапа](../../technical/loan-calculator-contract.md).

## Global Constraints

- Backend и frontend последовательно ведёт Петя через Codex; ветка codex/petya-loan-calculator начинается от main после PR #5.
- Расчёт — только working_capital и equipment; каталог сохраняет overdraft, его текущий ввод и сохранение. Аннуитет к овердрафту не применять.
- Условия — из каталога Киры: 300000.00–6000000.00 / 12–36 / 25.00% и 500000.00–10000000.00 / 12–60 / 25.00%. Нет скоринга и обещания одобрения.
- Только авторизованные новые методы; суммы строками до двух знаков; Decimal с локальной точностью не менее 40, ROUND_HALF_UP для итогов; никаких ставок или аннуитета в браузере.
- Ввод, сохранение, версии и состояния DRAFT сохраняют совместимость. Калькулятор не вызывает PATCH, не повышает версию заявки и не создаёт запись в БД.
- Ползунок суммы имеет шаг 10000 ₽, срока — 1 месяц; ручной ввод допускает копейки. Пауза запросов 300 мс, транспортный таймаут 15 секунд.
- Node.js >=22.12.0 <23 либо >=24; npm ci по существующему lockfile. Новые зависимости и смена стека не нужны.
- Backend-автотесты — только на отдельной тестовой БД; не удалять пользовательские черновики и Docker volume. Значения доступа брать из локальных настроек, не печатать секреты.

## Review Focus

1. Старая сумма, пустые поля или срок вне нового каталога: не подменять ввод и не запрещать сохранение; расчёт отсутствует с подсказкой — Task 2.
2. Быстрые изменения, уход со страницы и обратный порядок ответов, в том числе ошибок: показывать только результат текущего запроса — Task 2.
3. Недоступный каталог, ошибка расчёта, 401 и версия ответа не совпала: не показывать старые деньги, сохранять ввод, давать повтор — Tasks 1–2.
4. Копейки, границы, bool вместо срока, ставка в запросе: точный результат либо 422; заявка не меняется — Task 1.
5. Расчёт идёт одновременно с сохранением/навигацией: нет скрытого PATCH и блокировки всего кабинета; сводка использует тот же результат — Task 2.

## Файлы и границы

| Файлы | Ответственность |
| --- | --- |
| backend/app/product_catalog.py (новый) | Одна конфигурация трёх продуктов, версия и сериализация GET /products |
| backend/app/calculator.py (новый) | Чистая Decimal-математика и проверки продуктовых границ |
| backend/app/main.py | Строгое тело запроса и два тонких обработчика, существующие авторизация/ошибки/parse_money |
| backend/tests/conftest.py (новый), test_applications.py | Переиспользуемые PostgreSQL-фикстуры без изменения смысла старых проверок |
| backend/tests/test_calculator.py, test_calculator_api.py (новые) | Чистая математика и настоящий HTTP API |
| frontend/src/types.ts, api.ts, api.test.ts | Типы и вызовы двух методов через существующий транспорт |
| frontend/src/calculator.ts (новый) | Подготовка запроса, проверка ввода по каталогу и безопасное отображение ползунков; без формул кредита |
| frontend/src/hooks/useLoanCalculator.ts (новый) | Один каталог и один поток результатов на открытый черновик |
| frontend/src/components/draft/LoanCalculator.tsx (новый) | Контролы суммы/срока и переиспользуемая сводка результата |
| App.tsx, components/DraftForm.tsx, components/draft/DraftFields.tsx | Передача Api и общего DraftFields, интеграция с существующими шагами |
| draft.ts, components/draft/DraftReview.tsx | Общее точное отображение денег; сохранить поведение старой сводки |
| styles.css, test/api-fixtures.ts, LoanCalculator.test.tsx (новый) | Внешний вид и HTTP-фикстуры/пользовательские проверки |
| README.md, backend/README.md, frontend/README.md, docs/technical/api-contract.md | Документировать только реализованный результат и запуск |

## Task 1: Серверный каталог и аннуитетный API

**Files:** backend/app/product_catalog.py, backend/app/calculator.py, backend/app/main.py, backend/tests/conftest.py, backend/tests/test_applications.py, backend/tests/test_calculator.py, backend/tests/test_calculator_api.py; backend/README.md.

**Interfaces:**
- product_catalog.py: `CATALOG_VERSION: str = "2026-10-23.1"`; `ProductConfig` — frozen dataclass с полями Product из контракта, деньги/ставка внутри Decimal; `get_product(code: str) -> ProductConfig | None`; `get_catalog() -> dict[str, Any]` сериализует денежные поля строками и items в согласованном порядке.
- calculator.py: `CalculationValidationError(fields: dict[str, str])` с атрибутом fields; `annuity_payment(amount_rub: Decimal, annual_rate_percent: Decimal, term_months: int) -> Decimal` возвращает округлённый платёж; `calculate_annuity(product_code: str, amount_rub: Decimal, term_months: int) -> dict[str, Any]` возвращает полный ответ из контракта.
- main.py: `AnnuityPayload` с extra=forbid/strict=True, product_code Literal[working_capital,equipment], amount_rub StrictStr, term_months StrictInt. GET /api/v1/products и POST /api/v1/calculations/annuity используют CurrentAccount. POST передаёт сумму через существующий parse_money; ошибки домена переводятся в существующий validation_error, без циклического импорта main в чистые модули.
- tests/conftest.py: clean_database и client, перенесённые из test_applications.py; client зависит от clean_database. У clean_database нет глобального autouse. test_applications.py получает pytestmark=pytest.mark.usefixtures("clean_database"), чтобы и проверки с самостоятельно созданным TestClient очищали только тестовую БД. Чистая математика не требует очистки БД.

- [x] **1. Записать проверки до реализации.** В test_calculator.py: test_annuity_reference_examples — для D(3000000)/36 платёж 119279.48, итог 4294061.28, переплата 1294061.28; для equipment D(5000000)/45 — 172289.03/7753006.35/2753006.35. test_zero_rate — annuity_payment(D(1200),D(0),12)==D("100.00"). test_product_boundaries — граничные суммы/сроки разрешены; ±0.01 за суммой и ±1 за сроком дают CalculationValidationError; запрос overdraft отклоняется. test_decimal_precision — 300000.01 принимается точно, глобальный Decimal-контекст не меняется, платежи возвращаются с двумя знаками.
- [x] **2. Записать API-проверки.** test_catalog_requires_login / test_calculation_requires_login — 401 без cookie. test_catalog_contract — три продукта, версия и точные границы/ставки; calculation_available false только у overdraft. test_strict_calculation_input — сумма JSON-числом, 0, отрицательная, 1e6, пробел/запятая, три дробных знака, срок bool/строка/дробный, неизвестный продукт, overdraft и присланная ставка дают 422 с полем. test_calculation_is_read_only — создать свой черновик, посчитать несохранённые параметры, GET черновика и список до/после равны, версия не выросла. test_request_normalization — строки 3000000 и 3000000.0 дают amount_rub=3000000.00.
- [x] **3. Запустить новые проверки и увидеть ожидаемое падение.** После чтения backend/README.md определить действующий Compose-проект и отдельную БД. Если безопасной тестовой БД нет, создать credit_cabinet_tests один раз без удаления других баз. Команда: `docker compose run --rm --no-deps -e DATABASE_URL=postgresql+psycopg://credit:credit@db:5432/credit_cabinet_tests backend pytest -q tests/test_calculator.py tests/test_calculator_api.py`. Это пример стандартных demo-настроек; подставить существующий проект/пользователя/тестовую БД, не направлять на рабочую. Перед проверкой собрать backend-образ с тестами. Ожидается ImportError/отсутствующий метод, не ошибка окружения.
- [x] **4. Реализовать перечисленные интерфейсы.** Локальный Decimal-контекст 50 значащих цифр. Параметры из get_product, денежная сериализация до двух знаков, итог из округлённого платежа. Не менять модели БД, PATCH и значения существующих заявок. Перенести фикстуры без удаления прежних сценариев.
- [x] **5. Запустить новые и старые backend-проверки на тестовой БД.** Та же команда без списка файлов запускает `pytest -q`; результат — все проверки PASS, без использования рабочей БД. Проверить GET/POST в OpenAPI и вписать новые методы/ограничения в backend/README.md.
- [x] **6. Сохранить проверенную серверную часть.** Просмотреть diff, выполнить git diff --check, добавить только файлы Task 1 и commit `feat(api): добавить каталог и калькулятор обычных кредитов`.

## Task 2: Ползунки, актуальный расчёт и проверка связки

**Files:** frontend/src/types.ts, api.ts, api.test.ts, calculator.ts, hooks/useLoanCalculator.ts, components/draft/LoanCalculator.tsx, App.tsx, components/DraftForm.tsx, components/draft/DraftFields.tsx, draft.ts, components/draft/DraftReview.tsx, styles.css, test/api-fixtures.ts, LoanCalculator.test.tsx; README.md, frontend/README.md, docs/technical/api-contract.md.

**Interfaces:**
- types.ts: Product и ProductCatalog соответствуют GET-контракту; `AnnuityRequest={product_code:"working_capital"|"equipment",amount_rub:string,term_months:number}`; AnnuityResult соответствует POST-ответу. Api расширяется `products():Promise<ProductCatalog>` и `calculateAnnuity(input:AnnuityRequest):Promise<AnnuityResult>`.
- calculator.ts: `prepareCalculation(fields:DraftFields,catalog:ProductCatalog): {request:AnnuityRequest|null,errors:FieldErrors}` — переиспользует normalizeMoney, не требует purpose и не вызывает toDraftPayload для всех полей; отсутствие параметра даёт null без ошибки, заполненное недопустимое — ошибку только калькулятора. `calculationKey(applicationId:string,input:AnnuityRequest,catalogVersion:string):string` включает все пять составляющих ключа.
- calculator.ts: `isCurrentAnnuityResult(input:AnnuityRequest,catalog:ProductCatalog,value:unknown):value is AnnuityResult` проверяет полноту, продукт/сумму/срок запроса, версию и ставку каталога, формат денежных строк результата; не пересчитывает кредит.
- calculator.ts: `sliderAmountValue(raw:string,product:Product):number` проецирует только отображаемое положение в допустимый диапазон, не пишет в DraftFields. Сравнение огромной денежной строки с пределами — строками/BigInt до преобразования в безопасное число. Пользовательский onChange ползунка записывает явный результат в amount_rub. Для срока используется безопасная проекция целого.
- draft.ts: `formatMoneyRub(value:string|null):string` переносит существующее moneyText из DraftReview с прежним поведением «Не указано»/невалидного текста и без Number для денег. Используется в сводке и новом результате.
- hook: `useLoanCalculator(api:Api,fields:DraftFields,applicationId:string):CalculatorState`; тип CalculatorState включает catalog|null, catalogStatus loading/ready/error, result|null, status incomplete/loading/ready/invalid/error/unsupported, errors:FieldErrors, message:string|null, authenticationRequired:boolean, retryCatalog():void, retryCalculation():void. Hook один на DraftForm, не отдельный на каждый экран. Результат разрешён к показу только при совпадении ключа и последнего номера запроса; ошибка имеет ту же защиту.
- LoanCalculator.tsx: `LoanCalculator({fields,onChange,state}:Pick<EditableProps,"fields"|"onChange"> & {state:CalculatorState})` и `LoanCalculationSummary({state}:{state:CalculatorState})`. Обычные поля берут общие DraftFields; fieldset DraftForm блокирует их при busy. Форматирующие функции не вычисляют кредитные суммы.
- App передаёт api и повторный вход в DraftForm. При 401 кнопка калькулятора повторяет вход через существующий App, затем обновляет каталог, сохраняя несохранённый ввод. DraftForm вызывает hook, передаёт каталог в ProductFields для диапазонов, выводит LoanCalculator на details обычного кредита и LoanCalculationSummary на review. Существующий ParameterFields сохраняется для overdraft и как ручной fallback при недоступном каталоге. Новых роутов/страниц нет.

- [x] **1. Написать RED-проверки транспорта и пользовательского пути.** api.test.ts проверяет GET products, POST calculateAnnuity с точным JSON и cookie-политикой. В LoanCalculator.test.tsx: test_slider_and_manual_input_share_draft — ввести 3000000/36, получить 119279.48; сдвинуть сумму/срок, увидеть те же значения при возврате на потребность; ручные копейки не теряются. test_review_and_explicit_save — расчёт виден в сводке, до нажатия сохранения нет PATCH, явное сохранение использует старый контракт.
- [x] **2. Добавить проверки опасных состояний.** test_preserves_empty_and_legacy_values — пустое, 1234.50 вне каталога и 9007199254740993.01 не заменяются минимумом, сохраняются как раньше, расчёта нет. test_debounce_and_out_of_order — за 299 мс запроса нет; после 300 мс он есть; старые успех/ошибка не заменяют ответ для новой суммы. test_change_product_or_draft — уход на overdraft или другой id скрывает результат сразу. test_catalog_and_calculation_failures — отказ GET, 503/не-JSON POST и 401 сохраняют ввод, показывают повтор/необходимость входа, не показывают старую сумму. test_catalog_version_mismatch — несовпавшая версия не отображается, доступна перезагрузка условий; test_inconsistent_success_response — ответ 200 с другой суммой/ставкой/сроком или отсутствующим денежным полем не показывается как результат. test_save_during_calculation — незавершённый POST не мешает навигации/сохранению, а busy сохранения блокирует и ползунки.
- [x] **3. Подготовить HTTP-фикстуры, выполнить новые проверки и увидеть ожидаемое падение.** contractServer получает GET /products и POST /calculations/annuity перед поиском id; для тестов — фиксированные ответы и управляемые отложенные Promise, без второй реализации аннуитета в JS. Новые проверки используют deferred-ответы/fake timers, приводят время через act и не ждут настоящие секунды. Команда из frontend: `npm test -- src/LoanCalculator.test.tsx src/api.test.ts`; ожидаются отсутствующие методы/контролы, не сломанное окружение.
- [x] **4. Реализовать типы, транспорт, подготовку запроса и hook.** Использовать существующий createApi.request с таймаутом. Загрузка каталога не попадает в глобальный busy; задержка 300 мс, очистка таймера и защита запросов по контракту. При невалидном/пустом вводе сеть не вызывается; данные не округляются для попадания в шаг ползунка. Начальная загрузка и retry не меняют черновик.
- [x] **5. Реализовать интерфейс и интеграцию.** Нативные доступные range-контролы с уникальными aria-label, ручной ввод и одинаковые значения на всех шагах. Подписи и оговорка из контракта. При недоступном каталоге оставить текущие поля; ошибки расчёта отделены от fieldErrors сохранения. На review только сводка. Не добавлять кнопку отправки или положительное решение. Обычные интервалы/ставки приходят от backend; overdraft остаётся доступен для черновика.
- [x] **6. Запустить все frontend-проверки и сборку.** `npm test`, затем `npm run build` из frontend. Ожидается PASS всех новых и старых сценариев, успешные TypeScript и Vite. Если поменялись роли элементов, адаптировать только селекторы старых проверок, сохранив их смысл. Документировать актуальный результат в frontend/README.md и README.md; в api-contract.md оставить контракт черновика и ссылку на теперь реализованный калькулятор.
- [x] **7. Проверить живую связку.** Собрать/обновить только backend в действующем Compose-проекте с прежним volume; Vite направлен на этот backend. В отдельном тестовом черновике пройти 3000000/36 и 5000000/45, ползунки, копейки, смену продукта, save/reload. Сохранить сумму ниже каталога и убедиться, что черновик не потерялся; проверить, что сеть расчёта не содержит PATCH. При остановленном backend нет ложного результата; после восстановления работает повтор. Проверить клавиатуру и отсутствие горизонтального переполнения при ширине 390 px. Не перепутать тестовый HTTP-стенд с реальной PostgreSQL-интеграцией.
- [x] **8. Сохранить frontend и передать на проверку.** git diff --check; добавить только файлы Task 2, commit `feat(frontend): добавить ползунки и серверный расчёт платежа`. Проверить состав всего diff к актуальной main и результаты проверок. После явного поручения отправки — push и один PR с обоими коммитами реализации; прикрепить PR к чату. Merge только после проверки пользователем/другим участником.

## Самопроверка плана

Контрактные значения и ошибки покрыты Task 1; все пять пунктов Review Focus — Task 1/2 с названными сценариями. Типы двух API-методов и ключа результата совпадают между задачами. Нет миграций, новых зависимостей, неявного сохранения или подмены отсутствующего скоринга. План описывает только первый шаг; дальнейшие поля, оценка и конвейер рассматриваются отдельно.

План утверждён Петей; реализация выполнена последовательно в этом чате. Проверки и живая интеграция выполнены, итоговая независимая проверка завершена: три важных замечания воспроизведены тестами и исправлены; мелких отложенных замечаний нет. Итог: 72 frontend-теста, 68 backend-тестов, TypeScript/Vite и живая связка проверены. Отправка ветки и merge требуют отдельного поручения/проверки.
