"""Existing startup entry point; insert-only synthetic account/profile seeding."""
from .demo_profiles import ensure_demo_profiles


def ensure_demo_accounts() -> None:
    ensure_demo_profiles()
