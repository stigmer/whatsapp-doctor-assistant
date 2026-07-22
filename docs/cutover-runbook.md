# Cutover runbook: one agent, one number, zero external stores

Step-by-step operator guide to move the clinic from the two-agent
Supabase architecture to the single clinic assistant backed by the
`clinic-records` Datastore. Follow it top to bottom. Each step is safe
to stop after; the order is load-bearing.

The Meta groundwork does not change: the existing Meta app, WABA, and
the clinic's public number stay exactly as
[connect-whatsapp-runbook.md](connect-whatsapp-runbook.md) set them up.
The private admin number is retired — the doctor texts the same number
as patients.

## What changes

| Before (two agents) | After (one agent) |
|---|---|
| Two agents, two numbers | One agent (`clinic-assistant`), the public number |
| Supabase project + `schema/clinic.sql` | `datastore/clinic-records.yaml`, applied like any resource |
| Two DB roles + two Environments with connection URLs | No credentials anywhere: record access rides the platform's own session credential |
| Privilege = which number you texted | Privilege = who is texting: the doctor's WhatsApp number is bound to `admin` in the datastore; everyone else is `patient` |
| `tool_approval_overrides` un-gating 9 postgres tools | Nothing to un-gate: record tools are approval-free by construction |
| Invariants in SQL constraints + a plpgsql trigger | The same invariants declared in the datastore YAML, enforced on every write |

## Before you start

- [ ] The platform release carrying the Datastore primitive is deployed
      (record RPCs live, records storage provisioned, the runner's
      bridge endpoint configured).
- [ ] CLI context points at the clinic org (`rakeshreddi098`), not the
      default org: `stigmer config get-contexts`.
- [ ] You have the doctor's WhatsApp number in **wa_id form: digits
      only, no `+`, no spaces** (e.g. `919800000001`). A `+` makes the
      admin binding silently never match — the doctor would be served
      as a patient.
- [ ] Node 20+ available for the verification scripts (`scripts/`).

## Step 1 — Apply the datastore, dark

Fill `<DOCTOR_WA_ID>` in `datastore/clinic-records.yaml` (digits only),
set `metadata.org`, then:

```bash
stigmer validate -f datastore/clinic-records.yaml
stigmer apply -f datastore/clinic-records.yaml
```

The apply materializes the three collections and every constraint,
loudly — a failed index or constraint fails the apply naming the
constraint. Nothing references the datastore yet ("dark"), so mistakes
at this step are free to redo.

## Step 2 — Dry-run the verification (reset-based re-runs)

```bash
cd scripts && npm install
npm run acceptance     # exercises every clinic invariant against the dark datastore
```

All cases must pass (double-booking, clinic hours, closed dates,
half-hour grid, attribution). To re-run from scratch: a dark,
unreferenced datastore deletes cleanly — `stigmer delete datastore
clinic-records`, re-apply, re-run. Reset, not tracking, is the
idempotency mechanism.

The acceptance run cleans up after itself; the datastore is empty again
when it passes.

## Step 3 — Freeze the channel

Disable the OLD patient channel (`clinic-patient-whatsapp`) so no write
races the cutover: set `spec.enabled: false` and re-apply, or disable it
in the console. Patients get no replies for the few minutes of cutover —
schedule it outside clinic hours.

## Step 4 — Onboard the schedule (the doctor does this, conversationally)

Apply the new agent and repoint the number:

```bash
stigmer apply -f agent/clinic-assistant.yaml
stigmer apply -f channel/clinic-channel.yaml   # public number -> clinic-assistant
```

Then the doctor texts the clinic number from their own phone (the one
bound as `admin`) and tells the assistant their hours in plain language
("I sit 10 to 1 and 5 to 8, Monday to Saturday"). The assistant
confirms, writes the sessions, and reads the schedule back.

Verify from the operator seat:

```bash
cd scripts && CLINIC_ORG=rakeshreddi098 STIGMER_API_KEY=... npm run verify
```

12 rows, read back in plain words. (The `npm run seed` path exists as
the scripted alternative and the general migration-story prototype —
but the conversational path is the product demonstrating itself, and it
proves the admin binding end-to-end.)

Living bookings from the pilot are **let-expire** (developer ruling):
the handful of upcoming appointments stay on the doctor's paper/memory
or are re-entered conversationally the same way.

## Step 5 — Live acceptance

From a phone that is NOT the doctor's:

1. Ask for availability → the assistant reads the schedule and offers
   real slots.
2. Book a slot → confirmation with exact date/time; the booking's
   attribution is the verified sender (never typed in).
3. Book the same slot from another phone → polite "already booked".
4. Ask to change the schedule → clean refusal (patients hold no
   schedule write).

From the doctor's phone:

5. "What's my day tomorrow?" → the day's bookings.
6. "Close next Thursday" → confirm-before-write, then the exception
   lands and bookings for that date are refused.

## Step 6 — Soak, then decommission

Run both stacks' teardown only after a soak week with no incident:

- [ ] Delete the Supabase project (both role credentials die with it).
- [ ] Delete both Environments (`clinic-patient-db`, `clinic-doctor-db`).
- [ ] Delete the old channels (`clinic-patient-whatsapp`,
      `clinic-doctor-whatsapp`) and both old agents
      (`clinic-patient-assistant`, `clinic-doctor-assistant`).
- [ ] Release the private admin number (or keep it for the next dogfood).

The legacy manifests and `schema/clinic.sql` are already removed from
this repo (git history holds them); this step tears down the DEPLOYED
legacy resources they described. After it, nothing outside the platform
holds clinic records.

## Rollback

Until step 6 executes, rollback is one step: re-enable the old patient
channel (`spec.enabled: true`) and disable the new one. The Supabase
stack is untouched through the soak.
