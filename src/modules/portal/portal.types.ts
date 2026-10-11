/**
 * Identity attached to a request once portalAuthenticate() succeeds.
 * Deliberately NOT req.auth / req.orgContext: a client contact is a
 * separate security principal from an internal user, so internal and
 * client request contexts can never be mistaken for one another.
 */
export interface ClientRequestContext {
  contactId: string;
  organizationId: string;
  clientOrganizationId: string;
  sessionId: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      client?: ClientRequestContext;
    }
  }
}

export {};
