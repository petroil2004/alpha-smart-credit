# Профиль и финансы демо-компании — контракт

[Спецификация](../superpowers/specs/2026-10-24-demo-profiles-design.md), [план](../superpowers/plans/2026-10-24-demo-profiles.md). Этап в разработке.

Авторизованный CLIENT читает свою компанию через прежний `GET /api/v1/company-profile`. STAFF получает403; без входа401. Идентификатор компании из пользовательского запроса не принимается. Внешних источников и регистрации аккаунтов нет.

Сохраняются company_id/company_name/source/profile_version. Новые поля:
- details: legal_form OOO/IP/null, tax_id и okved null в начальных наборах, registration_date YYYY-MM-DD|null, business_age_months integer|null, registration_status ACTIVE/TERMINATED/null, is_bank_client boolean|null.
- as_of_date: дата чтения по Europe/Moscow; prepared_on: дата первоначальной подготовки набора|null; data_version: версия набора|null.
- finance.period: start_date/end_date, шесть завершённых календарных месяцев.
- finance.months: ровно шесть хронологических строк {month:YYYY-MM,income_rub,expenses_rub,income_source,expenses_source}; деньги — строки с двумя знаками или null, источники BANK_DATA/null (сохранённый источник передаётся явно).
- finance.debt_payment_rub, debt_source, debt_as_of: месячные долговые платежи и источник/дата сведений, каждый nullable.
- finance.average_income_rub / average_expenses_rub: среднее только полного соответствующего ряда из6 значений, ROUND_HALF_UP до копеек; иначе null. Подтверждённый ноль учитывается. Риск/доступность не рассчитываются.

profile_version — SHA256 полного показанного DTO без самого profile_version, префикс company-v2:. Период, дата, пропуски, источники и метаданные входят в подтверждение. Новая отправка фиксирует DTO; исторические версии снимка без этих полей допустимы и не дополняются актуальным профилем.

CompanyData и CompanyMonth создаются дополнительно к старой схеме без очистки. Seed под транзакционной advisory-блокировкой вставляет отсутствующие аккаунты/полные наборы из app/demo_data/company-profiles.json. Повтор не обновляет строки или даты. Несовпадающий аккаунт диагностируется и пропускается. Неполный существующий набор автоматически не ремонтируется. Новый календарный месяц без строки БД возвращается с null, без генерации и переноса прежних сумм.
