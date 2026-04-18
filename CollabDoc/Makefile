.PHONY: install install-backend install-frontend dev dev-backend dev-frontend test test-backend test-frontend test-e2e lint

# ── Install ───────────────────────────────────────────────────────────────────

install: install-backend install-frontend

install-backend:
	cd backend && pip install -r requirements.txt

install-frontend:
	cd frontend && npm install

# ── Dev servers ───────────────────────────────────────────────────────────────

dev:
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

# ── Tests ─────────────────────────────────────────────────────────────────────

test: test-backend test-frontend

test-backend:
	cd backend && pytest -v

test-frontend:
	cd frontend && npm run test

# E2E tests require both servers. Playwright starts the frontend via its
# webServer config; backend must be running on :8000 beforehand.
test-e2e:
	cd frontend && npm run test:e2e

# ── Lint ──────────────────────────────────────────────────────────────────────

lint:
	cd backend && ruff check . && mypy app
	cd frontend && npm run lint
