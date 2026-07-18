# Friction log

Running record of everything that made this assistant harder to build than
"write YAML, get an agent" promises. This is a first-class deliverable: input
to (a) the clinic onboarding runbook and (b) the requirements for a future
first-class Stigmer records/identity primitive.

Format: date — friction — severity — platform signal.

## 2026-07-18 — Agent could not see the WhatsApp sender's number

**Severity: blocker (resolved).** The platform captured the sender's `wa_id`
(webhook row, JWT claim, session label) but never surfaced it to the agent's
prompt, so a booking could not be attributed to the patient without asking
them to type their own number. Resolved by a platform change: the channel
broker now stamps the verified sender identity (value + kind) into the
session's metadata at creation, and both runner harnesses read it into prompt
context (`shared/sender-identity.ts`). **Signal**: identity should eventually
be injected into tool calls / RLS server-side, making attribution
deterministic too, not just prompt-context.

## 2026-07-18 — No role concept on a single channel

**Severity: design-shaping (worked around).** The channel runtime treats
every sender identically; there is no way to give the doctor's number admin
behavior on the same channel deterministically. Worked around with the
two-agent, two-number architecture (channel = role), which costs the clinic
a second WhatsApp Business number. **Signal**: single-number, sender-based
role dispatch (route a registered admin number to a different agent or
capability set) would remove the second number entirely.

## 2026-07-18 — Supabase management MCP is too powerful for per-agent credentials

**Severity: design-shaping (worked around).** The seedpack `supabase` MCP
server authenticates with a personal access token — project-management scope,
not narrowable per agent. Privilege separation had to move down a layer: the
seedpack `postgres` MCP server with one connection URL per Postgres role.
Works, but the operator now manages DB roles and passwords by hand in the
SQL editor. **Signal**: a first-class records primitive with YAML-declared
collections, constraints, and role-aware access would eliminate both the
Supabase signup and the role management.

## 2026-07-18 — No effective-dated schedule changes

**Severity: minor (accepted).** "From next month I'll sit 9–12" cannot be
stored; the schema has a single standing weekly schedule plus date
exceptions. The doctor agent is instructed to be honest about this and offer
to apply now or be reminded later. Revisit if pilots hit it often.

## 2026-07-18 — Supabase "Enable RLS" nudge silently breaks the grant model

**Severity: onboarding trap (resolved).** The Supabase dashboard warns loudly
about tables without RLS and nudges the operator to enable it. Enabling RLS
with **no policies** default-denies the two agent roles: reads return zero
rows (no error at all!) and writes fail with an RLS violation — it looked
like the bootstrap schedule was never inserted. Our access model is role
grants, and the Data API can't reach the tables anyway (`public`/`anon` hold
no grants), so RLS adds nothing here. Fixed by adding explicit
`disable row level security` statements to `schema/clinic.sql` (self-healing
on re-run) with a comment explaining the intent. **Runbook**: tell operators
to ignore the RLS banner for clinic tables; **Signal**: a first-class records
primitive would remove this entire class of managed-store footguns.

## Open items to watch during the pilot

- Meta app + second number setup effort (the doctor line) — record the
  actual wall-clock time and steps when it happens.
- Whether the ~25s WhatsApp typing-indicator window is long enough for
  availability answers that need several SQL reads.
- Whether constraint-violation error text from the postgres MCP server is
  clean enough for the agent to recognize reliably (raw Postgres errors
  verified clean and specific in T02 via psql; watch how the MCP server
  relays them during console/WhatsApp use).
