# Connect-to-WhatsApp runbook

> **Superseded architecture note (2026-07-22).** The two-agent /
> two-number design this runbook sets up is retired by the Datastore
> rebuild: one agent on one number, doctor-vs-patient privilege resolved
> from the sender identity, no Environments and no database credentials.
> Parts 1–3 (Meta Business portfolio, Meta app, Channel App, webhook)
> remain the accurate reference for the Meta side; Parts 4–7 describe
> the legacy stack only, whose manifests have been removed from this
> repo (git history holds them). For the current architecture and the
> migration, follow [cutover-runbook.md](cutover-runbook.md).

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

## What already exists (from the first WhatsApp dogfood, 2026-07-17)

The expensive one-time Meta groundwork is done and is being reused:

- The **Meta Business portfolio** ("Stigmer") exists with complete business
  info and a confirmed business email — the fresh-portfolio policy gate
  that costs ~15 minutes of confusing errors is already cleared.
- A **live privacy policy URL** exists (`stigmer.ai/privacy`) — publishing
  a new Meta app is now a two-minute step, not a build-a-page detour.
- A **system user** with admin role already exists in Business settings —
  new apps only need to be added to it as assets.
- A published Meta app ("Workshop") already serves another Stigmer org's
  channel. **It cannot serve the clinic**: a Meta app has exactly one
  webhook callback, and that app's webhook is already bound to the other
  org's Channel App. The clinic gets its own app under the same portfolio.

