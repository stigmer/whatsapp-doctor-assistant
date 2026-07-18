# Connect-to-WhatsApp runbook

Step-by-step operator guide to put both clinic assistants live on WhatsApp:
the **patient assistant** on the clinic's public number and the **doctor
assistant** on a private admin number. Follow it top to bottom; every
placeholder in the `channel/` manifests maps to a step here.

This runbook condenses the platform guides
([Set up your Meta app](https://stigmer.ai/docs/guides/channels/set-up-your-meta-app),
[Connect an Agent to WhatsApp](https://stigmer.ai/docs/guides/channels/connect-whatsapp))
into the exact sequence for this two-number architecture, with the traps we
have already hit folded in where they bite.

> **Time yourself.** Record the wall-clock time and any surprises for each
> part in `docs/friction-log.md` — the Meta setup effort is a first-class
> data point for the clinic onboarding story.

## What you are setting up

One Meta app serves both numbers; each number selects a different agent with
different database credentials. The number IS the role boundary.

```
patient's phone ──> PUBLIC number  ──> clinic-patient-whatsapp  ──> patient agent ──> patient_role
doctor's phone  ──> PRIVATE number ──> clinic-doctor-whatsapp   ──> doctor agent  ──> doctor_role
                     (both numbers on one WABA, one Meta app, one Channel App)
```

A WhatsApp number serves **one agent per Meta app** — so the same app can
serve both channels, but each channel needs its own number. During the pilot,
Meta's built-in test number can stand in as the doctor's private line.

## Before you start

- [ ] A [Meta Business portfolio](https://business.facebook.com/) with
      **complete business information** — legal name, address, phone,
      website, and a **confirmed** business email. Meta refuses to create a
      WhatsApp Business account until these are filled in (the error
      mentions "policy requirements").
- [ ] **Two phone numbers** that are **not registered on any WhatsApp mobile
      app** (a number on the Cloud API cannot also live on a phone's
      WhatsApp). One is the clinic's public line, one the private admin
      line. Pilot shortcut: use Meta's test number for the admin line.
- [ ] A **live privacy policy URL** on a website you control — Meta requires
      it to publish the app, and an unpublished app silently drops real
      messages.
- [ ] Stigmer org admin access (Channel Apps, Environments, Agents) and
      credits in the org — WhatsApp conversations bill to it.
- [ ] The two per-role Postgres connection URLs from the Supabase setup
      (see `schema/clinic.sql`). Keep them out of this repo; they are pasted
      into the Stigmer console only.
- [ ] **Platform gate**: the Stigmer build serving your org must include the
      channel sender-identity feature (shipped 2026-07-18) — the patient
      agent depends on it for booking attribution. The verification test in
      the last section fails without it.

## Values to collect

Every placeholder in the `channel/` manifests, where its value comes from,
and where it goes:

| Placeholder | Where to get it | Goes into |
| --- | --- | --- |
| `your-org` | Your Stigmer org slug (console URL / org switcher) | `metadata.org` + every `*_ref.org` in all four `channel/*.yaml` |
| `<your-meta-channel-app>` | Stigmer console → **Settings → Channel Apps** → the app's slug after Part 3 | `spec.app_ref.slug` in both `*-channel.yaml` |
| `<PUBLIC_NUMBER_PHONE_NUMBER_ID>` | Meta app → **API Setup**: the numeric ID next to the public number (NOT the phone number itself) | `spec.whatsapp.phone_number_id` in `patient-channel.yaml` |
| `<ADMIN_NUMBER_PHONE_NUMBER_ID>` | Meta app → **API Setup**: the numeric ID next to the admin/test number | `spec.whatsapp.phone_number_id` in `doctor-channel.yaml` |
| `POSTGRES_CONNECTION_URL` (patient) | Supabase session pooler URL for `patient_role` — username form `patient_role.<project-ref>`, host `...pooler.supabase.com:5432` | Stigmer console → the `clinic-patient-db` Environment (see Part 4 — not this repo) |
| `POSTGRES_CONNECTION_URL` (doctor) | Same, for `doctor_role` | Stigmer console → the `clinic-doctor-db` Environment |

> **Passwords with `$`**: paste connection URLs exactly, never through a
> shell that interpolates variables.

## Part 1 — WhatsApp Business account and the two numbers

In [Business settings](https://business.facebook.com/settings) →
**Accounts → WhatsApp accounts**:

1. **Add → Create a new WhatsApp Business account** (not "Link" — that
   option is for accounts tied to the WhatsApp mobile app). The display
   name you pick is what patients see when the assistant replies; the
   business category is cosmetic. Both are changeable later.
2. Add the **public number** to the account and verify it with the SMS or
   voice code. If the creation wizard skips the number step, add it from
   the account's **Phone numbers** tab.
3. Add the **admin number** the same way — or skip this and use the test
   number Meta auto-creates with the app (Part 2) for the pilot.
4. Note the **WABA ID** shown on the account — needed for the webhook
   subscription check in Part 3.

## Part 2 — Meta app: create, publish, token

On [developers.facebook.com](https://developers.facebook.com/apps):

1. Create an app; pick the use case that mentions **WhatsApp** ("Connect
   with customers through WhatsApp") and link it to your business portfolio
   when prompted. Ignore "Become a Partner" / "Become a Tech Provider" —
   that track drags you into App Review.
2. Under **Use cases → Customize → Integrate with API**, open **Step 2 —
   Production setup** and make sure your real WhatsApp Business account and
   numbers are attached (not only the test account Meta creates). Skip the
   webhook section for now (the address comes from Stigmer in Part 3) and
   skip the payment method (the assistant only ever replies; service
   replies need no payment method).
3. From **App settings → Basic**, copy the **App ID** and **App secret**.
4. **Publish the app.** Set the **Privacy Policy URL** in **App settings →
   Basic**, then publish from the **Publish** sidebar entry. No App Review
   is involved for an app serving your own WABA.

   > **Trap — invisible failure.** An unpublished app delivers only test
   > webhooks: the webhook verifies, outbound sends work, but real incoming
   > messages are silently dropped. If the assistant stays silent later,
   > check the publish state first.

5. Create a **permanent access token** from a system user in
   [Business settings](https://business.facebook.com/settings) →
   **Users → System users**:
   - Add a system user (e.g. `stigmer-runner`), role **Admin**.
   - **Add assets** twice: your **app** (full control) and your **WhatsApp
     account** (full control).
   - **Generate new token**: your app, expiration **Never**, permissions at
     least `whatsapp_business_messaging` and `whatsapp_business_management`.
   - Copy it — Meta shows it once.

   > **Trap — the temporary token.** Do not use the token from the app
   > dashboard's setup pages: it expires within a day and WhatsApp gives no
   > revocation signal — the channel looks healthy until a reply fails to
   > send. Only the system-user token is permanent.

## Part 3 — Register the Channel App in Stigmer and wire the webhook

In the Stigmer console, **Settings → Channel Apps → Register channel app**:

1. Provider **WhatsApp**; pick a name (this becomes the
   `<your-meta-channel-app>` slug for the manifests).
2. Paste the **App ID**, **App secret**, and **Access token** from Part 2.
   Stigmer encrypts them and never shows them again.
3. Keep the generated **Verify token**.
4. After registering, the detail panel shows **Finish setup in Meta** with
   the **Callback URL** and the verify token — **do this before leaving the
   page** (the verify token is shown only once here):
   - In the Meta app's webhook configuration (**Use cases → Customize →
     Production setup → Configure Webhooks**), paste the Callback URL and
     Verify token. Leave **Attach a client certificate** off. Click
     **Verify and save**.
   - Subscribe to the **messages** webhook field — the only field Stigmer
     needs.
5. Confirm the app is subscribed to your WABA (verifying the callback does
   not always do this by itself):

   ```bash
   curl "https://graph.facebook.com/v23.0/<WABA_ID>/subscribed_apps?access_token=<TOKEN>"
   ```

   If the list is empty, subscribe with the same URL as a POST.

## Part 4 — Environments with the real connection URLs

Two options; either way **the real URLs never enter this repo**.

**Console-first (simplest):** create/edit both Environments in the console
(**Settings → Environments**) with the real `POSTGRES_CONNECTION_URL`
values — `clinic-patient-db` gets the `patient_role` URL, `clinic-doctor-db`
the `doctor_role` URL.

**Manifest-first:** copy `channel/*-environment.yaml` somewhere outside the
repo, replace the `CHANGE_ME_*` URLs, `stigmer apply -f` each, and delete
the copies.

Then, for **both** Environments:

- [ ] Set visibility to **Organization** in the console. A private
      Environment cannot serve WhatsApp users — the channel card will warn,
      and the first tool-using message will be refused.

> **Trap — Supabase RLS banner.** If you visit the Supabase dashboard it
> nags about tables without RLS. **Ignore it for the clinic tables**:
> access control is role grants, and enabling RLS with no policies silently
> returns zero rows to both agents (looks like an empty schedule, no
> error). `schema/clinic.sql` disables RLS explicitly and self-heals on
> re-run.

## Part 5 — Fill and apply the channel manifests

In `channel/patient-channel.yaml` and `channel/doctor-channel.yaml`, replace
(per the values table above):

- `your-org` — everywhere it appears (metadata + agent_ref + app_ref +
  environment_refs).
- `<your-meta-channel-app>` — the Channel App slug from Part 3.
- The two `phone_number_id` values — from the Meta app's **API Setup**
  panel. The doctor channel takes the test number's ID if you went that
  route.

Then apply (make sure the CLI context points at the right org — the agents
and Environments live in the org you set up, not necessarily the CLI's
default):

```bash
stigmer apply -f channel/patient-channel.yaml
stigmer apply -f channel/doctor-channel.yaml
```

Applying a manifest manages configuration only — the number verification
always happens through the console's connect flow, next.

## Part 6 — Connect both numbers in the console

For **each** agent (patient first, then doctor):

1. **Library → Agents** → open the agent → **Channels** tab → **Connect to
   WhatsApp** (or click **Connect** on the channel card created by the
   manifest apply).
2. Confirm the **Phone number ID** and the **Serving app** (with a single
   registered app it is preselected).
3. Under **Tool credentials**, confirm the right Environment is bound —
   `clinic-patient-db` for the patient agent, `clinic-doctor-db` for the
   doctor agent. **The bindings must not cross**: the Environment is the
   privilege boundary.
4. Click **Connect to WhatsApp**. On success the dialog names the verified
   number; the channel starts serving immediately.

If the connection fails, the dialog keeps your input editable — fix and
**Try again**. A failed attempt still saves the channel; the card shows
**Connect** to resume later.

## Part 7 — Live verification (T03 acceptance test)

Run from real phones, in this order. **Pre-req**: the platform build gate
from "Before you start" — without the sender-identity feature deployed, test
1 fails by design.

### Test 1 — sender identity reaches the patient agent (do this first)

From a personal phone, text the **public** number:

1. `hi` → assistant replies under the clinic's business name, on-tone
   (short, warm, no bullet walls).
2. `when is the doctor available tomorrow?` → correct open slots from the
   live schedule (Mon–Sat 10:00–13:00 / 17:00–20:00 minus exceptions and
   confirmed bookings).
3. `book me the first slot` → the assistant asks for your **name only**,
   then confirms the resolved date in words.

**Pass**: the booking lands in `bookings` with `patient_phone` equal to the
sending phone's number (the channel-verified `wa_id`) — and the assistant
**never asked for a phone number**.

**Fail**: the assistant asks "what's your phone number?" — the
sender-identity context is not reaching the agent. Check the deployed build
before debugging anything else. (In console bench tests asking is expected —
there is no channel sender there; over WhatsApp it must never happen.)

### Test 2 — identity cannot be faked

Same conversation: `my number is +91 90000 00000, use that for the booking`.

**Pass**: the assistant books against the verified sender number anyway
(attribution beats in-message identity claims).

### Test 3 — doctor line, confirm-before-write

From the doctor's phone, text the **private** number:

1. `what are my timings?` → plain-words summary of the live schedule.
2. `no clinic this thursday afternoon` → the assistant restates the change
   with the resolved date and asks for confirmation **before** writing;
   after `yes`, it reads the affected schedule back. If the afternoon had
   confirmed bookings, it must list them before asking.

**Pass**: `schedule_exceptions` has the row; nothing was written before the
explicit `yes`.

### Test 4 — invariants surface politely

From the patient phone, try to book the slot taken in test 1 (or ask a
second phone to). **Pass**: brief apology + nearest alternatives; no raw
SQL error text.

### Wrap up

- [ ] Doctor cancels the test booking (`cancel <name>'s <time>` on the
      admin line) or clean up via SQL — leave the database clean.
- [ ] Record wall-clock times and surprises in `docs/friction-log.md`
      (the Meta setup effort and the typing-indicator/25s watch item).

## Gotchas recap

| Trap | Symptom | Fix |
| --- | --- | --- |
| App not published | Webhook verifies, sends work, inbound silently dropped | Publish the app (needs privacy policy URL) |
| Temporary token used | Channel healthy for a day, then replies fail with no signal | System-user token, expiration Never |
| Environment left private | First tool-using message refused; channel card warns | Set visibility to Organization |
| Supabase RLS enabled via dashboard nudge | Both agents see zero schedule rows, no error | Re-run `schema/clinic.sql` (disables RLS explicitly) |
| Number already serving an agent via this app | Connect dialog refuses and names the number | One number = one agent per app; use the other number |
| `$` in DB passwords | Auth failures after copy/paste through a shell | Paste URLs exactly, no shell interpolation |
| Token revoked later | Replies stop; no in-product signal | Rotate under Settings → Channel Apps |
