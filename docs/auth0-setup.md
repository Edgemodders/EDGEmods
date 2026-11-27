# Setting up Auth0

Sign-in for EDGEmods runs on Auth0. This page is the owner's checklist for the Auth0 dashboard and GitHub, written 2026-10-25 and checked against Auth0's docs that day. Do the **development** setup now: it is what R3c, accounts, is built and tested against. The production setup comes at R3h, deploy, and is listed at the end.

It takes about half an hour. Nothing on this page costs money.

**Secrets stay out of chats and git.** Client secrets go straight from the dashboard into a `.env` file on your PC, which git ignores. Claude never needs to see them. Domains and client ids are not secret; those you can share.

## What you will make

| Where | What | Used for |
|---|---|---|
| Auth0 | A tenant, `edgemods-dev` | Holds everything below, kept apart from TheLostRealms' tenant and from the live site |
| GitHub | An OAuth App, "EDGEmods (development)" | Lets people sign in with GitHub. Modders must, to publish |
| Auth0 | The application "EDGEmods website" | The website's sign-in |
| Auth0 | The API "EDGEmods API" | The VS Code extension's sign-in (R4); quick to add now |
| Auth0 | The application "EDGEmods server" | Lets the server change a person's own profile: their name, email, linked sign-ins, deleting their account |
| Your PC | A `.env` file | The values the server reads when it starts |
| Auth0 | The application "EDGEmods for VS Code" (step 9, added at R4) | The VS Code extension's sign-in |
| Auth0 | The application "EDGEmods in game" (step 10, added 2026-11-27) | The in-game browser's sign-in, with a code shown in the game |

## 1. The tenant

1. Sign in at https://manage.auth0.com. Open the tenant menu (top left), then **Create tenant**.
2. **Tenant domain:** `edgemods-dev`. If it is taken, pick another; tell Claude the domain you got.
3. **Region:** the US. A tenant's region cannot be changed later.
4. **Environment tag:** Development.
5. In the new tenant, **Settings** › **General**:
   - **Friendly name:** `EDGEmods (development)`
   - **Logo URL:** `https://edgemodders.github.io/EDGEmods/assets/brand/icon.png`
   - **Support email:** an address you read.

The tenant's domain is now something like `edgemods-dev.us.auth0.com`. Below, `YOUR_AUTH0_DOMAIN` means that.

## 2. Sign-in methods

### Email and password

1. **Authentication** › **Database** › `Username-Password-Authentication` (a new tenant has it).
2. Leave **Disable sign ups** off, and **Requires username** off.
3. **Password policy:** Good or stronger.

### Google

A new tenant has a Google connection that uses Auth0's own **developer keys**. For development that is enough: leave **Client ID** and **Client Secret** empty. Google's consent screen will say "Auth0" instead of EDGEmods; the live site needs its own keys (see the end).

1. **Authentication** › **Social** › **google-oauth2**. Leave the attributes at **Email address** and **Profile**.

### GitHub

GitHub needs an OAuth App first. Make it in the Edgemodders organisation, so people see "by Edgemodders" when they approve it:

