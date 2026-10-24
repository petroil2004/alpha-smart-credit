"""Shared API problem format."""
class ApiProblem(Exception):
    def __init__(self, status_code: int, code: str, message: str, fields: dict[str, str] | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields or {}


def validation_error(fields: dict[str, str]) -> ApiProblem:
    return ApiProblem(422, "VALIDATION_ERROR", "Проверьте заполнение полей", fields)


