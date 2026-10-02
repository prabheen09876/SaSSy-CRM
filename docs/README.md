# SaSSy CRM documentation

SaSSy CRM is an [MIT-licensed open-source CRM](../LICENSE). Start with the complete setup guide, or download the handbook to follow it offline.

- [Complete handbook (PDF)](../output/pdf/SaSSy_CRM_Handbook.pdf): 45 pages covering setup, management, and Make automation creation.
- [Editable handbook](SASSY_CRM_GUIDE.md): the full guide, including the Make walkthrough in chapter 15.
- [Standalone Make walkthrough](MAKE_AUTOMATION_GUIDE.md): lead acquisition, WhatsApp/Brevo orchestration, scheduling, duplicate protection, and recovery.
- [Integration contracts](integrations.md): backend responsibilities and current frontend routes.
- [Migration guidance](data-migration.md): moving authorized records without overwriting an existing installation.
- [Cloudflare deployment notes](cloudflare-deployment.md): public setup entry points, without private deployment history.
- [Meta intake extension](meta-lead-ingestion.md): optional schema extension and implementation boundaries.
- [Privacy notice preparation](privacy-policy.md): replace the example notice before accepting customer information.
- [Publication and security notes](PUBLICATION_NOTES.md): what this public snapshot includes, verification results, and known limitations.

This public snapshot intentionally does not include a configured `.env.production`, private deployment records, or customer data. With no environment overrides, the app defaults to demo mode. Copy `.env.example` to a local environment file for an explicit demo configuration, or follow the handbook to configure your own backend.

The handbook describes both implemented CRM features and future integration work. Reading the guide or enabling a UI switch does not install a WhatsApp/Brevo sender, durable scheduler, or billing service.
