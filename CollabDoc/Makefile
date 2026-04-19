.PHONY: install install-backend install-frontend dev dev-backend dev-frontend test test-backend test-frontend test-e2e lint

BACKEND_DIR := backend
FRONTEND_DIR := frontend
BACKEND_PYTHON := $(BACKEND_DIR)/.venv/bin/python
BACKEND_PORT := 8000
FRONTEND_PORT := 5173

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
	@backend_listen="$$(lsof -nP -iTCP:$(BACKEND_PORT) -sTCP:LISTEN 2>/dev/null)"; \
	if [ -n "$$backend_listen" ]; then \
		echo "Backend already running on http://localhost:$(BACKEND_PORT):"; \
		echo "$$backend_listen"; \
	else \
		echo "Starting backend on http://localhost:$(BACKEND_PORT)"; \
		cd $(BACKEND_DIR) && ./.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port $(BACKEND_PORT); \
	fi

dev-frontend:
	@frontend_listen="$$(lsof -nP -iTCP:$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null)"; \
	if [ -n "$$frontend_listen" ]; then \
		echo "Frontend already running on http://localhost:$(FRONTEND_PORT):"; \
		echo "$$frontend_listen"; \
	else \
		echo "Starting frontend on http://localhost:$(FRONTEND_PORT)"; \
		cd $(FRONTEND_DIR) && npm run dev; \
	fi

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
