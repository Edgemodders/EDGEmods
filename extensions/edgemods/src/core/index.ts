// The extension's core: no VS Code imports, so the MCP server (R4d) and the tests use it as it is.
export { authorizeUrl, challengeOf, exchangeCode, pkce, refreshTokens, revokeToken, SignedOutError, type AuthInfo, type Fetch, type Method, type Tokens } from './auth.js';
export {
  Api, ApiError, imagePath, MOD_TABS, REPORT_REASONS, siteOf, SORTS,
  type Card, type Me, type ModInfo, type ModPage, type ModRelease, type ModTab, type ReportReason, type SearchQuery, type SearchResult, type Sort,
} from './api.js';
export { parseLink, type InstallLink } from './links.js';
export { pageLink, type PageLink } from './pagelinks.js';
export { htmlText, installPlan, INSTRUCTIONS, modInfo, searchMods, type ToolResult } from './tools.js';
export { EDITOR_SCHEMES, Session, SIGN_IN_WAIT_MS, type Account, type SecretStore } from './session.js';
export { USERNAME_PATTERN, USERNAME_RULE } from './usernames.js';