What is still genuinely new for the clinic: **one new Meta app**, **new
number(s)** (or the new app's test number), and everything on the Stigmer
side in the clinic org (`rakeshreddi098`).

## What you are setting up

One new Meta app serves both clinic numbers; each number selects a
different agent with different database credentials. The number IS the role
boundary.

```
patient's phone ──> PUBLIC number  ──> clinic-patient-whatsapp  ──> patient agent ──> patient_role
doctor's phone  ──> PRIVATE number ──> clinic-doctor-whatsapp   ──> doctor agent  ──> doctor_role
        (both numbers on one clinic WABA, one new Meta app, one Channel App —
         all under the existing Stigmer business portfolio)
```

A WhatsApp number serves **one agent per Meta app** — so the same app can
serve both channels, but each channel needs its own number. During the pilot,
the new app's built-in test number can stand in as the doctor's private line.

## Before you start

- [ ] Access to the existing **Meta Business portfolio** (business.facebook.com)
      and to [developers.facebook.com](https://developers.facebook.com/apps)
      under the same Meta account that ran the first dogfood.
- [ ] **One or two phone numbers** that are **not registered on any WhatsApp
      mobile app** (a number on the Cloud API cannot also live on a phone's
      WhatsApp). The clinic's public line is required; for the private admin
      line the new app's test number works during the pilot.
- [ ] Admin access to the clinic Stigmer org (`rakeshreddi098`) — Channel
      Apps, Environments, Agents — and credits in it (WhatsApp conversations
      bill to the org).
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
| `your-org` | The clinic Stigmer org slug — `rakeshreddi098` (already pinned in the agent manifests) | `metadata.org` + every `*_ref.org` in all four `channel/*.yaml` |
| `<your-meta-channel-app>` | Stigmer console → **Settings → Channel Apps** → the app's slug after Part 3 | `spec.app_ref.slug` in both `*-channel.yaml` |
| `<PUBLIC_NUMBER_PHONE_NUMBER_ID>` | Meta app → **API Setup**: the numeric ID next to the public number (NOT the phone number itself) | `spec.whatsapp.phone_number_id` in `patient-channel.yaml` |
| `<ADMIN_NUMBER_PHONE_NUMBER_ID>` | Meta app → **API Setup**: the numeric ID next to the admin/test number | `spec.whatsapp.phone_number_id` in `doctor-channel.yaml` |
| `POSTGRES_CONNECTION_URL` (patient) | Supabase session pooler URL for `patient_role` — username form `patient_role.<project-ref>`, host `...pooler.supabase.com:5432` | Stigmer console → the `clinic-patient-db` Environment (see Part 4 — not this repo) |
| `POSTGRES_CONNECTION_URL` (doctor) | Same, for `doctor_role` | Stigmer console → the `clinic-doctor-db` Environment |

> **Passwords with `$`**: paste connection URLs exactly, never through a
> shell that interpolates variables.

## Part 1 — Clinic WhatsApp Business account and the two numbers

The portfolio's business info is complete, so WABA creation sails through
the policy gate that stalled the first dogfood. Create a **separate WABA
for the clinic** rather than adding numbers to the existing "Workshop
Assistant" WABA: webhook subscriptions are per app-and-WABA, so a shared
WABA would deliver clinic messages to the workshop org's app too (and vice
versa).

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

## Part 2 — New Meta app: create, publish, token

The existing "Workshop" app cannot be reused — a Meta app has one webhook
callback, and Workshop's is bound to the workshop org's Channel App. But
with the portfolio, privacy policy, and system user in place, a new app is
minutes, not the ~75 minutes the first one took.

On [developers.facebook.com](https://developers.facebook.com/apps):

1. Create an app; pick the use case that mentions **WhatsApp** ("Connect
   with customers through WhatsApp") and link it to the existing business
   portfolio when prompted. Ignore "Become a Partner" / "Become a Tech
   Provider" — that track drags you into App Review.
2. Under **Use cases → Customize → Integrate with API**, open **Step 2 —
   Production setup** and attach the **clinic WABA** from Part 1 (not the
   test account Meta creates, and not the Workshop Assistant WABA). Skip
   the webhook section for now (the address comes from Stigmer in Part 3)
   and skip the payment method (the assistant only ever replies; service
   replies need no payment method).
3. From **App settings → Basic**, copy the **App ID** and **App secret**.
4. **Publish the app.** In **App settings → Basic**, set the **Privacy
   Policy URL** to the existing `https://stigmer.ai/privacy`, then publish
   from the **Publish** sidebar entry. No App Review is involved for an app
   serving your own WABA.

   > **Trap — invisible failure.** An unpublished app delivers only test
   > webhooks: the webhook verifies, outbound sends work, but real incoming
   > messages are silently dropped. If the assistant stays silent later,
   > check the publish state first.

5. Get a **permanent access token** from the **existing system user** in
   [Business settings](https://business.facebook.com/settings) →
   **Users → System users** (created during the first dogfood — no new
   system user needed):
   - **Add assets** twice: the **new app** (full control) and the **clinic
     WABA** (full control).
   - **Generate new token**: the new app, expiration **Never**, permissions
     at least `whatsapp_business_messaging` and
     `whatsapp_business_management`.
   - Copy it — Meta shows it once.

   > **Trap — the temporary token.** Do not use the token from the app
   > dashboard's setup pages: it expires within a day and WhatsApp gives no
   > revocation signal — the channel looks healthy until a reply fails to
   > send. Only the system-user token is permanent.

## Part 3 — Register the Channel App in Stigmer and wire the webhook

In the Stigmer console — **switched to the clinic org (`rakeshreddi098`)**,
not the workshop org where the first dogfood's Channel App lives — open
**Settings → Channel Apps → Register channel app**:

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

> **Historical note (resolved).** The 2026-07-18 pilot hit a platform bug
> where channels only worked with **public** agents: the runner's blueprint
> reads ran as the org's guest-relation channel account, so org-visible and
> private agents failed every message with
> `[permission_denied] unauthorized to get Agent Instance` (see the
> friction log). Fixed platform-side (T07, 2026-07-19): a serving channel
> now legitimizes the runner's blueprint reads directly, so agents work on
> channels at **any** visibility with no manual FGA tuples. The two viewer
> tuples we wrote as a live workaround were deleted the same day (accepted
> pilot gap until the fix deployed).

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

Then apply (make sure the CLI context points at the clinic org
`rakeshreddi098` — the CLI's default context has been `workshop`, which is
the wrong org for everything in this repo):

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
| Reusing the existing "Workshop" Meta app | Repointing its webhook to the clinic Channel App kills the workshop org's channel | New Meta app for the clinic (Part 2); one app = one webhook |
| Adding clinic numbers to the existing WABA | Both apps receive both orgs' inbound webhooks | Separate clinic WABA (Part 1) |
| App not published | Webhook verifies, sends work, inbound silently dropped | Publish the app (privacy policy URL: `stigmer.ai/privacy` exists) |
| Temporary token used | Channel healthy for a day, then replies fail with no signal | System-user token, expiration Never |
| Environment left private | First tool-using message refused; channel card warns | Set visibility to Organization |
| Deployment predates the T07 channel access fix (historical — resolved 2026-07-19) | Every WhatsApp message to a non-public agent fails: `unauthorized to get Agent Instance` (console tests pass — the owner has access, the org-guest channel account does not) | None needed on current platform: channels serve agents at any visibility. On an old deployment, upgrade stigmer-service |
| Supabase RLS enabled via dashboard nudge | Both agents see zero schedule rows, no error | Re-run `schema/clinic.sql` (disables RLS explicitly) |
| Number already serving an agent via this app | Connect dialog refuses and names the number | One number = one agent per app; use the other number |
| `$` in DB passwords | Auth failures after copy/paste through a shell | Paste URLs exactly, no shell interpolation |
| Token revoked later | Replies stop; no in-product signal | Rotate under Settings → Channel Apps |
