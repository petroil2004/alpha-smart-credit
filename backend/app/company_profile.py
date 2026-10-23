"""Minimal synthetic bank profile; unknown business facts are not invented."""
import hashlib
import json
from .models import Account


def get_company_profile(account: Account) -> dict:
    displayed = {'company_id': account.company_id, 'company_name': account.company_name}
    digest = hashlib.sha256(json.dumps(displayed, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {**displayed, 'profile_version': 'company-v1:' + digest, 'source': 'BANK_DATA'}
