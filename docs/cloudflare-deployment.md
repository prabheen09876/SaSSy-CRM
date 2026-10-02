# Cloudflare deployment: public guide

Private account identifiers, database project references, deployment history, and operator contact details are intentionally not distributed with this source snapshot.

For a new installation, follow:

1. [Handbook chapter 8: connect a new Supabase backend](SASSY_CRM_GUIDE.md#8-connect-a-new-supabase-backend).
2. [Handbook chapter 10: build and host on Cloudflare Pages](SASSY_CRM_GUIDE.md#10-build-and-host-on-cloudflare-pages).
3. [Optional gateway setup](../cloudflare/README.md), only if you need the included health/access checks.

Use your own account, project, allowed origins, and authentication return URLs. The repository has no production environment file; review your build environment before publishing. Never include private provider credentials in `VITE_` variables or upload the source folder as a built site.

The project website linked in the main README is a separate hosted installation. Cloning this repository does not grant access to it, verify its present configuration, or authorize redeploying it.

No Cloudflare deployment was performed while publishing these files to GitHub.
