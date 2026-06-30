---
name: stacks/python
description: "Stack adapter for Python — pytest test/coverage command, term-missing parsing, pytest idioms (fixtures, parametrize, mock-at-boundary), and the dashed-filename module-registration gotcha. Loaded by unit-testing.md for pyproject.toml/pytest projects."
see_also:
  - unit-testing
---

# Stack adapter: Python

Mechanics for the [unit-testing.md](../unit-testing.md) spine when the project is Python (pytest).

## Test + coverage command

```bash
pytest -v --tb=short                                 # run + interpret
pytest --cov=src --cov-report=term-missing           # measure coverage
```

`term-missing` output:

```
Name              Stmts   Miss  Cover   Missing
-------------------------------------------------
src/auth.py          89      5    94%   23-27
-------------------------------------------------
TOTAL               245     17    93%
```

The `Missing` column lists uncovered line ranges directly — feed those into the spine's gap analysis.

## Test-file convention

Tests in `tests/`, named `test_*.py`; shared fixtures in `tests/conftest.py`. Minimal
`pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = ["--cov=src", "--cov-report=term-missing"]

[tool.coverage.run]
source = ["src"]
omit = ["*/tests/*"]
```

## Idioms

**Fixtures + mock at the boundary:**

```python
import pytest
from unittest.mock import Mock

@pytest.fixture
def auth_service():
    return AuthService(Mock(spec=UserRepository))

def test_login_rejects_bad_credentials(auth_service):
    with pytest.raises(InvalidCredentials):
        auth_service.login("user", "wrong")
```

**Parameterized branch / edge tests** — one case per branch:

```python
@pytest.mark.parametrize("page,page_size", [(0, 10), (-1, 10), (1, 0)])
def test_paginate_rejects_invalid_args(page, page_size):
    with pytest.raises(ValueError):
        paginate([], page, page_size)
```

**Mock external deps at the boundary** (`patch` the I/O call, assert behavior):

```python
@patch("requests.get")
def test_fetch_user_raises_on_404(mock_get):
    mock_get.return_value = Mock(status_code=404)
    with pytest.raises(APIError):
        APIClient().fetch_user(999)
```

**Inline coverage-exclusion rationale:**

```python
# pragma: no cover — unreachable in production; hardware-specific error path
if hardware_state == IMPOSSIBLE_STATE:
    log_and_reboot()
```

Configure recognized exclusions in `[tool.coverage.report] exclude_lines` (e.g. `pragma: no cover`,
`raise NotImplementedError`, `if __name__ == .__main__.:`).

## Gotcha: dashed-filename module registration

pytest imports modules by Python identifier, so a source file with a **dash** in its name
(`context-validator.py`) cannot be imported as `import context_validator` — the underscore name
doesn't exist on disk, and the dashed name is not a valid identifier. Tests silently fail to find it,
and coverage shows the file as entirely uncovered.

**Fix** — register the dashed file under an importable alias in `tests/conftest.py`:

```python
# tests/conftest.py
import importlib.util, sys
from pathlib import Path

def _register(dashed_path: str, alias: str) -> None:
    spec = importlib.util.spec_from_file_location(alias, Path(dashed_path).resolve())
    module = importlib.util.module_from_spec(spec)
    sys.modules[alias] = module
    spec.loader.exec_module(module)

_register("src/context-validator.py", "context_validator")
```

Tests then `import context_validator` normally and coverage tracks the file. Apply this **before**
concluding a dashed-named module is untested.
