# WhatsApp Doctor Appointment Assistant

A WhatsApp assistant built on [Stigmer](https://stigmer.ai) that helps patients
check a doctor's availability and book appointments — right from WhatsApp, with
no new app for the patient or the doctor.

This is the first end-to-end showcase of **Stigmer Channels**: an Agent connected
to a WhatsApp Business number, aimed at local businesses (starting with small
clinics) that want an always-on assistant on the messaging app their customers
already use.

## What it does (v1)

- Answers patient questions about the doctor's timings and availability
- Books an appointment slot in conversation ("book me Friday evening")
- Knows the doctor's weekly schedule and exceptions (day off, vacation)

Out of scope for v1: patient history, reminders/outbound messages, payments,
multiple doctors on one number.

## How it works

The assistant is a Stigmer Agent served through a WhatsApp `AgentChannel`.
Patients message the clinic's WhatsApp Business number; the Agent answers with
schedule-aware responses and books slots through its tools. See the
[Connect an Agent to WhatsApp](https://stigmer.ai/docs/guides/channels/connect-whatsapp)
guide for the underlying channel mechanics.

## Architecture (decided)

- **No code, anywhere.** The assistant is YAML manifests + one declarative
  schema file. Nothing is built or hosted by the assistant builder.
- **Business records** (schedule, exceptions, bookings) live in a managed
  Postgres (Supabase) reached through Stigmer's seedpack MCP server. Invariants
  like double-booking prevention are database constraints, not prompt text.
- **The doctor manages the schedule over WhatsApp itself** — texting the same
  assistant from their registered number ("closed this Thursday"), with every
  change confirmed before it is written. Patients get read-and-book.
- **Conversation is never the system of record**; tools are the only write
  path, and the store behind them is swappable per customer (e.g., Google
  Calendar for clinics that already use one).

## Repository layout

```
agent/          Agent definition: manifest and instructions
channel/        AgentChannel + Environment manifests for the WhatsApp connection
schema/         Declarative schema for the records store (schedules, bookings)
conversations/  Conversation design: happy paths and edge-case scripts
docs/           Setup notes, onboarding runbook, friction log
```

Folders are added as the assistant takes shape — this repository starts empty
by design and grows with the build.

## Status

Early development. The team is building and dogfooding the first version.
