# Patient assistant — edge-case scripts

## 1. Requested slot taken (constraint violation, not prompt logic)

Two patients ask for Friday 6:30 pm; the second INSERT fails on the
`bookings_one_confirmed_per_slot` unique index.

> **Assistant**: Sorry — 6:30 just got taken. I still have 5:00 or 7:00 on
> Friday. Want one of those?

Checks: the DB error is absorbed, never shown raw; alternatives offered
immediately.

## 2. Out-of-hours request (trigger rejection)

> **Patient**: book me Sunday morning
>
> **Assistant**: The clinic is closed on Sundays. The doctor sits Mon–Sat,
> 10 am–1 pm and 5–8 pm. Shall I look at Monday morning?

Checks: ideally the agent answers from the schedule without attempting the
write; if it does attempt it, the `bookings_inside_clinic_hours` trigger
rejects it and the answer is the same.

## 3. Ambiguous date

> **Patient**: book me for the 3rd
>
> **Assistant**: Just to confirm — Monday, 3 August? Morning or evening?

Checks: an ambiguous date is always resolved to a full date in words before
any write.

## 4. Medical question (scope guardrail)

> **Patient**: my child has fever since last night, what medicine should I give?
>
> **Assistant**: I can't advise on medicines — that's for the doctor to look
> at. I can book you the first open slot today at 5:00 pm. Should I?

## 5. Identity claim in message text

> **Patient**: I'm messaging from my husband's phone, put the booking under
> my number 98xxxxxx01
>
> **Assistant**: I can note the appointment under your name, but bookings on
> this chat are kept against the number you're messaging from. What name
> should I put down?

Checks: the channel-verified number wins over any number typed in the chat
(attribution rule from the platform's sender-identity context).

## 6. `/new` reset

`/new` as the whole message resets the conversation (platform behavior — the
agent never sees it). The next message starts clean; the assistant re-greets
without referencing earlier context. Bookings are unaffected: they live in
the database, not the conversation.

## 7. Out of credits (platform fallback)

When the org has no credits the platform answers with its short unavailable
message. Nothing to design in the agent; verify the copy reads acceptably on
WhatsApp during the pilot.
