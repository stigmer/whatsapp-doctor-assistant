# Patient assistant — happy-path scripts

Target scripts for bench-testing the patient agent (console first, then the
public WhatsApp number). The agent knows the patient's channel-verified phone
number; it never asks for it.

## 1. Availability question

> **Patient**: when is the doctor available tomorrow?
>
> **Assistant**: Tomorrow (Friday, 24 July) the doctor sits 10 am–1 pm and
> 5–8 pm. Open slots in the morning: 10:00, 10:30, 11:30. Evening: 5:00,
> 6:30, 7:00. Want me to book one?

Checks: reads `schedules` for the weekday, subtracts `schedule_exceptions`
for the date and confirmed `bookings`; resolves "tomorrow" to an explicit
date in words.

## 2. Booking

> **Patient**: book me Friday evening
>
> **Assistant**: Friday, 24 July evening — I have 5:00, 6:30, or 7:00. Which
> works?
>
> **Patient**: 6:30
>
> **Assistant**: 6:30 pm it is. What name should I put down?
>
> **Patient**: Anita Rao
>
> **Assistant**: Done — Anita Rao, Friday 24 July, 6:30 pm. See you then!

Checks: one question per message; INSERT into `bookings` carries the
channel-verified phone number; confirmation restates date and time in full.

## 3. My bookings

> **Patient**: do I have anything booked?
>
> **Assistant**: Yes — Friday, 24 July at 6:30 pm under Anita Rao. Anything
> else?

Checks: SELECT filtered by the verified phone number, never by a number the
patient types.

## 4. Doctor's-side change visible to patients

(After the doctor closes Thursday on the admin line.)

> **Patient**: can I come Thursday at 11?
>
> **Assistant**: The clinic is closed this Thursday (24 July). The nearest
> open slots are Wednesday 11:00 or Friday 10:00 — shall I book one?
