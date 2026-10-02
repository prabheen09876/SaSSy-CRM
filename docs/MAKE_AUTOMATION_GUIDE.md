# SaSSy CRM: Make.com automation creation guide

**Documentation date:** 2 October 2026

**Audience:** the platform operator, an authorized business administrator, and the developer maintaining the integration backend

**Main handbook:** [SaSSy CRM setup, management, and automation](SASSY_CRM_GUIDE.md)

This walkthrough explains how to create and manage Make scenarios for lead intake, internal alerts, WhatsApp Business API messages, and Brevo email workflows.

> **Status boundary:** Make orchestration is separate from the CRM. The shipped Cloudflare gateway only checks health and access. It does not receive leads, send messages, or run jobs. The `/integrations/make/...` endpoints used below are **proposed integration contracts that a developer must implement and test**, not URLs already available in SaSSy CRM. Do not activate a scenario against an unimplemented endpoint.

The repository separately documents a property-specific Make → Supabase → Gmail integration. That is not automatically installed for new workspaces and is not a Brevo/WhatsApp sender. This guide does not change that existing scenario or copy its customer IDs and credentials.

## Contents

1. [Choose the workflow and integration boundary](#1-choose-the-workflow-and-integration-boundary)
2. [Prepare accounts and backend prerequisites](#2-prepare-accounts-and-backend-prerequisites)
3. [Create your first Make scenario](#3-create-your-first-make-scenario)
4. [Scenario A: Facebook leads into SaSSy CRM](#4-scenario-a-facebook-leads-into-sassy-crm)
5. [Scenario B: WhatsApp and Brevo follow-ups](#5-scenario-b-whatsapp-and-brevo-follow-ups)
6. [Scenario C: a controlled Brevo internal-alert pilot](#6-scenario-c-a-controlled-brevo-internal-alert-pilot)
7. [Schedule and activate safely](#7-schedule-and-activate-safely)
8. [Duplicate protection and error recovery](#8-duplicate-protection-and-error-recovery)
9. [Maintain the existing property-specific workflow](#9-maintain-the-existing-property-specific-workflow)
10. [Handover checklist and references](#10-handover-checklist-and-references)

## 1. Choose the workflow and integration boundary

Start with one business, one trigger, and one narrowly defined outcome. Examples:

- Capture a Facebook Lead Ads submission as a CRM lead.
- Notify the responsible staff member about a new enquiry.
- Send an appointment reminder to a consenting customer.
- Send an approved follow-up sequence, stopping when the person replies or opts out.

For a shared SaaS product, the recommended division of responsibility is:

```text
Make                         SaSSy integration backend            Provider

Acquire event -------------> Validate source and workspace
Transform fields ----------> Save lead once
Request approved action ---> Check consent and create job
Run scheduled trigger -----> Claim due jobs and send -----------> WhatsApp / Brevo
                             Store delivery outcome <----------- Authenticated webhook
```

Make handles orchestration. The backend owns tenant isolation, provider secrets, consent, durable jobs, and delivery records. An editable Make workflow should not be able to choose an arbitrary workspace or bypass these checks.

If Make instead calls a provider directly, it becomes part of the trusted delivery system. You still need server-side eligibility checks, durable attempt tracking, and reconciliation. A simple filter plus Data Store is not enough for a reliable multi-tenant campaign engine.

## 2. Prepare accounts and backend prerequisites

### Accounts and access

- Make account/team with an appropriate plan and access controls.
- Intended SaSSy workspace and permission to operate its integrations.
- Meta account with access to the relevant Page, lead form, and leads when using Facebook Lead Ads.
- WhatsApp Business Platform sender/account and approved templates when sending WhatsApp messages.
- Brevo account with a verified sender/domain for email.
- A staging environment and destinations you control for tests.

An ordinary CRM team member should not need Cloudflare tokens or the Supabase service-role key. Only authorized operators should maintain integration credentials and scenario settings.

### Developer prerequisites for the recommended scenarios

Before connecting Make, implement and document a machine-to-machine interface. Suggested contracts:

| Proposed endpoint | Purpose | Required behavior |
| --- | --- | --- |
| `POST /integrations/make/intake` | Validate a source event and persist the lead | Resolve workspace from a trusted route and scoped credential; deduplicate source IDs; return a persisted lead ID |
| `POST /integrations/make/enqueue` | Request an approved action for a lead | Validate lead/workspace, policy, template, consent, recipient, and idempotency key; create at most one logical job |
| `POST /integrations/make/dispatch-due` | Ask the backend to process a bounded batch | Server-side schedule checks, job claims/leases, dispatch validation, provider call, and durable results |
| `GET /integrations/make/runs/:id` | Inspect a run, if asynchronous execution is used | Authenticate and scope the run; distinguish queued, accepted, failed, and unknown outcomes |

These routes and their machine credentials do not exist in the included gateway. The existing browser `/send` and `/automation/run` routes also require implementation; a Make API key cannot be substituted for a user's Supabase token without designing that authorization path.

Use a distinct, revocable integration credential bound server-side to the permitted business and actions. Store it through Make's dedicated connection/credential facilities, not inline in JSON bodies, scenario names, logs, or shared blueprints. Reject an event whose Page/form does not belong to an approved route.

The backend should provide stable responses such as the following. This is an **example contract**, not the response of an existing generic route:

```json
{
  "ok": true,
  "created": true,
  "lead_id": "EXAMPLE-CRM-LEAD-UUID",
  "event_key": "meta:PAGE:FORM:LEAD"
}
```

On a replay, return the same lead ID with `created: false`, without overwriting later sales edits. A separate enqueue request must be independently idempotent, so recovery still works if the first intake response was lost.

## 3. Create your first Make scenario

1. Sign in to the intended Make organization/team.
2. Open **Scenarios** and choose the create-new-scenario action.
3. Name it clearly, for example **SaSSy | Example Business | Meta intake | STAGING**.
4. Leave automatic scheduling off while building.
5. Add the first trigger module using the plus button and search for the required application.
6. Create/select the intended connection. Confirm the account, business assets, and requested permissions.
7. Add later modules one at a time and map from real test output rather than guessing field paths.
8. Save the scenario after each meaningful change.
9. Use **Run once** only with controlled data and with downstream sending disabled or pointed at controlled recipients.
10. Inspect module input/output, filters, and execution history before adding automatic scheduling.

Make module labels and fields can change by app/version. The module names below are functional guides; use the equivalent currently shown in your account and verify its input/output.

**Important:** Run once can execute writes and send real messages. It is not automatically a dry run. Disable sending routes or use a backend's genuine validation-only mode first.

## 4. Scenario A: Facebook leads into SaSSy CRM

### Module layout

```text
Facebook Lead Ads: Watch Leads
  -> Filter: expected form and minimum fields
  -> JSON: Create JSON
  -> HTTP: POST to trusted intake endpoint
  -> Filter: successful persisted result
  -> Optional HTTP: enqueue approved staff alert
```

### Module 1 — Watch Leads

1. Add **Facebook Lead Ads → Watch Leads**, or the current supported polling equivalent.
2. Connect the authorized Meta account.
3. Select the exact Page and form. Confirm the account has leads access, not merely Page visibility.
4. Choose a conservative test limit and an appropriate starting point. Do not select all historical leads unintentionally.
5. Create a permitted synthetic form submission or use a retained test that you are authorized to replay.
6. Run the trigger in isolation and inspect the returned bundle.

Make also lists a **New Lead** trigger for its Facebook integration. If choosing an instant/webhook mode, follow its current setup requirements and verify acquisition. Polling and instant triggers have different behavior; do not enable both for the same source without stable deduplication.

A form may need a prior submission before it is available for retrieval. Do not delete real leads or repeatedly replace retained test submissions merely to make a picker refresh.

### Filter — accept only the intended source

Add a filter on the connection after the trigger:

- Page/form matches the approved source for this scenario.
- External lead ID exists.
- Submission timestamp and required contact fields exist.
- Test data is clearly identified during staging.

Send invalid records to a restricted diagnostic path or stop with a clear error. Do not invent missing names, dates, or consent to pass the filter. Backend validation remains mandatory even when the Make filter is correct.

### Module 2 — Create JSON

Add **JSON → Create JSON** and define a data structure agreed with the backend developer. Example normalized fields:

| Logical field | Source/mapping | Validation |
| --- | --- | --- |
| `source` | Fixed `meta_lead_ads` | Do not accept an arbitrary source type from submitted answers |
| `external_id` | Actual Meta lead identifier | Preserve as text; never convert long IDs to floating-point numbers |
| `page_id`, `form_id` | Verified Meta output/configuration | Must match a server-approved route |
| `submitted_at` | Original provider creation time | Include timezone; do not replace it with each retry time |
| `name` | The form's full-name answer | Required if the business/backend requires it |
| `phone` | Form phone answer | Preserve input; normalize/validate with known country context server-side |
| `email` | Form email answer, if present | Do not fabricate it for a phone-only form |
| `answers` | Approved custom answers | Map field by field; match CRM custom field keys |

Inspect whether your trigger returns a field directly or inside an answer array. Use the relevant answer value, not the whole bundle. Do not copy module numbers from screenshots: Make assigns different IDs in different scenarios.

Use the JSON module so quotation marks, newlines, and backslashes are escaped properly. Hand-building JSON with pasted customer text can break requests or alter their structure. Do not include credentials, workspace IDs chosen by respondents, roles, ownership overrides, or unverified consent flags.

### Module 3 — Send to the trusted backend

Add **HTTP → Make a request** or the current equivalent:

| Setting | Value |
| --- | --- |
| Method | `POST` |
| URL | Your implemented HTTPS intake endpoint, for example `/integrations/make/intake` on your backend origin |
| Authentication | The scoped machine credential agreed with the backend developer |
| Content type | `application/json` |
| Body | The output string/object from Create JSON, according to the HTTP module's body mode |
| Parse response | Enabled when available, so response fields can be mapped |

Use HTTP's dedicated **Credentials** configuration for secrets. Configure the required authentication header through that facility. Do not place a secret in the URL query string or ordinary body fields.

Run with one synthetic event. Confirm the returned lead ID corresponds to exactly one record in the intended workspace. Replay the same event and confirm the same ID is returned without duplicate records or lost staff edits.

### Module 4 — Optional internal notification

After successful persistence, call the proposed enqueue endpoint to request a named, pre-approved staff notification. The backend resolves its permitted recipient and template; the form submitter must not be able to select an arbitrary notification address.

Use a stable logical key such as:

```text
business-route + source + page + form + external-lead-id + internal-alert-v1
```

Do not filter only on `created = true`. If Supabase saved the lead but its first response was lost, intake retry may return `created = false` even though the first alert still needs to be queued. Intake deduplication and notification idempotency must be separate.

Verify actual receipt of the controlled internal alert, not just a green HTTP module. An internal staff alert does not opt the lead into marketing.

## 5. Scenario B: WhatsApp and Brevo follow-ups

**Prerequisite:** the backend implements provider adapters, scheduling/eligibility, consent, outbox processing, and the proposed Make authorization endpoints. This is not enabled by connecting the health-only Worker.

### Recommended scheduled scenario

```text
Make schedule
  -> HTTP: POST /integrations/make/dispatch-due
  -> Router: completed / accepted for processing / needs review
       +-> Restricted operations alert for actionable failures
```

The backend should select and claim due jobs atomically. Do not have several Make runs independently query “unsent” rows and send them without claims; both may dispatch the same message.

### Configure the request

1. Create **SaSSy | Example Business | Due follow-ups | STAGING**.
2. Add an HTTP request authenticated with that business's scoped integration credential.
3. Use the backend's documented body, such as a bounded batch limit and a real `dry_run` option **only if implemented**.
4. The backend chooses eligible jobs; Make does not submit an arbitrary workspace or provider token.
5. Parse the response and route based on its actual status. If it only accepts a job, use a supported run-status endpoint or backend monitoring; do not label acceptance as delivery.
6. Test with one due appointment, one cancelled appointment, one opted-out contact, and a duplicate trigger.
7. Confirm only the eligible controlled destination receives a message.

### Choosing WhatsApp or Brevo

Channel selection should be an approved policy, not an uncontrolled fallback:

- **WhatsApp:** use that business's authorized sender and permitted approved template or valid service-window message.
- **Brevo email:** use the mapped verified sender and appropriate transactional/marketing template.
- **No permitted channel:** skip safely or create a staff action; do not message without consent to keep the scenario green.
- **WhatsApp failed:** do not automatically send email unless the customer is separately eligible for that email and the failure policy permits it.

For a visible Make Router, branch on the backend's validated channel/eligibility response. Both routes should call approved backend actions. Never rely on a user-editable field such as `can_send=true` without revalidation on the server.

### If the provider call must run inside Make

This is an alternative delivery design, not a shortcut around backend requirements:

1. Claim a job through a trusted backend, obtaining a bounded, validated delivery specification.
2. Use a connection restricted to the correct business's provider account.
3. For WhatsApp, call Meta's supported versioned message API with the correct phone/account context, approved content, and recipient.
4. For Brevo, use its current native module if it supports the required fields, or HTTP `POST https://api.brevo.com/v3/smtp/email` with an API-key credential.
5. Immediately persist provider acceptance/message ID through an authenticated job-result endpoint.
6. Handle actual delivery through authenticated provider webhooks.
7. Mark a lost/uncertain send response for reconciliation. A later trigger must not blindly repeat it.

Job-claim and job-result endpoints, leases, provider credential isolation, and ambiguity handling must be designed and implemented. They are not part of the base CRM. For the current project, keeping provider dispatch inside the backend is the simpler security boundary.

## 6. Scenario C: a controlled Brevo internal-alert pilot

This explains a small Make-native email test after **verified CRM ingestion**, using one approved internal recipient. It is not the production architecture for customer marketing or a guarantee of exactly-once delivery.

### Modules

```text
Successful CRM intake result
  -> Data Store: check for alert marker
  -> Filter: marker does not exist
  -> JSON: create Brevo email body
  -> HTTP: Brevo transactional email API
  -> Data Store: record accepted-message marker
```

### Build the email request

1. Verify your business's sender/domain in Brevo and obtain its API key.
2. Store that key in Make HTTP's dedicated credential facility, configured for the `api-key` header.
3. Create a JSON structure containing a fixed authorized sender, a fixed internal recipient, subject, and text or HTML content.
4. Prefer plain text initially. If HTML includes lead data, escape that data; JSON escaping is not HTML escaping.
5. Set HTTP method `POST`, URL `https://api.brevo.com/v3/smtp/email`, content type `application/json`, and the JSON module's output as the body.
6. Parse the provider response and save the returned message identifier with the event marker.
7. Verify actual receipt and inspect Brevo delivery logs. The accepted marker must not be described as “delivered.”

Suggested internal subject: **SaSSy CRM | New enquiry for Example Business**.

Suggested plain-text content:

```text
A new enquiry has been saved in the CRM.

Name: [mapped name]
Contact: [mapped phone or email, if supplied]
Requirement: [approved mapped answer]
Submitted: [original date/time with timezone]

Open your CRM workspace to follow up.
```

Map these bracketed placeholders in Make. Do not leave them literal, paste real customer data into a reusable blueprint, or invent a direct lead URL; the current app does not provide a supported public deep link to an individual lead.

### Data Store setup

Create a Data Store dedicated to this pilot with a stable event/action key. Useful fields include `provider_message_id`, `accepted_at`, and an explicit status such as `accepted` or `review_required`.

Use **Check the existence of a record** or the current equivalent, then filter on a missing key. After confirmed provider acceptance, write/update the marker. Keep sequential processing enabled for this pilot to reduce overlap, but do not mistake it for a transaction or cross-scenario lock.

**Critical limitation:** the email can be accepted before its marker is saved. If the marker write fails, another run may send a duplicate. If the email response itself is uncertain, stop and reconcile it rather than letting an automatic retry send again. Inspect provider logs before replay; resume only the failed marker write when acceptance is known. A proper outbox/lease/reconciliation system is required for broader use.

Never use a pre-send “sent” marker to hide the issue; that can lose alerts when the send fails. Do not run this pilot's direct-email route and the backend's notification route for the same logical event.

## 7. Schedule and activate safely

1. Keep the scenario off while editing and during initial Run once tests.
2. In scenario settings, enable **Store incomplete executions** if available and appropriate. Make documents this as disabled by default.
3. Choose sequential/ordered processing when event order matters, especially for a marker-based pilot. Understand how unresolved failures may affect later processing.
4. Do not silently discard unfinished work when storage is full. Monitor capacity and plan recovery.
5. Open the scheduling control and choose an interval supported by your Make plan and provider quotas. For lead polling, 15 minutes can be an example starting point, not a guaranteed available or required setting.
6. Check the timezone and any active time window. Authentication, cron timing, and customer quiet hours are separate concerns.
7. Save and enable scheduling only after the correct connections and test destinations have been reviewed.
8. Observe a genuinely scheduled run using a controlled new event. A manual replay alone does not verify acquisition or scheduling.
9. Confirm the CRM record, message identity, actual receipt where applicable, and duplicate behavior.
10. Document the owner, failure alert destination, provider costs, and how to stop dispatch.

Stopping Make scheduling prevents future scheduled invocations. It may not cancel an already-running scenario or jobs already queued in the backend. Pause the backend delivery policy and cancel/review pending jobs separately when required.

## 8. Duplicate protection and error recovery

### Keep three identities separate

| Identity | Purpose | Example shape |
| --- | --- | --- |
| Source event ID | Save a provider submission once | Meta Page + form + lead ID |
| Logical action key | Queue one intended message/action | Source event + action/template version + channel |
| Provider message ID | Track the actual send and callbacks | ID returned by Meta/Brevo |

The same phone number can make two genuine enquiries. Deduplicating by phone alone can lose one. Conversely, giving a retry a new event ID can create duplicates.

### Configure error handling deliberately

| Failure | Response |
| --- | --- |
| Invalid/missing field or unapproved source | Stop that item, retain a safe diagnostic, correct the mapping/route; do not keep resending unchanged bad input |
| Authentication or forbidden access | Pause affected processing and fix the authorized connection; do not switch to a broad shared key |
| Idempotent intake request times out | Retry with the same external event ID; inspect the existing CRM record |
| Provider rate limit | Respect provider retry guidance with bounded backoff and preserved job identity |
| Provider send may have been accepted | Mark unknown/review required and reconcile before another send |
| Provider acceptance confirmed, marker/result save failed | Retry only the result/marker persistence, not the send module |
| Permanent recipient/template failure | Record a terminal safe failure and notify the responsible operator; do not retry forever |
| Duplicate delivery webhook | Deduplicate and apply state safely; do not create another outbound message |

Make supports incomplete executions and retries, but retry behavior must be evaluated per module. Automatic replay is appropriate only when the operation is safe to repeat. Do not attach a blanket retry handler to a non-idempotent email/WhatsApp send. Do not use Ignore to turn a failed CRM save or send into apparent success.

When reviewing an execution, record the time/timezone, module, source event ID, response status, and provider message ID if available. Keep secrets and unnecessary contact content out of incident messages and shared screenshots.

## 9. Maintain the existing property-specific workflow

The separate [Meta intake runbook](meta-lead-ingestion.md) records a historical chain of Facebook polling, JSON transformation, a trusted Supabase RPC, a Data Store check, Gmail, and a marker write. It is scoped to one business and form configuration. Its historical “Active” state is not live-verified by this guide.

If authorized to maintain that installation:

1. Read its runbook and inspect the current saved scenario before changing it.
2. Confirm the exact connected Page/form and approved destination. Do not copy a customer's IDs from another scenario.
3. Confirm the required additive migrations already exist. Do not rerun `saas.sql` or the full migration files to repair a Make mapping.
4. The existing trusted function expects a JSON object named `p_payload` when called through Supabase's RPC HTTP interface:

```text
POST https://YOUR-PROJECT.supabase.co/rest/v1/rpc/ingest_meta_lead
```

5. Its allowed payload fields include `meta_lead_id`, `page_id`, `form_id`, `submitted_at`, `full_name`, `phone_number`, and `enquiry_intent`. Full-form routes also require the property-specific answers defined in the migration. IDs and answer values are text; timestamps retain timezone information.
6. This RPC is restricted to the trusted server role. A public publishable key or ordinary CRM user's bearer token cannot call it. Preserve the operator-owned secure connection; never expose its elevated credential to customers or paste it into public instructions.
7. The route determines the workspace and validation variant server-side. Do not add caller-selected workspace, role, owner, or consent fields to bypass it.
8. The transformer contains property-specific custom fields and Delhi/INR defaults. Do not reuse it unchanged for a general SaSSy customer.
9. Preserve source IDs during retries. The CRM record and internal email marker have independent duplicate logic.
10. Verify trigger coverage and a real scheduled acquisition. An enabled database route is not proof that an old or new form is being polled.

Changing the internal alert from Gmail to Brevo is a separate provider migration: verify sender/recipient, test with controlled data, preserve marker identity, and disable the old sending path before enabling the new one. Do not run both and accidentally send two alerts. Review uncertain in-flight sends before cutover.

## 10. Handover checklist and references

### Before turning on a scenario

- [ ] Named owner, business, purpose, and environment.
- [ ] Correct Make organization/team and minimal connection permissions.
- [ ] Correct Page/form/trigger and deliberate starting point.
- [ ] Backend endpoints actually implemented; no placeholder URL or health-only gateway used as a sender.
- [ ] JSON mappings checked with real-shaped synthetic test bundles, including quotes and optional fields.
- [ ] Scoped credential configured in dedicated secret/connection fields.
- [ ] Server-side workspace routing, consent, suppression, and action authorization verified.
- [ ] Same-event replay tested; one lead and one logical action remain.
- [ ] Actual controlled-recipient delivery verified, separately from provider acceptance.
- [ ] Error routes, uncertain-send recovery, capacity limits, and alerts reviewed.
- [ ] Schedule/timezone/costs approved; scheduled acquisition observed.
- [ ] Pause procedure covers Make, already-running executions, and queued backend jobs.
- [ ] Shared blueprint/screenshots contain no credentials, personal data, or private invitation links.

### Keep a small operations record

Record the scenario name/link, business, purpose, connection owners, intended source, destination backend, action/template version, schedule/timezone, last controlled test, alert recipient, and rollback/pause instructions. Do not include secret values.

### Official documentation

These pages were retrieved while preparing this walkthrough. UI labels, plan limits, and module versions can change; check the current documentation and your own account before activation.

- [Make: create your first scenario](https://help.make.com/create-your-first-scenario).
- [Make: Facebook Lead Ads modules](https://apps.make.com/facebook-lead-ads).
- [Make: HTTP and credential configuration](https://apps.make.com/http).
- [Make: scenario scheduling](https://help.make.com/schedule-a-scenario).
- [Make: Data Stores](https://help.make.com/data-stores).
- [Make: incomplete executions](https://help.make.com/incomplete-executions).
- [Make: automatic retry of incomplete executions](https://help.make.com/automatic-retry-of-incomplete-executions).
- [Brevo: transactional email API](https://developers.brevo.com/docs/send-a-transactional-email).
- [Meta: WhatsApp setup](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).
- [SaSSy CRM integration contracts](integrations.md).
