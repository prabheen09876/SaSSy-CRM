#!/usr/bin/env node
// The old remote-to-remote copier has been retired. It must never use saved
// endpoints or credentials to read or mutate another business's database.
console.error('The legacy remote migration script is retired. Export the records you are authorized to use, then import that local CSV/XLSX file through Leads → Import in your new workspace. See scripts/MIGRATION.md. No network request was made.')
process.exitCode = 1
