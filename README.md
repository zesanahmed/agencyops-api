# AgencyOps API

Operations-management backend for small software agencies — clients, teams, projects, sprints, tasks, and collaboration in one multi-tenant SaaS.

## Key Features

- Multi-tenant organizations with role-based access control (OWNER / MANAGER / TEAM_MEMBER)
- Email/password authentication: Argon2id hashing, short-lived JWT access tokens, HttpOnly-cookie refresh tokens with rotation and reuse detection
- Organization invitations (token-based, one-time use, expiring)
- Teams, Projects, Sprints, Tasks (with one-level subtasks and collaborators)
- Comments with @mentions and in-app notifications
- Centralized, whitelisted RBAC permission matrix (no scattered role checks)
- Strict tenant isolation on every organization-scoped resource

## Architecture

Modular monolith — see [ARCHITECTURE.md](./ARCHITECTURE.md) for module boundaries, request flow, and the full design rationale.

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24, TypeScript (strict) |
| Framework | Express 5 |
| Database | PostgreSQL, Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) |
| Cache/Queue | Redis, BullMQ (infrastructure in place; not yet used by a feature) |
| Auth | Argon2id (`argon2`), JWT (`jose`), `cookie-parser` |
| Validation | Zod |

## Setup

### Prerequisites
- Node.js 24+
- A PostgreSQL database
- A Redis instance (see below for a no-install option)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Then fill in `.env`:

**`DATABASE_URL`** — your Postgres connection string, e.g.
`postgresql://user:password@localhost:5432/agencyops`

**`REDIS_URL`** — a running Redis instance. Easiest without installing anything locally: create a free database at [Upstash](https://upstash.com) and copy its connection URL. (Docker alternative: `docker run -d -p 6379:6379 redis` → `redis://127.0.0.1:6379`.)

**`JWT_ACCESS_SECRET`** / **`JWT_REFRESH_SECRET`** — two different random strings:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Run twice, use one output for each variable. Never reuse the same value for both.

Everything else in `.env.example` has a safe default — copy as-is.

### 3. Database
```bash
npx prisma generate --schema prisma/prisma-schema
npx prisma migrate deploy --schema prisma/prisma-schema
```

### 4. Run
```bash
npm run dev
```
Health check: `GET http://localhost:5000/api/v1/health`

### Other scripts
```bash
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
npm start            # run the compiled build
```

## API Documentation

Postman collection + environment: [`postman/`](./postman). Import both files into Postman, select the "AgencyOps Local" environment, and run **Auth → Register** first — it auto-saves `accessToken` into the environment for every subsequent request.

## Authentication

- `POST /api/v1/auth/register`, `/login` — returns an access token in the response body and sets an HttpOnly refresh-token cookie
- `POST /api/v1/auth/refresh` — rotates the refresh token (reused/stale tokens are detected and the session is revoked)
- `POST /api/v1/auth/logout`, `/logout-all`
- `GET /api/v1/auth/me`
- Protected routes: `Authorization: Bearer <accessToken>`

## Roles & Authorization

Three fixed roles per organization — **OWNER**, **MANAGER**, **TEAM_MEMBER**. Permissions are a static, centralized matrix (`src/modules/rbac/permissions.ts`), enforced on every organization-scoped route via `loadOrganizationContext()` + `requirePermission()`. A user's role in one organization has no bearing on another — memberships are fully per-organization.

## Security

- Argon2id password hashing; SHA-256 hashing for refresh/invitation tokens (never stored raw)
- Refresh tokens: HttpOnly, `SameSite=Strict`, `Secure` in production, rotated on every use, reuse triggers session revocation
- Generic auth error messages (no account/session enumeration)
- Every list/detail/write endpoint scoped by `organizationId` server-side — a caller can never reach another tenant's data by guessing an id
- Centralized error handling; no stack traces or internals leaked in responses

## Deployment

Not yet configured — planned for a later milestone.

## Demo Credentials

Not yet seeded — planned for a later milestone.

## Notes on Current Scope

Implemented through Organization/RBAC, Invitations, Teams, Projects, Sprints, Tasks, Comments/Mentions, and in-app Notifications. Not yet implemented: file uploads, client portal, payments, invoice PDFs, AI assistant, OAuth, email verification/password reset, automated test suite, rate limiting, and deployment — see [ARCHITECTURE.md](./ARCHITECTURE.md) for what's planned.
