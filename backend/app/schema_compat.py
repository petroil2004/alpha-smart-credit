"""Small, repeatable compatibility upgrade for existing prototype databases."""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def allow_deleted_creation_receipts(engine: Engine) -> None:
    # create_all creates new tables but cannot relax an existing NOT NULL column.
    with engine.begin() as connection:
        columns = inspect(connection).get_columns('application_creations')
        if any(column['name'] == 'application_id' and not column['nullable'] for column in columns):
            connection.execute(text('ALTER TABLE application_creations ALTER COLUMN application_id DROP NOT NULL'))


def allow_staff_accounts(engine: Engine) -> None:
    """STAFF has no client company; keep existing accounts and sessions."""
    with engine.begin() as connection:
        columns = inspect(connection).get_columns('accounts')
        for column in columns:
            if column['name'] in {'company_id', 'company_name'} and not column['nullable']:
                connection.execute(text(f"ALTER TABLE accounts ALTER COLUMN {column['name']} DROP NOT NULL"))