1. On GitHub: **Edgemodders** organisation › **Settings** › **Developer settings** › **OAuth Apps** › **New OAuth App** (https://github.com/organizations/Edgemodders/settings/applications).
2. Fill in:

   | Field | Value |
   |---|---|
   | Application name | `EDGEmods (development)` |
   | Homepage URL | `https://edgemods.ai` |
   | Application description | `Sign in to EDGEmods, the EDGE mod registry for Cyberpunk 2077.` |
   | Authorization callback URL | `https://YOUR_AUTH0_DOMAIN/login/callback` |
   | Enable Device Flow | Off |

3. **Register application**. Copy the **Client ID**. Press **Generate a new client secret** and copy it at once: GitHub shows it only once.
4. Optional: upload `docs/assets/brand/icon.png` as the app's logo.

Then in Auth0:

1. **Authentication** › **Social** › **Create Connection** › **GitHub**.
2. Paste the **Client ID** and **Client Secret**.
3. **Attributes:** tick **Email address**.
4. **Permissions:** tick **read:user** only. Nothing else: signing in must never grant access to anyone's repositories. Publishing asks GitHub separately, in VS Code, and posting to Discussions asks separately too (R3g).
5. Leave **Sync user profile attributes at each login** on. **Create**.

Auth0 then knows a GitHub person by GitHub's numeric user id (`github|<id>`), which is how EDGEmods finds a modder's mods even after a rename.

## 3. The website application

1. **Applications** › **Applications** › **Create Application**.
2. **Name:** `EDGEmods website`. **Type:** Regular Web Applications. **Create**. Skip the quick start.
3. **Settings** tab:

   | Field | Value |
   |---|---|
   | Allowed Callback URLs | `http://localhost:8800/auth/callback` |
   | Allowed Logout URLs | `http://localhost:8800/` |
   | Allowed Web Origins | empty |
   | Allowed Origins (CORS) | empty |
   | Application Login URI | empty |

4. Same tab, **Advanced Settings** › **Grant Types**: keep **Authorization Code** only. Untick Implicit, Refresh Token and Client Credentials. The website keeps its own sessions, so it needs nothing else.
5. **Credentials** tab: **Authentication Method** Client Secret (Post), the default.
6. **Connections** tab: switch on `Username-Password-Authentication`, `google-oauth2` and `github`. Switch off anything else.
7. **Save**. From the **Settings** tab, keep the **Domain**, **Client ID** and **Client Secret** for step 7.

Port 8800 is EDGEmods' own: TheLostRealms uses 8787 and 8790 to 8794 on the same server.

## 4. The EDGEmods API

The VS Code extension (R4) signs in with an access token for this API. The website does not need it, but adding it now means no second visit.

1. **Applications** › **APIs** › **Create API**.
2. **Name:** `EDGEmods API`. **Identifier:** `https://edgemods.ai/api`. It is a name, not a web address that has to answer, and it cannot be changed later. **JSON Web Token profile:** Auth0. **Signing algorithm:** RS256.
3. Its **Settings** tab:
   - **Maximum access token lifetime / Token expiration:** `3600` (one hour; the extension renews it).
   - **Allow offline access:** on, so the extension can stay signed in.
   - **RBAC:** off.
4. **Save**.

## 5. The server's access to the Management API

Changing a person's name or email, linking their Google and GitHub sign-ins into one account, and deleting an account all go through Auth0's Management API. The server gets the fewest permissions that do this. A password change needs none: it uses Auth0's own reset email.

1. **Applications** › **Applications** › **Create Application**.
2. **Name:** `EDGEmods server`. **Type:** Machine to Machine Applications. **Create**.
3. **Select an API:** Auth0 Management API.
4. **Permissions:** tick only these three:

   | Permission | For |
   |---|---|
   | `read:users` | Reading a person's own profile and sign-in methods for the Profile tab |
   | `update:users` | Changing their name or email; linking and unlinking their sign-ins |
   | `delete:users` | "Delete my account" |

5. **Authorize**. From its **Settings** tab, keep the **Client ID** and **Client Secret** for step 7.

This application can read and change every account in the tenant, so its secret matters most. It lives only in `.env` on your PC, and later in `/etc/edgemods.env` on the server.

## 6. The login page's look

**Branding** › **Universal Login** › **Customization Options**, in the EDGE house style:

| Field | Value |
|---|---|
| Logo URL | `https://edgemodders.github.io/EDGEmods/assets/brand/icon.png` |
| Primary color | `#fcee0a` |
| Page background color | `#08090d` |

Leave **Security** › **Attack Protection** as it comes: bot detection, suspicious IP throttling and brute-force protection are on by default.

## 7. The settings file on your PC

Make a session secret: a random value the server uses to sign its short-lived sign-in cookie. In PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Then create a file named `.env` at the top of the EDGEmods checkout (`E:\Modding\Cyberpunk 2077\EDGEmods\.env`). git already ignores it. Fill in your values:

```ini
# EDGEmods on this PC. Never commit this file, never paste it into a chat.
EDGEMODS_AUTH0_DOMAIN=edgemods-dev.us.auth0.com
EDGEMODS_AUTH0_CLIENT_ID=the website application's client id
EDGEMODS_AUTH0_CLIENT_SECRET=the website application's client secret
EDGEMODS_AUTH0_AUDIENCE=https://edgemods.ai/api
EDGEMODS_AUTH0_MANAGEMENT_CLIENT_ID=the server application's client id
EDGEMODS_AUTH0_MANAGEMENT_CLIENT_SECRET=the server application's client secret
EDGEMODS_SESSION_SECRET=the value from the command above
EDGEMODS_ADMINS=the email you sign in with
```

`EDGEMODS_ADMINS` is the list of admins' emails, separated by commas. An email counts only once Auth0 has verified it. From R3c on, the server reads this file when it starts.

## 8. Then tell Claude

Say it is done, and give the tenant domain if it is not `edgemods-dev.us.auth0.com`. Claude checks it by starting the server and signing in on http://localhost:8800 with each of the three methods: you will be asked to sign in yourself, since only you can.

## 9. The VS Code extension's application (R4)

Added 2026-11-22, checked against Auth0's docs that day. The extension signs in the way a desktop app should: it opens your browser on the same Auth0 page as the website. When you have signed in, Auth0 sends the browser to a page on the EDGEmods site (`/auth/vscode`, from R4b), which says "Back to VS Code" and hands the answer to VS Code through VS Code's own link handler (a `vscode://` link, the same kind EDGEdeck's links use). No local port is opened. The extension keeps a refresh token in VS Code's secret storage, so you stay signed in, and every time it is used Auth0 swaps it for a new one (rotation), so a stolen old one is worthless.

It is a **Native** application: it has no client secret, because anything shipped inside an extension can be read by anyone. PKCE takes the secret's place.

### The application

1. **Applications** › **Applications** › **Create Application**.
2. **Name:** `EDGEmods for VS Code`. **Type:** Native. **Create**. Skip the quick start.
3. **Settings** tab, **Application URIs**:

   | Field | Value |
   |---|---|
   | Allowed Callback URLs | the site's landing page, below |
   | Allowed Logout URLs | empty |
   | Allowed Web Origins | empty |
   | Allowed Origins (CORS) | empty |

   On the development tenant, for the website on your PC:

   ```text
   http://localhost:8800/auth/vscode
   ```

   On the production tenant: `https://edgemods.ai/auth/vscode`.

   The page then opens the editor that started the sign-in: VS Code, VS Code Insiders, EDGEkit, VSCodium, Cursor or Windsurf each open their own kind of link, and the extension tells the page which one is its own. Before R4b, Auth0 sent the answer straight to those six `vscode://…/auth` links. If they are still in the list, remove them: nothing uses them now.

4. Same tab, **Refresh Token Rotation**: switch on **Allow Refresh Token Rotation**. **Rotation Overlap Period:** `60` (seconds: two VS Code windows renewing at the same moment then do not look like a stolen token).
5. Same tab, **Refresh Token Expiration**:

   | Field | Value |
   |---|---|
   | Set Idle Refresh Token Lifetime | on, `2592000` (30 days: not used for a month, you sign in again, as on the website) |
   | Set Maximum Refresh Token Lifetime | on, `31557600` (a year: at the latest, you sign in again once a year) |

6. Same tab, **Advanced Settings** › **Grant Types**: keep **Authorization Code** and **Refresh Token**. Untick anything else (Implicit, Device Code, Password).
7. **Credentials** tab: **Authentication Method** None (a Native application's default).
8. **Connections** tab: switch on `Username-Password-Authentication`, `google-oauth2` and `github`, as for the website.
9. **Save**. From the **Settings** tab, copy the **Client ID**. It is not secret.

### The API's side

The extension asks for an access token for the EDGEmods API (step 4). Three settings on the API make that safe and quiet:

1. **Applications** › **APIs** › `EDGEmods API` › **Settings**.
2. **Access Settings** › **Allow Skipping User Consent**: on. EDGEmods' own applications then do not show an "EDGEmods wants to access your account" page.
3. **Application Access Policy** › **User-Delegated Access**: **Per-app authorization**. Only applications you name can then get a token for the API. The website never asks for one, so it is not affected. **Save**.
4. **Application Access** tab: find `EDGEmods for VS Code`, **Edit**, **Grant Access** under **User-Delegated Access**. The API has no permissions to tick yet. **Save**.

On the development tenant, Auth0 may still show a short "confirm you are signing in to EDGEmods for VS Code" page after you sign in. That is on purpose: Auth0 cannot verify a `localhost` address, so it asks you to confirm it was you who started the sign-in. With `https://edgemods.ai/auth/vscode` it does not ask (unverified until the production tenant exists).

### The settings file

Add one line to `.env`:

```ini
EDGEMODS_AUTH0_EXTENSION_CLIENT_ID=the VS Code application's client id
```

The server then accepts this application's access tokens on its API and downloads, and tells the extension which tenant and client id to use, so the extension needs only the site's address (`http://localhost:8800` while testing). Then tell Claude it is done.

## 10. The in-game browser's application (RN3)

Added 2026-11-27, checked against Auth0's docs that day (Device Authorization Flow). The EDGEmods app in REDnode runs inside the game, where typing a password is awkward. So it signs in the way a TV app does:
1. It shows a short code and an address.
2. You open the address on your phone or PC, sign in as usual and confirm the code.
3. The game is then signed in.

It keeps a refresh token in REDnode's secrets, encrypted with your Windows account.

1. **Applications** › **Applications** › **Create Application**.
2. **Name:** `EDGEmods in game`. **Type:** Native. **Create**. Skip the quick start.
3. **Settings** tab, **Application URIs**: leave every field empty. The device flow has no callback.
4. Same tab, **Refresh Token Rotation** and **Refresh Token Expiration**: the same as step 9 (rotation on, overlap `60`; idle `2592000`, maximum `31557600`).
5. Same tab, **Advanced Settings** › **Grant Types**: tick **Device Code** and **Refresh Token**. Untick everything else.
6. **Credentials** tab: **Authentication Method** None.
7. **Connections** tab: switch on `Username-Password-Authentication`, `google-oauth2` and `github`.
8. **Save**. Copy the **Client ID** from the **Settings** tab. It is not secret.
9. **Applications** › **APIs** › `EDGEmods API` › **Application Access** tab: find `EDGEmods in game`, **Edit**, **Grant Access** under **User-Delegated Access**. **Save**.

The code's format is a tenant setting: **Settings** › **Advanced** › **Device Flow User Code Format**. The default is fine.

Add one line to `.env`, then tell Claude it is done:

```ini
EDGEMODS_AUTH0_REDNODE_CLIENT_ID=the in-game application's client id
```

The server then accepts this application's tokens as it does the extension's, and `GET /api/v1/auth` gives the in-game app its client id.

## Later: the live site (R3h)

The live site gets its own tenant, so test accounts and test settings never mix with players' accounts. When R3h comes:

| Step | What |
|---|---|
| Tenant | `edgemods`, environment tag Production, the same region |
| Login address | A custom domain, `login.edgemods.ai`, so the sign-in page is on EDGEmods' own name. It is free, but Auth0 asks for a credit card on file to verify the tenant; it is not charged. A DNS CNAME record, then the callbacks below use it |
| Google keys | A Google Cloud project with an OAuth consent screen (EDGEmods' name, logo, privacy and terms pages) and an OAuth client. Its redirect address is `https://login.edgemods.ai/login/callback` |
| GitHub | A second OAuth App, `EDGEmods`, with the callback `https://login.edgemods.ai/login/callback` |
| Email | Auth0's built-in email is for testing only: 10 emails a minute, from `no-reply@auth0user.net`. The live site sends through Amazon SES (on the same AWS account) from an `edgemods.ai` address |
| Website application | Callback `https://edgemods.ai/auth/callback`, logout `https://edgemods.ai/` |
| API, server application, VS Code application and in-game application | As in steps 4, 5, 9 and 10 |
| Settings | The same names as steps 7, 9 and 10, in `/etc/edgemods.env` on the server. `EDGEMODS_AUTH0_DOMAIN` is the custom domain, `login.edgemods.ai`, and one more line, `EDGEMODS_AUTH0_MANAGEMENT_DOMAIN`, holds the tenant's own domain (`edgemods.us.auth0.com`): Auth0's Management API takes its audience on the tenant's own domain, never the custom one. The service says at start if it is missing |
