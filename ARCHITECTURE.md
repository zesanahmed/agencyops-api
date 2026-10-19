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

Short-lived JWT access token (stateless verification, no DB hit per request) + long-lived refresh token, represented server-side by a `Session` row storing only a SHA-256 hash of the refresh token. Access and refresh tokens are signed with **separate** secrets. Refresh rotates on every use; a presented token that doesn't match the session's current hash is treated as reuse and the session is revoked immediately. Passwords are hashed with bcrypt (`bcryptjs`, cost 12). See `src/modules/auth/` — `token.service.ts` (JWT), `auth.utils.ts` (hashing), `session.service.ts` (session persistence/rotation), `auth.service.ts` (register/login/refresh/logout), `account.service.ts` (verification, reset, password change, sessions, deletion), `auth-token.service.ts` (one-time emailed tokens), `oauth/` (Google/GitHub).

**One-time emailed tokens** (email verification 24 h, password reset 1 h): 32 random bytes, only the SHA-256 hash is stored (`AuthToken`). Issuing a new one invalidates older unused ones. Spending is a single conditional `UPDATE … WHERE unused AND unexpired AND type = …`, inside the same transaction as its effect, so a link works once even under concurrent requests; unknown/expired/used/wrong-type all return the same 400.

- **Email verification:** registration queues the email; login is *not* blocked while unverified (`emailVerifiedAt` is exposed on `/auth/me` for the frontend to nag). Resend is authenticated.
- **Forgot/reset password:** `forgot-password` always returns the same 200, whoever asks. A successful reset sets the password, marks the mailbox verified, and revokes **all** sessions. It also lets an OAuth-only account add a password.
- **Change password:** needs the current password, rejects reuse, revokes all sessions (re-login required).
- **Sessions:** list your active sessions, revoke one (own sessions only; someone else's id is a 404).
- **Account deletion (soft):** needs the password (not for accounts without one); refused while the user owns an active organization. Sets `deletedAt`, anonymizes the email so the address can sign up again (name is kept so comments/audit history stay readable), removes password/OAuth links/tokens, marks memberships `REMOVED`, revokes sessions.
- Access tokens are stateless, so after a revoke an already-issued access token stays valid until it expires (15 min default); organization routes still re-check membership on every request.

**OAuth (Google, GitHub)** — server-side authorization-code flow, no SDK. `GET /auth/oauth/:provider` redirects to the provider with a random `state` and a PKCE challenge; the matching secrets live in a 10-minute HttpOnly `SameSite=Lax` cookie (Lax, not Strict, because the provider returns via a cross-site navigation). The callback checks state against the cookie (constant-time, bound to the provider, one attempt per cookie), exchanges the code with the PKCE verifier, and redirects to `FRONTEND_URL/oauth/callback` — success sets the normal refresh cookie (the SPA then calls `POST /auth/refresh` for its access token), failure carries only a fixed `?error=` code. Account rules: a known `(provider, id)` signs that user in; otherwise the **provider must vouch for the email** (Google `email_verified`; GitHub only a verified address from `/user/emails`, never the public profile email) or nothing is linked or created; a verified match links to the existing user; no match creates a passwordless, verified user. **Pre-hijacking defence:** if the matched local account was never email-verified, linking discards its (unproven) password and revokes its sessions. Not implemented: unlinking a provider (when added it must refuse to remove the last usable sign-in method).

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

`src/lib/redis.ts` (shared ioredis connection) and `src/lib/queue.ts` (`createQueue`). Two queues run today: `invoice-pdf` and `email`. Queues are created lazily on first enqueue, so the API (and its tests) never touch Redis until something is queued; enqueue has a 3 s timeout and the "quiet" variants never fail the request that triggered them. Workers live in `src/jobs/*` and are started by one separate process (`npm run worker` in dev, `npm run start:worker` after `npm run build`) — **the API alone only enqueues; mail and PDFs are produced by the worker.**

## Email

`src/modules/email`: `email.provider.ts` is the only file that knows Resend (a plain `fetch` to the Resend REST API — no SDK); `email.templates.ts` turns a typed `EmailJob` into subject/HTML/text (all dynamic text HTML-escaped); `email.queue.ts` enqueues; `src/jobs/email.worker.ts` delivers.

- **Jobs:** `ORGANIZATION_INVITATION`, `CLIENT_PORTAL_INVITE`, `NOTIFICATION`. 5 attempts with exponential backoff; the BullMQ job id is sent to Resend as `Idempotency-Key`, so a retried job cannot send twice.
- **Tokens.** Invite emails carry a raw one-time token, so jobs hold it in Redis. Completed jobs are removed immediately and failed ones after 24 h. Tokens, email bodies and job payloads are never logged — failures log only the status/job type.
- **No key configured:** in development the worker just logs recipient + subject (never the body); in production the job fails loudly instead of silently dropping mail. `RESEND_API_KEY` and `EMAIL_FROM` are the only settings. Resend's default `onboarding@resend.dev` sender can only deliver to the Resend account owner; a verified domain is needed for real recipients.
- **Invite tokens in API responses.** While `RESEND_API_KEY` is unset, invitation / client-invite responses still include the raw token so the flow can be tried locally. Once Resend is configured the token reaches the invitee by email only.
- **Links** point at the frontend (`FRONTEND_URL`): `/invitations/accept?token=…` and `/portal/accept-invite?token=…` (constants in `email.templates.ts`; they must match agencyops-web).

### Notifications

`notifyMemberships` (`notification/notification.service.ts`) is the single place a business event becomes notifications. Callers decide who to notify; it re-checks that every recipient is an active member of the organization, then honours each recipient's per-type preference **separately per channel** (in-app row, email job — both default on). `notifyInternal` (client activity, invoice events) and comment mentions go through it. Mention delivery now happens after the comment commits, and an author is not notified about mentioning themselves. Not implemented: a task-assignment notification, digest/batching of emails.

## File Storage

Not yet implemented. Planned: Multer (upload handling) → Cloudinary (storage) → Postgres stores only metadata (URL, public id, uploader, size), never the binary.

## Payments

Stripe, in two independent flows. **A payment status reported by the browser (the success redirect) is never trusted** — state only changes from a signature-verified webhook.

- **Platform subscription** (`src/modules/billing/`, `billing.prisma`): an organization is on `FREE` or `PRO` (`Plan`, `PlatformSubscription`, rows created lazily; plans are upserted from code in `billing.plans.ts`). `POST /organizations/:id/billing/checkout` (OWNER) creates a Stripe Checkout Session in subscription mode and a Stripe customer; the plan changes only when `customer.subscription.*` / `checkout.session.completed` events arrive. `PAST_DUE` keeps `PRO` (grace period); `CANCELED`/`INCOMPLETE` fall back to `FREE`. Plan limits (`maxMembers`, `maxProjects`) are stored and returned but **not enforced yet**.
- **Client invoices** (`src/modules/invoice/`): staff create/edit (DRAFT only)/send/void invoices (`invoice:*` permissions, OWNER/MANAGER). Money is integer cents; totals are computed server-side; numbers are `INV-0001` per organization (unique constraint + retry). A client contact lists/views non-draft invoices of their own client organization (project-linked invoices also need a `ClientProjectAccess` grant) and starts `POST /portal/invoices/:id/checkout`, which charges the amount stored in the database and records a `PENDING` `ClientInvoicePayment`.
- **Webhook** (`POST /api/v1/webhooks/stripe`, `src/modules/webhook/`): mounted before `express.json()` so the raw body can be verified (`constructWebhookEvent`). Every event id is stored once in `WebhookEvent` (unique `(provider, eventId)`) — duplicates are acknowledged without reprocessing; an event that failed midway is retried by Stripe. State transitions use conditional `updateMany` inside transactions, subscription events are ordered by `lastStripeEventAt`, and a paid amount/currency that does not match the invoice is recorded as `FAILED` instead of marking it paid. Money arriving for a voided/already-paid invoice is flagged via audit log + notification for manual refund.
- **Decision (flag for review):** client payments go to the **platform's single Stripe account** (no Stripe Connect). All Stripe calls go through `src/lib/stripe.ts`, so Connect can be added later without touching handlers.
- **Config**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `FRONTEND_URL` (see `.env.example`). Without them payment endpoints return 503; the app still boots.
- **Invoice PDF** (`invoice.pdf.ts`, `invoice.pdf.service.ts`, `invoice.queue.ts`, `src/jobs/invoice-pdf.worker.ts`): PDFKit (pure JS, no native binaries) renders the invoice; a BullMQ job (`invoice-pdf`, 3 attempts, exponential backoff) uploads it to Cloudinary and stores `pdfUrl`/`pdfPublicId`/`pdfGeneratedAt` on the invoice. Jobs are queued after the business change commits — when an invoice is **sent**, **paid** (webhook) or **voided** — and are fire-and-forget: a Redis outage never fails the request, and `POST /organizations/:id/invoices/:invoiceId/pdf` (OWNER/MANAGER) re-queues generation. Generation is idempotent (re-renders from the database, replaces the stored asset, deletes the old one); drafts and missing invoices are skipped. The API process only enqueues — **a separate worker process must run** (`npm run worker` in dev, `npm run start:worker` after `npm run build`). `pdfUrl` is returned to authorized staff and the owning client contact only; it is an unguessable Cloudinary URL, not an authenticated one. Limitation: built-in Helvetica means Latin text only (e.g. Bengali is not rendered until a Unicode font is bundled).
- **Not in this milestone**: refunds, emailing invoices.

## AI / RAG

Not yet implemented. Planned to sit strictly behind the same authorization layer as everything else — the AI assistant must never be able to retrieve a project/organization the requesting user couldn't already access directly.

## Client Portal

A genuinely separate security boundary from internal organization membership (not a fourth `MembershipRole`). A `ClientContact` is an external identity; it never has a `Membership`.

- **Data model** (`prisma/prisma-schema/client.prisma`): `ClientOrganization` → `ClientContact` (login identity, unique per `(organizationId, email)`), `ClientSession`, explicit `ClientProjectAccess` (contact × project), `ClientRequest`, `ProjectUpdate`, `ClientMessage`, `ClientFile`. `Project.clientOrganizationId` links a project to the client it is delivered for; `Task.clientVisible` (default `false`) controls which tasks clients see.
- **Auth** (`src/modules/portal/`): invite → accept (one-time hashed token, password set) → login (`organizationSlug` + email + password) with its own access/refresh tokens. Tokens use a distinct `type` claim (`client_access` / `client_refresh`) and a separate cookie (`<name>_client`, path `/api/v1/portal/auth`), so an internal token is rejected by the portal and vice versa. `portalAuthenticate` checks the database on every request (session, contact status, organization status), so disabling a contact or revoking access is immediate.
- **Authorization**: every project-scoped portal route runs `requireProjectAccess` — an explicit `ClientProjectAccess` grant, on a live project in the contact's own organization and linked to the contact's own client. Anything else is a 404.
- **Staff side**: `/organizations/:organizationId/clients/...` (client/contact/access management, `client:*` permissions) and `/organizations/:organizationId/client-portal/...` (task visibility, updates, message thread, shared files, request inbox, `client-portal:*` permissions). Access grants/revokes and contact/client disabling are written to `AuditLog`.
- **Client-facing responses** use dedicated minimal shapes: no assignees, collaborators, internal comments, organization ids or Cloudinary public ids.
- **Invoices/payments** are available in the portal (see Payments). **Not yet**: email delivery of invite links (the raw invite token is currently returned once to the staff member who creates the contact).

## Deployment

Not yet configured.
