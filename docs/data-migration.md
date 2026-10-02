# Moving an existing business into this CRM

The supported starting point is a new Supabase project initialized with either `supabase/saas.sql` for multiple business workspaces or `supabase/standalone.sql` for a dedicated single-business deployment. Choose one; these are alternative installations, not in-place upgrades for another application's database. This repository does not automatically copy records, authentication users, files, clinical data, or provider integrations from an existing system.

In SaaS mode, businesses share operator-managed infrastructure and are isolated through workspace membership and database row-level security. Standalone mode uses a separate database/deployment for one business. Renaming workspace settings alone does not migrate between these architectures. Confirm the target mode, workspace, and access controls before importing.

## Importing a contact list

1. Export the records you intend to bring across from your current system. Keep an unchanged backup and a record of source IDs and row counts.
2. Configure the target workspace's business details, terminology, stage labels, categories, currency, and custom fields before importing.
3. Prepare a CSV, XLSX, or XLS file with one contact per row on the first sheet. Map the columns in the CRM's Import dialog. Name is required; rows without a name are skipped. Review the inferred mappings before saving.
4. Use `YYYY-MM-DD` for dates, `HH:MM` for follow-up time, three-letter currency codes, and valid configured category/custom-select values. Opportunity values must be non-negative. Keep phone numbers as text with their international calling codes.
5. Prefer the canonical stages listed below for portability between workspaces. An unambiguous stage label configured in this workspace is also accepted; the importer resolves it to the canonical stored value. If two stages share a display label, use their canonical values to distinguish them. If the source uses a different pipeline, agree on a mapping before importing.
6. Import a small representative sample, compare its values in the UI, and check the exported result. Then import the remaining rows once.

The importer validates rows before starting writes. A connection failure can still leave a partially saved batch. While the import dialog remains open, **Continue import** skips rows already saved in that session. Closing the dialog, reloading, or choosing the same file later starts a new import: it does not merge or deduplicate existing contacts. Reconcile a partial batch before retrying it in a new session.

The canonical stage values are `New Lead`, `Discovery`, `Proposal Sent`, `Negotiation`, `Follow-up Ongoing`, `Closed Won`, `Closed Lost`, `Not Interested`, and `Unresponsive`. For example, the education preset displays `Closed Won` as `Enrolled`, while reports and storage retain its won outcome. Changing a label cannot add/reorder stages or change their reporting meaning.

Exports contain both the canonical `Stage` and the display-only `Stage Label`. The importer uses `Stage` and skips the companion label column by default, so an exported file remains readable by another workspace with different labels.

The importer supports core contact/opportunity fields and configured custom fields. It does not restore database IDs, original authorship, assignments, account credentials, meetings, message delivery records, or the separate Activity Log export sheet. It creates new contact records. Original creation times and full related history require an explicit database migration. Messaging consent is not imported.

## Preserving relationships and historical records

For a full migration, prepare and test a dedicated migration against a disposable copy of the target schema. Inventory the source entities, confirm which data belongs in an ordinary CRM, and create an explicit source-to-target field/status map. Recreate authorized team accounts in the new authentication project, then map source user IDs and contact IDs to their new values before loading assignments, activities, and meetings.

Preserve source IDs in an agreed reference field or migration ledger so reconciliation and retries are possible. Validate row counts, relationships, dates, currency, archived state, custom values, and access with each intended role. Domain-specific records that have no equivalent in this CRM should stay in an appropriate source archive or purpose-built system; do not silently flatten them into notes.

Move files and provider histories only through a separately scoped migration that preserves their access rules. Configure new provider accounts and callback destinations using [the integration guide](integrations.md). Historical automations and consent evidence require individual review before any workflow starts sending messages.

After verifying the migrated dataset, plan a controlled cutover with a backup and a reconciliation of changes made in the old system during migration. No live data transfer or cutover is performed by running the frontend or the standalone schema.
