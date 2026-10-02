# Bring your own data

1. Start with a reviewed fresh installation: `supabase/saas.sql` for shared multi-workspace SaaS or `supabase/standalone.sql` for a dedicated business. These are alternatives, not sequential migrations; never run historical clinical migrations.
2. Export only records you are authorized to transfer from your source system into a local CSV or XLSX file.
3. Open **Leads → Import** and map names, contact information, company, role, location, interest, deal value, expected close date, and any configured custom fields.
4. Review the preview, field mappings, dates, and duplicates before importing. Reconcile totals after the import. Spreadsheet import does not establish or migrate messaging consent.
5. Assign records to your new team and review the pipeline stages. Custom field definitions belong in Workspace Settings before importing those fields.

The old `migrate-from-old.mjs` copier is intentionally disabled. It contains no remote credentials or source endpoints and performs no network requests. This project does not silently copy existing business or clinical records into the new CRM. CSV/XLSX import does not migrate authentication accounts, provider credentials, message delivery state, or historical database-specific automation rules.
