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
| API and server application | As in steps 4 and 5 |
| Settings | The same names as step 7, in `/etc/edgemods.env` on the server |

The VS Code extension's own application (a Native application with a loopback callback) is added at R4, when the extension's sign-in is built.
