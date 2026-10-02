# Optional integrations

The CRM stores core business records directly in Supabase. The included [Cloudflare gateway](../cloudflare/README.md) implements public connectivity and authenticated workspace-health checks only. Email/WhatsApp delivery, private attachments, automated campaigns, public intake, push delivery, and standalone credential issuance need additional services you operate. SaaS workspace invitations are already implemented as database RPCs and do not require an email/credential service; links are shared manually.

Leave `VITE_WORKER_URL` blank until that service is ready. Demo mode makes no integration requests and uses simulated messages. In Supabase mode, disconnected controls show unavailable states. Creating a template, category, or form mapping does not install a provider connection or start a campaign.

## Connection and authorization

1. Implement and test the routes needed by your business against the frontend contracts in [`src/lib/db.js`](../src/lib/db.js), [`src/lib/teamAccounts.js`](../src/lib/teamAccounts.js), and [`src/lib/push.js`](../src/lib/push.js).
2. Configure the service with your Supabase project and your own provider accounts. Store privileged database keys, provider tokens, private signing keys, and email credentials only on the server.
3. Set `VITE_CRM_MODE=saas` or `supabase`, with the matching fresh schema and public variables described in [the README](../README.md). Set `VITE_WORKER_URL` to your service's HTTPS origin, then rebuild. Unlocked local installations can test and save the connection in Settings.
4. Confirm actual service health in Settings → Connections before enabling a workflow. A URL or reachable gateway alone does not prove a provider works.

The frontend sends the current Supabase token as `Authorization: Bearer <token>`, including on `/health`. Only `/public/health` is anonymous. SaaS requests also send `x-workspace-id`. Validate the user against the configured project and their current active membership/role in that workspace, then scope every requested record, provider credential, and background job to it. Standalone mode checks the active profile, CRM access, password restriction, and role. Do not trust a workspace header, stale token role, or button visibility alone. Restrict CORS to exact frontend origins and implement narrowly scoped preflights.

Both fresh schemas contain core CRM tables; neither installs a scheduler, provider webhooks, delivery outboxes, private object storage, funnel infrastructure, or push subscription storage. Supply any additional storage/migrations explicitly, with workspace isolation in SaaS. Do not apply archived migrations to fill these gaps.

## Route inventory

This is an inventory of the current frontend extension points, not a claim that a server implementation is included. JSON write routes generally return `{ "ok": true, ... }` on success and `{ "ok": false, "error": "Safe message" }` with an appropriate non-2xx status on failure. See the linked client functions for complete request fields and response handling.

