.PHONY: install install-backend install-frontend dev dev-backend dev-frontend test test-backend test-frontend lint

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

# ── Lint ──────────────────────────────────────────────────────────────────────

lint:
	cd backend && ruff check . && mypy app
	cd frontend && npm run lint
