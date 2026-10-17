type AuthLocation = { pathname: string; state?: unknown };

// Signing links use an opaque, URL-safe token in one path segment. Deliberately
// do not accept arbitrary return URLs, encoded separators, queries or fragments.
function validSigningPath(value: unknown): string | null {
  return typeof value === "string" && /^\/sign\/[A-Za-z0-9_-]{1,256}$/.test(value)
    ? value
    : null;
}

export function signingReturnPath(location: AuthLocation): string | null {
  const current = validSigningPath(location.pathname);
  if (current) return current;

  // Only the password-change route carries this state. Ignore unrelated router
  // history so a later ordinary login cannot reopen an old signing request.
  if (location.pathname !== "/change-password") return null;
  const state = location.state;
  return state !== null && typeof state === "object" && "signingReturnTo" in state
    ? validSigningPath(state.signingReturnTo)
    : null;
}

export function passwordChangeLocation(location: AuthLocation) {
  const returnTo = signingReturnPath(location);
  return {
    pathname: "/change-password",
    state: returnTo ? { signingReturnTo: returnTo } : null,
  };
}
