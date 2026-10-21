# AgencyOps API

Operations-management backend for small software agencies — clients, teams, projects, sprints, tasks, collaboration, a client portal and payments in one multi-tenant SaaS.

## Key Features

- Multi-tenant organizations with role-based access control (OWNER / MANAGER / TEAM_MEMBER) and strict tenant isolation
- Email/password auth (bcrypt), Google/GitHub OAuth, JWT access tokens, HttpOnly-cookie refresh tokens with rotation + reuse detection, email verification, password reset, session management
- Invitations, Teams, Projects (with stats), Sprints, Tasks (subtasks, collaborators), Comments with @mentions
- In-app + email notifications with per-type preferences, organization activity feed
- File attachments (Cloudinary), client portal (separate identity/boundary), client invoices with Stripe Checkout, PDF invoices, platform subscription (FREE/PRO)
- Background jobs (BullMQ): email delivery, invoice PDFs
- Rate limiting, Helmet, strict CORS, centralized error handling

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design rationale and [docs/FRONTEND_CONTRACT.md](./docs/FRONTEND_CONTRACT.md) for the contract the web app builds against.

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22+ (24 supported), TypeScript (strict) |
| Framework | Express 5 |
| Database | PostgreSQL, Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) |
| Queue | Redis + BullMQ (separate worker process) |
| Auth | `bcryptjs`, JWT (`jose`), `cookie-parser` |
| Validation | Zod |
| Payments / Email / Files | Stripe, Resend, Cloudinary |
| Tests | Vitest + supertest |

## Setup

### Prerequisites
Node.js 22+, PostgreSQL, Redis (Docker: `docker run -d -p 6379:6379 redis`, or a free Upstash database).

### 1. Install and configure
```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL, REDIS_URL and the two JWT secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # run twice: one per JWT secret
```
Stripe / Resend / Cloudinary / OAuth variables are optional locally — the related endpoints return 503 (or log, for email) until set. Every variable is documented in `.env.example`.

### 2. Database
```bash
npx prisma generate --config prisma7.config.ts
npm run migrate:deploy
```

### 3. Run
```bash
npm run dev       # API on http://localhost:5000  (GET /api/v1/health)
npm run worker    # second terminal: sends emails, renders invoice PDFs
```

### Scripts
| Script | Purpose |
|---|---|
| `npm run dev` / `npm run worker` | API / worker with reload |
| `npm run build` → `npm start` / `npm run start:worker` | compiled production run |
| `npm run migrate:deploy` | apply committed migrations (safe for production) |
| `npm run seed` / `npm run seed -- --reset` | demo data (below) |
| `npm run typecheck`, `npm test` | type check, test suite (needs a separate test database, see `.env.test`) |

## Demo Data

```bash
npm run seed              # idempotent: running twice changes nothing
npm run seed -- --reset   # removes ONLY the demo organization + demo users, then rebuilds with fresh dates
```
Deployed (compiled) environment: `npm run seed:built`. In `NODE_ENV=production` the script refuses to run unless `ALLOW_SEED_IN_PRODUCTION=true` — the demo password is public, so only seed a public demo deployment. Override the shared password with `SEED_DEMO_PASSWORD`.

Organization **Brightline Studio** (slug `brightline-studio`), Pro plan, with 3 projects (active / overdue / completed), sprints (completed, active, planned), ~25 tasks across all statuses, subtasks, comments with @mentions, activity feed, notifications, a client organization with a portal contact, invoices (paid, open, draft), a client thread, shared file, request and project updates. Demo accounts never receive e-mail.

| Role | Email | Password |
|---|---|---|
| OWNER | `owner@demo.agencyops.test` | `DemoPass123!` |
| MANAGER | `manager@demo.agencyops.test` | `DemoPass123!` |
| TEAM_MEMBER | `member@demo.agencyops.test` | `DemoPass123!` |
| Client portal | `client@demo.agencyops.test` (organization slug `brightline-studio`) | `DemoPass123!` |

Extra team members (`sara@…`, `imran@…`) exist for realistic assignees.

## Payments (Stripe test mode)

Set `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`. Locally:
```bash
stripe listen --forward-to localhost:5000/api/v1/webhooks/stripe   # prints the whsec_… to use
```
Test card `4242 4242 4242 4242`, any future expiry, any CVC (declined: `4000 0000 0000 0002`). Browser redirects are never trusted: state only changes from the signature-verified webhook. Checkout returns to `FRONTEND_URL/payment/success|cancel` (see the frontend contract).

## Deployment

A [`render.yaml`](./render.yaml) blueprint defines a **web service** (API) and a **worker**. Checklist:

1. Create PostgreSQL and Redis (Render Key Value / Upstash). Set `DATABASE_URL`, `REDIS_URL`.
2. Set `NODE_ENV=production`, `TRUST_PROXY=1`, both JWT secrets, `FRONTEND_URL`, `CORS_ORIGIN` (exact web-app origin, no trailing slash) and `API_PUBLIC_URL`.
3. Frontend on a **different site** than the API (e.g. Vercel + Render): set `REFRESH_TOKEN_COOKIE_SAME_SITE=none` (cookie is `Secure` in production) and have the frontend send `credentials: "include"`. Same site (shared parent domain) → `lax`.
4. Migrations run as the web service's pre-deploy command (`npm run migrate:deploy`).
5. The **worker must be running** or emails and invoice PDFs never go out. It needs an always-on instance.
6. Stripe dashboard: add webhook endpoint `<API_PUBLIC_URL>/api/v1/webhooks/stripe` (events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`), copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
7. Optionally seed a demo (`ALLOW_SEED_IN_PRODUCTION=true npm run seed:built`).

## API Documentation

Postman collection + environment in [`postman/`](./postman). Run **Auth → Login** first; it saves `accessToken` for later requests. Endpoint-level contract with examples: [docs/FRONTEND_CONTRACT.md](./docs/FRONTEND_CONTRACT.md).

## Security (summary)

Every organization-scoped query is filtered by `organizationId` server-side (404 for non-members); permissions come from one static matrix (`src/modules/rbac/permissions.ts`); tokens are hashed at rest; generic auth errors; rate limits (auth 10/15 min, API 1000/15 min per IP); Helmet; strict CORS; no internals in error responses. Details in ARCHITECTURE.md → Security Hardening.

## Not implemented

AI assistant (parked), plan-limit enforcement, refunds, Stripe Connect, invoice e-mailing.
