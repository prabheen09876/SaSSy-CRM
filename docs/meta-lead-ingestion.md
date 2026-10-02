# Optional Meta lead-intake extension

This public guide replaces a private installation runbook. Live Page/form/workspace identifiers, routing records, customer information, operator contacts, and historical run outputs have been omitted.

The repository includes these optional schema extensions:

- `supabase/migrations/20260924_meta_lead_ingestion.sql`
- `supabase/migrations/20260925_meta_short_form_intake.sql`

They are not part of ordinary account signup. Review them and their tests against a disposable database before any installation. They do not create a universal Make connector, grant Meta access, or configure a customer's routing. The historical live-route migration is deliberately excluded.

## Recommended starting point

Use the [Make creation walkthrough](MAKE_AUTOMATION_GUIDE.md), also included in handbook chapter 15. It covers creating a scenario, selecting a controlled source, mapping fields, using an authenticated backend, testing replay behavior, scheduling, and recovery.

The historical workflow described by the handbook used Meta polling, a business-specific JSON transformation, a trusted Supabase RPC, a Make Data Store, and an internal email alert. That description is not a claim of a working automation for this repository or another business.

The generic `/integrations/make/...` endpoints in the guide are proposed contracts, not routes implemented by the included health gateway. Implement and test the backend before connecting a scenario to those examples.

## Required boundaries

- Resolve the allowed business/workspace from trusted server-side routing; do not accept an arbitrary workspace supplied by a form respondent.
- Keep provider and elevated database credentials in approved backend or restricted connection facilities, never in the browser, shared JSON, or repository.
- Use explicit source mappings, preserve external IDs as text, validate input, and deduplicate retries.
- Revalidate consent and recipient eligibility before messaging; a submitted email address is not blanket marketing permission.
- Treat email acceptance, actual delivery, and uncertain outcomes separately. Reconcile uncertain sends before retrying.

For isolated schema regression tests, run `node --test tests/meta-lead-ingestion.test.js` from the repository root. This does not send messages or test a live Meta connection.
