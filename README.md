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

The governing rule: **prompts shape behavior; credentials and constraints
enforce security.** Anything that must hold 100% of the time never lives in
agent instructions.

- **Two agents, two WhatsApp numbers.** Patients text the clinic's public
  number and reach the *patient assistant* (availability + booking). The
  doctor texts a private admin number and reaches the *doctor assistant*
  (schedule management, day's bookings). The number IS the role boundary —
  Meta verifies the sender, the number selects the agent.
- **Credential = capability.** Both agents share one managed Postgres
  (Supabase), but each channel's Environment carries a connection URL for a
  different database role: `patient_role` can only read the schedule and
  insert bookings; `doctor_role` manages the schedule. The patient agent
  *physically cannot* modify the schedule, whatever the model does.
- **Constraint = invariant.** Double-booking prevention and clinic-hours
  bounds are database constraints in `schema/clinic.sql`, not prompt text.
- **No code, anywhere.** The whole assistant is YAML manifests + one
  declarative schema file. Nothing is built or hosted by the assistant
  builder.
- **The doctor manages the schedule over WhatsApp itself** — texting their
  assistant in plain language ("closed this Thursday"), with every change
  confirmed before it is written.
- **Conversation is never the system of record**; tools are the only write
  path, and the store behind them is swappable per customer (e.g., Google
  Calendar for clinics that already use one).
- **Attribution rides platform-verified identity.** Stigmer surfaces the
  sender's channel-verified WhatsApp number to the agent, so bookings are
  recorded against the real sender — patients are never asked to type
  (or able to fake) their own number.

## Repository layout

```
agent/patient/  Patient assistant: manifest + instructions (public number)
agent/doctor/   Doctor assistant: manifest + instructions (private admin number)
channel/        Two AgentChannel + two Environment manifests
schema/         clinic.sql — tables, constraints, roles, grants, bootstrap data
conversations/  Conversation design: happy paths and edge-case scripts
docs/           Friction log; setup notes and onboarding runbook to follow
```

## Status

Early development. The team is building and dogfooding the first version.
