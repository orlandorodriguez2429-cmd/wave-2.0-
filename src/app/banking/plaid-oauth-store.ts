// The Link session saved before Plaid Link opens, so the OAuth return page can
// resume it after the bank's own sign-in page sends the user back. Holds only
// the short-lived link token (no access token, no bank data). Tab-scoped.
export interface SavedLinkSession {
  linkToken: string;
  audience: 'staff' | 'client';
  reconnectConnectionId: string | null;
  returnTo: string;
}
const KEY = 'yts.plaidLink';

export function rememberLinkSession(s: SavedLinkSession) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: OAuth return will ask the user to start again */
  }
}

export function takeLinkSession(): SavedLinkSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as SavedLinkSession) : null;
  } catch {
    return null;
  }
}
