/**
 * Full, validated payload of an access token. The `type` field is a
 * deliberate discriminant — without it, a refresh token would be
 * structurally identical to an access token and could be replayed as
 * one if it were ever presented to an access-token-only endpoint.
 */
export interface AccessTokenPayload {
  /** Subject — the User's id. */
  sub: string;
  /** Session id — ties this token back to a server-side Session record. */
  sid: string;
  type: "access";
}

/** Same shape as AccessTokenPayload, but for refresh tokens. */
export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: "refresh";
}

/**
 * The minimal, already-validated identity attached to a request
 * once authenticate() succeeds — just enough to identify who's
 * calling and which session, not the full token payload.
 */
export interface SessionContext {
  userId: string;
  sessionId: string;
}

// Declaration merging so `req.auth` is typed on every Express
// Request without needing a wrapper type or casts in route handlers.
// Optional, since not every request has been through authenticate()
// (or ever will — some routes are public).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionContext;
    }
  }
}
