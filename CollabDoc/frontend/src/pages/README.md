# `src/pages/`

Top-level route components. Routing is configured in `App.tsx`; each page is
responsible for its own data fetching and layout.

| Route | Page | Notes |
|-------|------|-------|
| `/login`, `/register` | `Login.tsx`, `Register.tsx` | Both propagate `location.state.from` so a share-link redirect completes after auth. |
| `/` | `Dashboard.tsx` | List accessible documents, create new. |
| `/documents/:id` | `DocumentPage.tsx` | Editor + toolbar + presence + share modal + AI panel + version history drawer. |
| `/share/:token` | `ShareRedeem.tsx` | Public landing for share links. Unauthed users are bounced to `/login` with `from` state; authed users call `POST /documents/share-links/:token/redeem` and are navigated to the document. |
| `*` | `NotFound.tsx` | 404. |

Protected routes are wrapped in `components/ProtectedRoute.tsx`.
