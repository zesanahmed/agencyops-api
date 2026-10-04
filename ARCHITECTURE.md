# AgencyOps — Architecture

## Style: Modular Monolith

One deployable Express app, organized into self-contained feature modules under `src/modules/`. Not microservices — no network hops between modules, no separate deployments. Each module owns its own routes/controller/service/validation/mappers and talks to other modules only through their exported service functions (never reaching into another module's Prisma queries directly), which is what keeps this from decaying into a tangle despite being one process.

```
src/
├── app/            app assembly (app.ts, api-v1.router.ts) — no business logic
├── config/         env, cookies
├── errors/         AppError
├── lib/            prisma client, redis client, response helpers
├── middlewares/     validate, errorHandler, notFoundHandler
├── modules/
│   ├── auth/         register, login, sessions, JWT, password hashing
│   ├── organization/  organizations + memberships
│   ├── rbac/          permission matrix + middleware
│   ├── invitation/    org invitations (token-based)
│   ├── team/          teams + team members
│   ├── project/       projects + project-team/member assignment
│   ├── sprint/        sprints, nested under projects
│   ├── task/          tasks, subtasks, collaborators, nested under projects
│   ├── comment/       comments + mentions, nested under tasks
│   └── notification/  in-app notifications + preferences
└── generated/prisma/  Prisma-generated client (checked in — see note below)
```

Each module follows the same internal shape:
- `*.routes.ts` — wiring only (validation middleware → RBAC middleware → controller)
- `*.controller.ts` — HTTP concerns: read `req`, call the service, shape the response via `sendSuccess`
- `*.service.ts` — business logic and all database access
- `*.validation.ts` — Zod schemas
- `*.mappers.ts` — DB row → safe API response shape (strips internal/sensitive fields)

## Request Flow

```
Request
  → express.json() / cookie-parser
  → validate(schema)              — Zod, rejects with 400 on failure
  → authenticate                  — auth routes only: verifies access JWT, sets req.auth
  → loadOrganizationContext()     — org-scoped routes: resolves { organization, membership }
                                     from :organizationId + req.auth.userId, 404s if not a member
  → requirePermission(permission) — checks membership.role against the static permission matrix
  → controller
  → service (Prisma)
  → sendSuccess / thrown AppError → errorHandler
```

Every organization-scoped route follows `loadOrganizationContext()` → `requirePermission()` before reaching business logic — authorization is never left to the controller/service to remember.

## Authentication

Short-lived JWT access token (stateless verification, no DB hit per request) + long-lived refresh token, represented server-side by a `Session` row storing only a SHA-256 hash of the refresh token. Access and refresh tokens are signed with **separate** secrets. Refresh rotates on every use; a presented token that doesn't match the session's current hash is treated as reuse and the session is revoked immediately. See `src/modules/auth/` — `token.service.ts` (JWT), `auth.utils.ts` (Argon2id + token hashing), `session.service.ts` (session persistence/rotation), `auth.service.ts` (register/login/refresh/logout orchestration).

## Authorization (RBAC)

Three roles per organization membership: `OWNER`, `MANAGER`, `TEAM_MEMBER`. `src/modules/rbac/permissions.ts` is a flat, static `Record<Role, Permission[]>` — no inheritance, no per-org overrides, no rules engine. Adding a permission means adding one string to the array; there's no scattered `if (role === "OWNER")` anywhere in a controller. `loadOrganizationContext()` resolves the caller's membership for the `:organizationId` in the URL (404 if none — never leaks whether the org exists to a non-member); `requirePermission(p)` then checks that membership's role against the matrix.

## Multi-Tenancy

Every organization-owned table carries `organizationId` (directly, or transitively — a `Task` belongs to a `Project` which belongs to an `Organization`). Every service function that touches such a resource takes the caller's `organizationId` from `req.orgContext` (never from a client-supplied body field) and includes it in the `WHERE` clause of every read/write — a resource lookup by id alone, without the organization filter, does not happen anywhere in this codebase. This is what stops a member of Organization A from reaching Organization B's data by guessing/editing an id in the URL.

One caveat, worth being explicit about: cross-entity assignment (assigning a `Team` to a `Project`, or a `Membership` as a task assignee) is validated by checking each side belongs to the *same* organization at write time — there's no database constraint that would catch it structurally, so this is an application-layer guarantee, not a schema-enforced one.

## Database

PostgreSQL + Prisma 7, using the newer `prisma-client` generator (not the legacy `prisma-client-js`) with `@prisma/adapter-pg` — Prisma 7 requires an explicit driver adapter rather than a URL embedded in the schema's datasource block. The generated client output is **checked into git** (`src/generated/prisma/`) rather than gitignored — Prisma 7's new generator emits TypeScript source (not prebuilt JS) that the project's own `tsc` compiles as part of the normal build, and it has to live inside `src/` (not project-root `generated/`) for that compilation to work under this project's `rootDir` setting.

One documented quirk: Prisma 7's own exported `Prisma.TransactionClient` type has a real defect in this project's generated output (traced to `internal/class.ts` hardcoding a bare, non-instantiated `PrismaClient` reference in `$transaction`'s own declaration) — model delegates like `.user`/`.session` are missing from that type. The workaround used throughout this codebase, wherever a transaction is needed: accept a plain callback for the write operation rather than trying to type/pass the transaction client itself (see `session.service.ts`'s `createSessionRecord` parameter for the clearest example), or where a `tx` object must be used directly, an explicit `tx as unknown as Pick<typeof prisma, "modelName">` narrowing cast (never a broad `as any`).

Soft deletes (`deletedAt`) on long-lived business records (`User`, `Organization`, `Project`, `Task`, `Team`) — never hard-deleted. Hard deletes only for pure join/junction rows (`TeamMember`, `ProjectMember`, `ProjectTeam`, `TaskCollaborator`) where there's no history worth preserving.

## Redis / BullMQ

Infrastructure exists (`src/lib/redis.ts`, `src/lib/queue.ts`) but nothing currently uses it — no feature has needed an async job yet. Planned consumers: invitation/notification emails, invoice PDF generation.

## Email

Not yet implemented. Planned provider: Resend, dispatched via BullMQ so email delivery never blocks a request.

## File Storage

Not yet implemented. Planned: Multer (upload handling) → Cloudinary (storage) → Postgres stores only metadata (URL, public id, uploader, size), never the binary.

## Payments

Not yet implemented. Planned: Stripe, with webhook signature verification and idempotent webhook handling — a client-reported "payment succeeded" is never trusted on its own.

## AI / RAG

Not yet implemented. Planned to sit strictly behind the same authorization layer as everything else — the AI assistant must never be able to retrieve a project/organization the requesting user couldn't already access directly.

## Client Portal

Not yet implemented. Planned as a genuinely separate security boundary from internal organization membership (not a fourth `MembershipRole`) — a client contact is not an organization member and must be authorized per-resource, explicitly.

## Deployment

Not yet configured.