| Capability | Routes | Contract used by the frontend |
| --- | --- | --- |
| Public connection probe | `GET /public/health` | Included gateway returns `{ "ok": true, "service": "workspace-crm", "version": 1 }`; no identity/provider details. |
| Provider health | `GET /health` | Authenticated workspace status, no secrets. Supports `email`, `whatsapp`, `ai`, and `push`, optionally inside `features`. Included gateway returns unavailable providers. A degraded response may use HTTP 503. |
| Standalone staff invitations | `POST /team/invite` | Legacy standalone extension only, not used/allowed in SaaS. Accepts profile/access fields and password issuance options. Returns `ok`, `profile`, delivery state and optional newly issued credential. |
| Standalone account operations | `POST /team/account` | Legacy standalone only. Accepts `id`, `expected_version`, and `action` (`reset_password`, `resend_credentials`, or `deactivate`). Returns updated `profile`, `email_status` and optional newly issued credential. SaaS workspace admins must never control global credentials. |
| Standalone required password change | `POST /team/password/complete` | Legacy standalone only. Verifies the user's own required change and trusted gate. SaaS recovery uses Supabase Auth. |
| Outbound messages | `POST /send` | Accepts the composer's channel-specific payload. Must return `{ ok: true, message: { ... } }` with a persisted message record. WhatsApp requests include `kind` and `client_request_id`. |
| WhatsApp preferences | `GET /leads/whatsapp-preference?lead_id=…` | Returns consent, recipient suppression, verified recipient, and session-window state. |
| WhatsApp opt-out and consent | `POST /leads/whatsapp-opt-out`, `POST /leads/whatsapp-consent` | Both include `lead_id`, exact confirmation, and `expected_recipient_e164`; consent also includes `client_request_id`. Verify these server-side. |
| Approved WhatsApp templates | `POST /whatsapp/templates/sync` | Returns an `ok` result with `synced_count`. The composer reads approved Meta templates from the `templates` table. |
| Quick-reply rules | `GET`, `POST`, `DELETE /whatsapp/quick-reply-rules` | Reads return `rules` and `allowed_actions`; POST accepts a rule; DELETE accepts `{ id }`. |
| Quick-reply history | `GET /whatsapp/quick-reply-runs?limit=…&rule_id=…` | Returns `runs`; `rule_id` is optional. |
| Private WhatsApp files | `POST /whatsapp/media?name=…`, `GET /whatsapp/media/:ref` | Upload is raw bytes with a MIME content type; returns `media_ref` with optional MIME/name metadata. Download returns authorized file bytes, not a public storage URL. |
| Public template assets | `POST /upload?name=…` | Raw file upload; returns `{ ok: true, url }`. Only use this public-URL contract for material intended to be public. |
| Automation controls | `POST /automation/toggle`, `POST /automation/run` | Toggle accepts `automation_id` and `enabled`, and returns `automation`. Run accepts `automation_id` with options and returns counts/status/confirmation fields. A scheduler and delivery worker are separate server responsibilities. |
| Funnel reporting | `GET /lead-funnels/overview`, `GET /lead-funnels/people` | People requests include `funnel_id`, `step_id`, `kind`, `page`, and `page_size`. The UI treats missing routes/schema as unavailable. |
| Funnel management | `POST /lead-funnels/settings`, `/lead-funnels/enroll`, `/lead-funnels/approve`, `/lead-funnels/enrollment` | Separate routes for settings/steps, preview-and-confirm enrolment, reviewed delivery approval, and individual enrolment actions. Payloads and confirmation requirements are defined in `db.js`. |
| Web Push registration | `POST /push/subscribe` | Accepts `{ subscription }`; the client expects a successful HTTP status. Set `VITE_VAPID_PUBLIC_KEY` to the matching public VAPID key. Private signing keys and delivery stay on your server. |

Owners and managers manage staff within the same role limits as the database: managers cannot alter owners or other managers, and staff cannot promote themselves. Account operations must verify `expected_version` before changing access. Never include stored or prior passwords in profile responses, logs, or health data. For an uncertain credentials email, return `email_status: "unknown"`; do not silently resend it.

## Messaging behavior

The current WhatsApp composer is designed for Meta Cloud API's approved templates, media types, and service window. Another provider would require a compatible adapter and possibly frontend changes. There is no provider switch that configures an account automatically. Other channel names in templates or reports are not evidence of an installed sender.

Implement recipient-specific consent and suppression, signed inbound/status webhooks, approved-template validation, session-window checks, durable message storage, and idempotent dispatch before exposing real sending. Check consent again immediately before dispatch. Retain ambiguous dispatches as `unknown` for reconciliation instead of automatically resending them. A newly imported contact never acquires messaging consent just because a spreadsheet included a consent column.

The browser reads messages from Supabase. SaaS uses workspace-scoped polling; PostgreSQL Changes does not propagate the per-request workspace header, so do not enable an unscoped feed. Standalone deployments may use a publication with the matching access policies. Only trusted services create provider delivery records. Keep private attachments behind authenticated, workspace/record-scoped authorization; use `/upload` only for public template artwork.

## Public intake and business alerts

Lead form settings store mappings between a form identifier and a CRM category. This app does not publish an anonymous intake route, website form, Meta webhook, or staff-email dispatcher. Build those server-side for your business, validate submissions, prevent duplicate processing, and map only supported fields into the standalone schema. Do not expose the Supabase service-role key in public forms or browser code.

No previous provider account, email recipient, automation, webhook, or deployment is inherited by a fresh installation. Test new integrations with synthetic records and destinations controlled by your team before enabling them for customers.
