# Workspace CRM gateway

This is an optional, deployable Cloudflare Worker for the CRM connection checks. It verifies a signed-in user and their selected workspace against your Supabase project. It does **not** provision Cloudflare accounts or databases, send messages, supply AI, manage billing, or install provider integrations.

The browser connects using your public Worker URL. Do not ask customers for a Cloudflare API token, Supabase service-role key, database password, or account-wide credential in the CRM. Platform deployment is an operator task; customers sign in and manage their own workspace.

## Prerequisites

- Use the CRM's [`supabase/saas.sql`](../supabase/saas.sql) for a new SaaS database. The `is_staff()` RPC must enforce the current authenticated user's membership in the `x-workspace-id` workspace.
- Create your own Supabase project and configure its authentication URLs, email delivery, and row-level security before live use.
- Have a Cloudflare account authorized to deploy this Worker. Nothing in this folder has been deployed for you.

## Configure

Install the separately locked gateway tools with `npm ci` in this folder. Set these non-secret deployment variables in `wrangler.jsonc` before deployment:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project origin, such as `https://your-project.supabase.co`. No path, query, username, or password. |
| `SUPABASE_PUBLIC_KEY` | Your project's publishable key or legacy `anon` key. Secret/service-role keys are rejected. |
| `ALLOWED_ORIGINS` | Comma-separated exact CRM origins, such as `https://crm.example.com`. No wildcard, path, or trailing slash. |
| `ALLOW_LOCALHOST` | Keep `false` in production. `true` permits HTTP only for localhost, `127.0.0.1`, and `[::1]` during local development. |

The initial configuration is intentionally blank. Public health can identify the Worker, but authenticated database health fails closed until the configuration is valid. Never commit real secret credentials. Future provider secrets belong in Cloudflare secrets or dedicated bindings, not frontend storage or this configuration.

For local development, copy `.dev.vars.example` to the git-ignored `.dev.vars`, fill in your own public project values, and use `npm run dev`. Your frontend development origin must exactly match the allowlist. Local development against a real Supabase URL still uses that project's authentication, even though the Worker itself runs locally.

## Validate and deploy

From this folder:

```text
npm test
npm run check
npm run dry-run
```

`check` generates environment/runtime types from Wrangler before checking the JavaScript. `test` uses mocked Supabase responses, including cross-workspace denial and timeout paths; it does not contact your project. `dry-run` bundles locally without publishing. These checks do not replace a real staging test with at least two isolated workspaces.

When you are ready, authenticate with your own Cloudflare account and deploy using `npx wrangler deploy`. That command publishes a Worker and may affect your Cloudflare usage. Select a separate name/configuration for staging and production. Copy the resulting HTTPS Worker URL into the CRM's connection settings, then sign in and test the selected workspace.

## Routes

| Route | Authentication | What it proves |
| --- | --- | --- |
| `GET /public/health` | None | The expected gateway software is reachable: `{ "ok": true, "service": "workspace-crm", "version": 1 }`. No secrets, user information, or provider details. |
| `GET /health` | `Authorization: Bearer <Supabase access token>` and `x-workspace-id: <UUID>` | Supabase authenticated the caller and `is_staff()` returned the boolean `true` for that workspace. |

Browser requests must pass the exact origin allowlist. The gateway permits a narrowly scoped GET preflight and does not use cookie authentication. Calls without an Origin header may be made by server clients, but `/health` still requires a valid user token and workspace membership. CORS is not a substitute for those checks.

Successful authenticated health returns:

```json
{
  "ok": true,
  "integrationsConnected": true,
  "database": true,
  "features": { "email": false, "whatsapp": false, "ai": "none", "push": false }
}
```

`integrationsConnected` means the gateway connection is verified, **not** that messaging or AI providers are installed. Unsupported routes return 404, and unsupported methods on health routes return 405. A missing/invalid session returns 401; a denied workspace returns 403; incomplete configuration returns 503; a failed upstream check returns 502 or 504. Responses never include raw provider errors.

## Security boundaries and launch checklist

- The upstream destination comes only from operator configuration. The Worker is not a general proxy and will not follow upstream redirects with the caller's token.
- The caller's bearer token is sent to Supabase's user endpoint and then to the workspace RPC with the public project key. No elevated credentials are used or stored.
- Upstream validation has an eight-second deadline. User data is limited to 64 KiB and the membership reply to 1 KiB. No CRM records or user details are returned by these checks.
- Every health response uses `Cache-Control: no-store`. Logs contain only fixed error codes; request query strings are redacted in configured observability.
- Before public launch, confirm tenant isolation with separate user accounts, set suitable login/API rate limits, review retention and backups, configure monitoring, and test invitation/revocation flows. Add provider features only with workspace-scoped authorization, tenant-isolated credentials, audit trails, and appropriate messaging consent checks.

References checked while implementing: [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [Wrangler types](https://developers.cloudflare.com/workers/languages/typescript/#generate-types), and the pinned Wrangler configuration schema.
