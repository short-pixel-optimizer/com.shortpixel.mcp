/**
 * Transient mapping from an oidc-provider accountId (set to the ShortPixel
 * user id) to the account details needed to mint claims/tokens: the user's
 * current ShortPixel API key, resolved once via the com.shortpixel.www
 * internal exchange endpoint right after they approve the consent screen.
 *
 * In-memory by design for this first version, matching oidc-provider's own
 * default (in-memory) grant/session storage: nothing here is more fragile
 * than what the AS already relies on. A restart drops active flows/tokens
 * equally either way. Move both to a shared store (e.g. Redis) together if
 * that stops being acceptable.
 */

export interface OauthAccount {
  userId: number;
  apiKey: string;
}

const accounts = new Map<string, OauthAccount>();

export function storeAccount(account: OauthAccount): void {
  accounts.set(String(account.userId), account);
}

export function getAccount(accountId: string): OauthAccount | undefined {
  return accounts.get(accountId);
}
