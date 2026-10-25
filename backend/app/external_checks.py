"""Local, deterministic integration contracts. No external registries are contacted."""
import json
from pathlib import Path

FIXTURES = json.loads((Path(__file__).with_name('demo_data') / 'credit-history.json').read_text())
VERSION = FIXTURES['version']


def company_checks(company_id, details, checked_at, previous=None, *, retry=False):
    previous = previous or []
    complete = (details.get('registry_source') in {'FNS_MOCK', 'STAFF_VERIFIED'}
                and details.get('registration_status') in {'ACTIVE', 'TERMINATED'}
                and all(details.get(key) is not None for key in
                        ('tax_id', 'okved', 'registration_status', 'business_age_months')))
    verified = details.get('registry_source') == 'STAFF_VERIFIED'
    fns = {
        'source': 'STAFF_VERIFIED' if verified else 'FNS_MOCK',
        'label': 'Регистрационные сведения: проверено сотрудником' if verified else 'ФНС · локальная имитация',
        'checked_at': checked_at, 'status': 'SUCCESS' if complete else 'MISSING_DATA',
        'reason_code': ('ACTIVE' if details.get('registration_status') == 'ACTIVE' else 'TERMINATED') if complete else 'INCOMPLETE_PROFILE',
        'payload_version': 'registry-profile-v1',
        'summary': ('Регистрация действует' if details.get('registration_status') == 'ACTIVE' else 'Деятельность прекращена') if complete else 'Не хватает регистрационных сведений',
    }
    prior = next((item for item in previous if item.get('source') == 'BKI_MOCK' and item.get('payload_version') == VERSION), None)
    # Successful results are stable; only an explicit retry advances a failed scenario.
    if prior and (prior['status'] != 'UNAVAILABLE' or not retry):
        return [fns, prior]
    attempt = (prior.get('attempt', 1) + 1) if prior else 1
    fixture = FIXTURES['companies'].get(company_id)
    outcome = fixture['outcomes'][min(attempt - 1, len(fixture['outcomes']) - 1)] if fixture else 'MISSING_DATA'
    summaries = {'CLEAR': 'Просрочек в синтетической истории нет', 'OVERDUE': 'Есть просрочки: требуется ручная оценка',
                 'NO_HISTORY': 'Кредитной истории нет; это не просрочка',
                 'UNAVAILABLE': 'Источник временно недоступен. Повторите проверку',
                 'MISSING_DATA': 'Для компании не подготовлена синтетическая кредитная история'}
    bki = {'source': 'BKI_MOCK', 'label': 'БКИ · локальная имитация', 'checked_at': checked_at,
           'status': outcome if outcome in {'UNAVAILABLE', 'MISSING_DATA'} else 'SUCCESS',
           'reason_code': outcome, 'summary': summaries[outcome], 'payload_version': VERSION, 'attempt': attempt}
    return [fns, bki]
