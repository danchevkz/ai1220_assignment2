.PHONY: install install-backend install-frontend dev dev-backend dev-frontend test test-backend test-frontend test-e2e lint

BACKEND_DIR := backend
FRONTEND_DIR := frontend
BACKEND_PYTHON := $(BACKEND_DIR)/.venv/bin/python

$(BACKEND_PYTHON):
	python3 -m venv $(BACKEND_DIR)/.venv

# ── Install ───────────────────────────────────────────────────────────────────

install: install-backend install-frontend

install-backend: $(BACKEND_PYTHON)
	$(BACKEND_PYTHON) -m pip install -r $(BACKEND_DIR)/requirements.txt

install-frontend:
	cd $(FRONTEND_DIR) && npm install

# ── Dev servers ───────────────────────────────────────────────────────────────

dev:
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend: $(BACKEND_PYTHON)
	cd $(BACKEND_DIR) && ./.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd $(FRONTEND_DIR) && npm run dev

# ── Tests ─────────────────────────────────────────────────────────────────────

test: test-backend test-frontend

test-backend: $(BACKEND_PYTHON)
	cd $(BACKEND_DIR) && ./.venv/bin/python -m pytest -v

test-frontend:
	cd $(FRONTEND_DIR) && npm run test

# E2E tests require both servers. Playwright starts the frontend via its
# webServer config; backend must be running on :8000 beforehand.
test-e2e:
	cd $(FRONTEND_DIR) && npm run test:e2e

# ── Lint ──────────────────────────────────────────────────────────────────────

lint:
	cd $(BACKEND_DIR) && ./.venv/bin/python -m ruff check . && ./.venv/bin/python -m mypy app
	cd $(FRONTEND_DIR) && npm run lint
