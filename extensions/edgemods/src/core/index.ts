// The extension's core: no VS Code imports, so the MCP server (R4d) and the tests use it as it is.
export { authorizeUrl, challengeOf, exchangeCode, pkce, refreshTokens, revokeToken, SignedOutError, type AuthInfo, type Fetch, type Method, type Tokens } from './auth.js';
export { Api, ApiError, siteOf, type Me } from './api.js';
export { parseLink, type InstallLink } from './links.js';
export { Session, SIGN_IN_WAIT_MS, type Account, type SecretStore } from './session.js';
export { USERNAME_PATTERN, USERNAME_RULE } from './usernames.js';
