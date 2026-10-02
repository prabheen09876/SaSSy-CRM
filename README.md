# SaSSy CRM

### Your business. Your workflow. Your CRM.

SaSSy CRM is a customizable, multi-business customer relationship management application built with **React, Vite, and Supabase**, with a frontend hosted on **Cloudflare Pages**.

It brings leads, follow-ups, customer activity, team access, and reporting into one workspace. Businesses can adapt their terminology, fields, and sales-stage labels without maintaining an entirely separate frontend.

**Project website:** [vertex-workspace-crm.pages.dev](https://vertex-workspace-crm.pages.dev/)

> **Project status:** The core multi-workspace CRM is implemented. WhatsApp Business API and Brevo automation are extension targets that require additional backend services. This repository is a SaaS foundation, not a complete subscription-billing or turnkey marketing-automation platform.

## Contents

- [Features](#features)
- [Technology stack](#technology-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Connect a Supabase backend](#connect-a-supabase-backend)
- [Manage your workspace](#manage-your-workspace)
- [WhatsApp and Brevo automation](#whatsapp-and-brevo-automation)
- [Deployment](#deployment)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Security and production readiness](#security-and-production-readiness)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

### Leads and customer relationships

- Store contact details, company information, product or service interests, and opportunity values.
- Assign leads to teammates and manage priorities, qualification, and sales stages.
- Search, filter, and sort records.
- Maintain notes and activity history.
- Schedule follow-ups and appointments using reminders and calendar views.
- Review lead and daily-activity analytics.
- Import contacts from spreadsheets and export records.
- Move records to the recycle bin and restore them when needed.

### Business customization

- Presets for general business, professional services, real estate, education, retail, and healthcare/wellness enquiries.
- Custom record names, such as leads, prospects, buyers, or enquiries.
- Configurable sales-stage labels, currency, and calling code.
- Custom text, number, date, and dropdown fields.
- Workspace-specific business details and settings.

Stage customization changes labels while preserving the existing stage order and won/lost meanings. It is not an unrestricted workflow builder. Healthcare presets support enquiries and scheduling, not regulated medical-record management.

### Teams and multiple workspaces

- Email/password accounts through Supabase Authentication.
- Create or join separate business workspaces.
- Workspace invitations and role-based access.
- Owner, Manager, Sales, Support, and Marketing roles.
- Database row-level security tied to active workspace membership.
- One account can belong to multiple businesses with different roles.

### Mobile and appearance

- Responsive layouts for desktop and mobile.
- Mobile **Call** buttons open the device's phone dialer for a saved lead number.
- Light, dark, and device-following appearance modes.
- Blue, Teal, Violet, Rose, Amber, and Graphite palettes.
- Custom accent-color picker and hexadecimal color input.

Appearance preferences are saved in the current browser. Opening the dialer does not automatically place a call or record a completed call. The installable web-app shell does not provide offline synchronization of live CRM records.

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, JavaScript, CSS |
| Development and build | Vite |
| Database | Supabase PostgreSQL |
| Authentication | Supabase Auth |
| Workspace authorization | PostgreSQL row-level security and database functions |
| Frontend hosting | Cloudflare Pages |
| Optional connection gateway | Cloudflare Workers |
| Spreadsheet handling | SheetJS |
| Automated checks | Node.js test runner, Playwright, PGlite |
| Planned messaging integrations | WhatsApp Business API and Brevo |

## Architecture

The platform operator configures shared infrastructure once. Business users create an account and workspace; they do not need their own Cloudflare or Supabase accounts.

```text
Browser: React CRM on Cloudflare Pages
  |
  +-- Supabase Auth: sign-in and account sessions
  |
  +-- Supabase PostgreSQL: workspace-scoped CRM records and access rules
  |
  +-- Optional Cloudflare Worker: connection and workspace-access checks
        |
        +-- Additional backend implementation required:
              messaging adapters, scheduler, delivery tracking,
              WhatsApp Business API, Brevo, and provider webhooks
```

Core CRM records and SaaS invitations work directly with Supabase. The included Worker currently implements connectivity and authenticated workspace-health checks only.

Frontend integration requests use a Supabase access token and the selected workspace ID. Any new backend must independently verify the token, current membership, role, and ownership of each requested record. A workspace ID supplied by the browser is not authorization by itself.

## Getting started

### Prerequisites

- A maintained Node.js release compatible with the dependencies; Node.js 22 is a practical starting point.
- npm.
- A local copy of this repository.
- A Supabase project only if you want persistent, authenticated operation.

Run commands from the application directory containing `package.json`. If the application is nested inside a larger repository, enter that directory first.

### 1. Install dependencies

```sh
npm ci
```

### 2. Configure a local demo

Create or update `.env.local` with these public configuration values:

```dotenv
VITE_CRM_MODE=demo
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_WORKER_URL=
VITE_ALLOW_CONNECTION_SETUP=false
```

Review any existing local settings before changing them. A previously saved browser connection can affect an unlocked local installation; use a fresh browser profile to try the demo without an old connection.

### 3. Start the application

```sh
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite and choose a demo role. Binding to `127.0.0.1` keeps this development session local to your computer.

Demo records reset on reload. Browser-local workspace preferences can persist. Demo messages are simulated and do not send email or WhatsApp messages.

> Production builds load production-mode environment files. A demo `.env.local` does not guarantee that `npm run build` produces a demo: review `.env.production` and any `.env.production.local` overrides before building.

## Connect a Supabase backend

### Choose an operating mode

| Mode | Purpose | Initial database schema |
| --- | --- | --- |
| `demo` | Explore without a live database | None |
| `saas` | Multiple businesses with signup and workspace invitations | `supabase/saas.sql` |
| `supabase` | Dedicated single-business installation | `supabase/standalone.sql` |

**Run only the matching schema, once, in a new and empty Supabase project.** The schemas are alternative installations, not upgrades. Do not run either over an existing CRM database, apply both, or replay archived migrations to repair setup.

For an existing project, inspect it first with [setup-check.sql](supabase/setup-check.sql) and follow the [migration guidance](docs/data-migration.md). An empty leads list does not mean the database itself is empty.

### SaaS setup

1. Create a new Supabase project for your installation.
2. Run [supabase/saas.sql](supabase/saas.sql) in that new project's SQL Editor.
3. Enable email/password signup and email confirmation.
4. Set the site's URL and permitted authentication redirect URLs to your actual CRM addresses. Use exact, narrowly scoped production URLs.
5. Configure production authentication email delivery before inviting external customers. Do not disable verification to work around undelivered emails.
6. Obtain the project URL and **publishable key or legacy anon key**.
7. Configure the frontend using the variables below, then restart the development server or rebuild the hosted frontend.
8. Select **Create an account**, choose your own email and password, verify your email, and create your first workspace.

There is no default CRM password. Connecting a database does not create an account. Standalone installations use administrator-provisioned accounts instead of the SaaS signup flow.

### Frontend configuration

For local SaaS development, use `.env.local`. For a hosted build, use your build environment or a reviewed `.env.production.local` file:

```dotenv
VITE_CRM_MODE=saas
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-KEY
VITE_WORKER_URL=
VITE_ALLOW_CONNECTION_SETUP=false
```

The repository's existing `.env.production` may point to a previous installation. Replace or override its public connection settings deliberately before publishing your own build.

| Variable | Purpose |
| --- | --- |
| `VITE_CRM_MODE` | Selects demo, multi-workspace SaaS, or standalone operation. |
| `VITE_SUPABASE_URL` | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Public publishable or legacy anon key; never a service-role key. |
| `VITE_WORKER_URL` | Optional HTTPS integration-service origin. Leave blank until a service is ready. |
| `VITE_ALLOW_CONNECTION_SETUP` | Keep `false` on shared hosted installations. `true` is an intentional operator/development override. |

**Settings → Connections** can test and save a connection in an unlocked local installation. Those changes apply only to that browser; they do not configure other customers or move database records. Shared hosted connections are locked by default.

All `VITE_` values are browser-visible. Never place database passwords, service-role keys, WhatsApp tokens, Brevo keys, Cloudflare API tokens, or other secrets in them.

## Manage your workspace

### First workspace checklist

1. Open **Settings → Workspace** and set the business name and industry.
2. Review terminology, sales-stage labels, currency, and calling code.
3. Add the custom fields your business needs.
4. Create a sample lead, assign a teammate, and set a follow-up.
5. Confirm the record appears in the expected views.
6. Invite your team and review their access.
7. Choose your browser's theme under **Settings → Appearance**.

### Invite teammates

An Owner opens **Settings → Team & access**, enters the teammate's email and role, and creates an invitation link. Copy the link immediately and share it privately.

- The CRM does not automatically email invitations.
- The recipient signs in with the matching verified email address.
- Invitations expire after seven days, are single-use, and can be revoked.
- Managers cannot modify Owners or other Managers.
- Removing workspace access does not delete the person's global account or memberships elsewhere.
- Users manage their own passwords; workspace administrators should not request them.

### Daily workflow

Review due reminders, work through assigned leads, record the outcome of each interaction, update the stage, and set the next follow-up. Use Calendar for appointments and Analytics/Daily views to review activity and results. Available controls depend on the user's role.

Lead-stage tracking is part of the core CRM. Advanced funnel execution and reporting in integration-dependent screens require additional backend routes.

### Import and export

Prepare a small, trusted spreadsheet first. Map columns carefully, including custom fields and dates, then inspect the imported records before continuing with a larger dataset.

Import creates new contacts; it is not a full database restore and does not deduplicate repeated imports. An imported contact does not automatically acquire marketing consent. Exports are useful for reporting, but they are not a substitute for database backups.

## WhatsApp and Brevo automation

### What is available now?

| Capability | Status in the reusable CRM foundation |
| --- | --- |
| CRM records, follow-up dates, and activity history | Implemented |
| Message/template and automation-related UI | Present; live actions depend on backend services |
| Public and authenticated gateway health checks | Implemented in the optional Worker |
| WhatsApp Business API delivery | Requires a backend provider adapter and supporting storage |
| Brevo email delivery | Requires a backend provider adapter and supporting storage |
| Scheduled campaigns, delivery retries, and provider webhooks | Require implementation |
| Self-service provider credential management | Not implemented |

Business-specific intake extensions or external automation scenarios do not automatically transfer to a fresh installation. A configured form mapping, template, or gateway URL is not evidence that messages are being delivered.

### WhatsApp Business API

A developer can extend SaSSy CRM with Meta's WhatsApp Business Platform Cloud API to send approved follow-ups and appointment reminders.

The integration needs:

1. A configured Meta business/app and authorized WhatsApp sender.
2. Provider credentials stored only on the trusted backend.
3. A workspace-scoped adapter matching the CRM's send and template contracts.
4. Recipient consent, opt-out handling, approved-template validation, and enforcement of current messaging-window rules.
5. Verified inbound and delivery-status webhooks.
6. Persistent message records and duplicate-safe dispatch.

The existing composer is designed around Meta Cloud API concepts; it is not a universal provider switch. A personal WhatsApp account or the WhatsApp Business phone app alone is not this API integration.

### Brevo email

A developer can add a Brevo adapter for transactional email and consent-based follow-up workflows.

The integration needs:

1. A Brevo account with an authorized sender and authenticated sending domain.
2. A server-side API key and appropriate templates.
3. A backend send endpoint that verifies workspace access and recipient eligibility.
4. Delivery, bounce, complaint, and unsubscribe event handling.
5. Suppression checks before each send, with suitable audit and retry behavior.

Transactional notifications and marketing campaigns must follow their respective provider and consent requirements. Configuring Supabase authentication email delivery is separate from building a Brevo CRM campaign integration; one does not automatically enable the other.

### Example workflow to implement

```text
New enquiry
  → Validate and route to the authorized workspace
  → Save the lead without processing the same event twice
  → Assign an owner and schedule a follow-up
  → Check consent, suppression, timing, and provider eligibility
  → Send through WhatsApp Business API or Brevo
  → Record the provider response and later delivery events
  → Stop or adjust the sequence after a reply, conversion, or opt-out
```

Use a server-side scheduler or an external workflow tool such as n8n or Make through a secured adapter. There is no built-in one-click connection for these tools. Never give an untrusted public webhook a privileged database key or let its payload choose an arbitrary workspace.

Before enabling automation, test with synthetic records and recipients controlled by your team. Add a pause control, frequency limits, explicit retry rules, and monitoring. A timeout after sending may mean the provider accepted the message; reconcile uncertain outcomes instead of blindly sending again.

See [integration contracts and route inventory](docs/integrations.md) and the [gateway guide](cloudflare/README.md).

## Deployment

1. Configure the public production variables for your own Supabase project.
2. Confirm production authentication URLs, email delivery, and access rules.
3. Run the relevant checks and build the frontend:

   ```sh
   npm test
   npm run build
   ```

4. Deploy the generated **`dist/` directory** to Cloudflare Pages or another compatible static host with SPA routing.
5. Verify signup, email confirmation, workspace creation, and isolation using separate test accounts.
6. Deploy the optional gateway separately only if needed, using the [gateway guide](cloudflare/README.md).

Do not deploy the repository root, environment files, SQL scripts, exports, or private operational notes. Review bundled public assets and privacy notices so they describe your own installation.

For Cloudflare's current upload workflow, see [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Testing

Run from the application directory:

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:saas
npm run test:settings
npm run test:theme
npm run test:accent
npm run test:call
```

Browser checks use isolated local servers and mocked remote requests. Database security tests use a disposable PostgreSQL-compatible runtime. These tests do not prove that production email, WhatsApp, provider billing, or live infrastructure is correctly configured.

The optional gateway has its own dependencies and checks, documented in [cloudflare/README.md](cloudflare/README.md). Passing tests is not a security audit.

## Project structure

```text
src/
  components/          CRM screens and reusable interface components
  lib/                 Data access, authentication, workspace and theme logic
supabase/
  saas.sql             Fresh multi-workspace installation
  standalone.sql       Alternative single-business installation
  setup-check.sql      Read-only setup inventory
  migrations/          Additional changes; review applicability before use
cloudflare/
  src/                 Optional connection gateway
  README.md            Gateway setup and security boundaries
docs/
  integrations.md      Backend extension contracts
  data-migration.md    Migration precautions
tests/                 Automated checks
public/                Public static assets
```

The product name is **SaSSy CRM**. Some existing package names, browser-storage identifiers, and deployment names still use `workspace-crm`; the README does not rename those identifiers.

## Security and production readiness

- Enforce workspace authorization in both the database and every added backend service.
- Keep provider secrets outside source control, browser storage, logs, and frontend bundles.
- Restrict gateway origins; CORS does not replace authentication or authorization.
- Use production authentication email delivery and appropriate abuse/rate limits.
- Review dependencies and resolve relevant advisories before handling customer data or untrusted imports. Earlier project audits identified unresolved dependency issues, including spreadsheet/build tooling; run a fresh audit for your release.
- Test backups and restoration, not just export downloads.
- Configure monitoring, retention policies, incident handling, and applicable privacy notices.
- Treat business-specific migrations and deployment notes as private operational material until reviewed and sanitized for publication.
- Do not publish real customer data, private workspace details, tokens, or unredacted screenshots in issues or the repository.

Subscription billing, plans, quotas, a platform-admin console, automatic invitation emails, and a general-purpose automation execution service are not included as complete commercial features.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Setup asks for a password you never created | Database setup is not account creation. Use SaaS mode and Create an account, or have the operator provision a standalone account. |
| Verification email does not arrive | Check Supabase email settings, sender restrictions, production SMTP configuration, and spam folders. Keep verification enabled. |
| An authentication link opens localhost | Correct the Site URL and allowed redirect URLs for the intended environment. Request a fresh link. |
| Connection test rejects the database | Check the project URL/key and matching schema marker. Inspect the database; do not rerun an installation schema over existing tables. |
| Records appear missing | Confirm the selected workspace, active membership, filters, and production connection. Do not create a duplicate workspace to recover access. |
| Settings cannot change the shared database | Hosted connections are intentionally operator-managed. Browser-local settings do not reconfigure a deployed service. |
| Gateway is connected but messages do not send | Gateway health only proves connectivity/access. Implement and verify the relevant provider adapter. |
| A mobile Call button is absent | Confirm a supported saved phone number and mobile layout. Unsupported or missing numbers do not produce a dialing link. |
| Colors differ between devices | Appearance preferences are browser-local, not account-synchronized. |

## Contributing

Discuss substantial changes with the maintainer before implementation. Keep changes focused, preserve workspace isolation, add relevant tests, and update documentation when behavior changes.

Use synthetic data for examples and tests. Do not include credentials or real customer records in commits, issues, or pull requests. Report suspected security issues privately to the maintainer rather than posting exploit details or sensitive data publicly.

## License

A project license has not yet been specified. Public repository visibility does not by itself grant permission to reuse or redistribute the code. Contact the maintainer about permitted use, and add an appropriate `LICENSE` file before offering the project under an open-source license.
