import { env, type OAuthProviderConfig } from "../../../config/env.js";
import type { AuthProvider } from "../../../generated/prisma/client.js";

export const OAUTH_PROVIDER_IDS = ["google", "github"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  /** True only when the PROVIDER says it verified the address. Anything else must not link or create accounts. */
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

interface ProviderDefinition {
  dbProvider: AuthProvider;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  config: () => OAuthProviderConfig | undefined;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

const REQUEST_TIMEOUT_MS = 10_000;

async function getJson(url: string, accessToken: string, extraHeaders: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...extraHeaders },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // Status only: provider bodies can contain personal data.
  if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}`);
  return response.json();
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const PROVIDERS: Record<OAuthProviderId, ProviderDefinition> = {
  google: {
    dbProvider: "GOOGLE",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    config: () => env.oauth.google,
    async fetchProfile(accessToken) {
      const data = (await getJson("https://openidconnect.googleapis.com/v1/userinfo", accessToken)) as Record<string, unknown>;
      const sub = str(data["sub"]);
      if (!sub) throw new Error("Google profile has no subject");
      return {
        providerAccountId: sub,
        email: str(data["email"]),
        emailVerified: data["email_verified"] === true,
        name: str(data["name"]) ?? "",
        avatarUrl: str(data["picture"]),
      };
    },
  },
  github: {
    dbProvider: "GITHUB",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    config: () => env.oauth.github,
    async fetchProfile(accessToken) {
      const headers = { Accept: "application/vnd.github+json", "User-Agent": "AgencyOps" };
      const user = (await getJson("https://api.github.com/user", accessToken, headers)) as Record<string, unknown>;
      const id = user["id"];
      if (typeof id !== "number" && typeof id !== "string") throw new Error("GitHub profile has no id");

      // The public profile email is user-editable and unverified; only trust /user/emails.
      const emails = (await getJson("https://api.github.com/user/emails", accessToken, headers)) as unknown;
      const list = Array.isArray(emails) ? (emails as Record<string, unknown>[]) : [];
      const verified = list.filter((e) => e["verified"] === true && str(e["email"]));
      const chosen = verified.find((e) => e["primary"] === true) ?? verified[0];

      return {
        providerAccountId: String(id),
        email: chosen ? str(chosen["email"]) : null,
        emailVerified: chosen !== undefined,
        name: str(user["name"]) ?? str(user["login"]) ?? "",
        avatarUrl: str(user["avatar_url"]),
      };
    },
  },
};

export function getProvider(id: OAuthProviderId): ProviderDefinition {
  return PROVIDERS[id];
}

export function redirectUriFor(id: OAuthProviderId): string {
  return `${env.oauth.apiPublicUrl}/api/v1/auth/oauth/${id}/callback`;
}

/** Exchanges the authorization code (+ PKCE verifier) for an access token. */
export async function exchangeCode(id: OAuthProviderId, code: string, codeVerifier: string): Promise<string> {
  const provider = PROVIDERS[id];
  const config = provider.config();
  if (!config) throw new Error("Provider is not configured");

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUriFor(id),
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Token exchange failed with HTTP ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const accessToken = str(body["access_token"]);
  if (!accessToken) throw new Error("Token exchange returned no access token");
  return accessToken;
}
