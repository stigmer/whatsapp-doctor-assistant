# WhatsApp Doctor Appointment Assistant

A WhatsApp assistant built on [Stigmer](https://stigmer.ai) that helps patients
check a doctor's availability and book appointments — right from WhatsApp, with
no new app for the patient or the doctor.

This is the reference **"write YAML, get an assistant"** pattern: one Agent
manifest, one Datastore manifest, one WhatsApp channel. No database signup, no
credentials, no code, nothing hosted by the assistant builder.

## What it does (v1)

- Answers patient questions about the doctor's timings and availability
- Books an appointment slot in conversation ("book me Friday evening")
- Knows the doctor's weekly schedule and exceptions (day off, vacation)
- Lets the doctor manage the schedule and read the day's bookings — on the
  same number, in plain language

Out of scope for v1: patient history, reminders/outbound messages, payments,
multiple doctors on one number.

## How it works

The assistant is a Stigmer Agent served through a WhatsApp `AgentChannel`.
Its records live in a Stigmer `Datastore` — collections, constraints, and
role grants declared in YAML and enforced by the platform on every write.
See [Connect an Agent to WhatsApp](https://stigmer.ai/docs/guides/channels/connect-whatsapp)
for the channel mechanics.

## Architecture

The governing rule: **prompts shape behavior; constraints and grants
enforce security.** Anything that must hold 100% of the time never lives in
agent instructions.

- **One agent, one WhatsApp number.** Patients and the doctor text the same
  clinic number. The platform verifies who is texting; the datastore binds
  the doctor's number to the `admin` role and everyone else defaults to
  `patient`. The agent discovers what the current caller may do by calling
  `describe_datastore` — no "if doctor" branches in the prompt.
- **Grant = capability.** A patient asking the agent to change the schedule
  gets a clean permission error from the store, whatever the model does.
  Patients can cancel only bookings they created — ownership is the
  server-stamped attribution, never a claim.
- **Constraint = invariant.** Double-booking prevention, clinic-hours
  bounds, and closed-date checks are declared in
  `datastore/clinic-records.yaml` and enforced inside every write
  transaction, with polite, relayable rejection messages.
- **Zero credentials.** No database, no connection URLs, no Environments:
  record access rides the execution's own platform credential, resolved
  server-side per call. The record tools are approval-free by construction —
  nothing to un-gate.
- **Conversation is never the system of record**; the record tools are the
  only write path, and the store behind them is swappable per customer
  (e.g., Google Calendar via MCP for clinics that already use one).
- **Attribution rides platform-verified identity.** Every booking carries
  the channel-verified sender identity, server-stamped. Patients are never
  asked to type (or able to fake) their own number.

## Repository layout

```
datastore/      clinic-records.yaml — collections, constraints, roles, grants
agent/          clinic-assistant.yaml — the one agent (patients + doctor)
channel/        clinic-channel.yaml — the clinic's WhatsApp number
scripts/        seed-schedule.ts (seed + verify), acceptance-matrix.ts,
                clinic-records.local.yaml (local-acceptance variant)
conversations/  Conversation design: happy paths and edge-case scripts
docs/           cutover-runbook.md — move from the legacy stack to this one
                connect-whatsapp-runbook.md — Meta app / number setup
                friction-log.md — the requirements record for the platform
```

The first architecture (two agents, two numbers, Supabase with per-role
credentials) has been removed from this repo; its manifests and
`schema/clinic.sql` live in git history. The deployed legacy stack is
decommissioned by the cutover runbook's final step.

## Status

Rebuilt on the Stigmer Datastore primitive. The legacy Supabase-backed
pilot serves live traffic until the cutover completes.
