# Public source snapshot

Prepared on 2 October 2026 for the SaSSy CRM GitHub repository.

## Included

- Frontend source, public brand assets, dependency manifests and lockfiles.
- Automated checks and generic Supabase installation scripts.
- The optional Cloudflare health gateway, with blank connection defaults.
- Optional Meta intake schema extensions without any live source-to-workspace routing.
- The editable handbook, standalone Make guide, and combined PDF.

## Deliberately not included

Local `.env` and `.env.production` files, credentials, local Cloudflare/Supabase state, customer exports, historical business-specific schemas, private campaign routing, internal deployment history, generated application bundles, dependency folders, and test screenshots are not part of this public snapshot.

The original GitHub README is unchanged. Where it refers to a previous `.env.production`, understand that this file is not distributed. Supply your own reviewed public build configuration; no existing hosted database is configured for a fresh clone.

The privacy page in this copy is a clearly marked setup notice. An operator must replace it with an accurate notice and appropriate contact information before collecting real customer data. It is not a legal policy or certification.

## Verification and known limitations

The clean public snapshot passed `npm test` (127 tests), `npm run build`, `npm run test:saas` (8 account/workspace scenarios), and `npm run test:call` (8 mobile-call scenarios). Browser checks used isolated test data and intercepted telephone activations; they did not place real calls. These local checks do not establish that any hosted integration, messaging delivery, or production security control works.

A dependency audit on 2 October 2026 reported **10 advisories: 8 high and 2 moderate**. Direct affected dependencies included `xlsx`, `vite`, and `sharp`. The installed `xlsx` dependency had no automatic fix available from that audit; Vite's suggested fix involved a major upgrade. No package changes were bundled into the publication. Run a fresh `npm audit`, review upstream fixes, and test upgrades before accepting untrusted spreadsheet imports or production customer data.

The production build also reported a JavaScript chunk over Vite's default 500 kB warning threshold. This is a performance warning, not a failed build.

WhatsApp/Brevo CRM delivery, durable automation scheduling, provider onboarding, subscription billing, quotas, and a platform administration console still require implementation. The included gateway provides health/access checks only.

## Privacy and contributions

Keep real customer information and credentials out of commits, issues, test fixtures, and screenshots. Use synthetic records. Environment and export patterns are ignored as a safeguard, but every staged change still needs review.

No software license has been selected by the owner. Public visibility alone does not grant an open-source license; see the repository README's License section.
