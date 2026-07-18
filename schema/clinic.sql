-- ============================================================================
-- Clinic records schema — the ONLY authored artifact behind the assistant.
--
-- Applied once per clinic to a managed Postgres (Supabase) project via the
-- SQL editor at onboarding. Everything that must hold 100% of the time lives
-- HERE as roles, grants, and constraints — never in agent instructions:
--
--   * channel = role .... each WhatsApp number serves one agent (Stigmer)
--   * credential = capability .. each agent's channel Environment carries a
--                                connection URL for ONE of the two roles below
--   * constraint = invariant ... double booking and out-of-hours bookings are
--                                impossible regardless of what the model writes
--
-- Prompts are left with tone, flow, and UX only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Roles: the deterministic privilege split.
--
-- Replace the passwords at onboarding (Supabase SQL editor), then build each
-- agent's connection URL as:
--   postgresql://<role>:<password>@<project-pooler-host>:5432/postgres
-- and store it in that agent's Stigmer Environment (see channel/ manifests).
-- ----------------------------------------------------------------------------

create role doctor_role login password 'CHANGE_ME_DOCTOR';
create role patient_role login password 'CHANGE_ME_PATIENT';

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Weekly recurring clinic sessions (a day can have several: morning/evening).
create table schedules (
    id            bigint generated always as identity primary key,
    day_of_week   smallint not null check (day_of_week between 0 and 6), -- 0=Sunday
    session_start time not null,
    session_end   time not null,
    constraint schedules_start_before_end check (session_start < session_end),
    -- A day cannot have two sessions starting at the same time.
    constraint schedules_one_session_per_start unique (day_of_week, session_start)
);

-- Date-specific overrides: a day off, a vacation day, or a closed part of day.
create table schedule_exceptions (
    id             bigint generated always as identity primary key,
    exception_date date not null,
    closed_all_day boolean not null default true,
    closed_start   time,
    closed_end     time,
    reason         text,
    -- A partial closure must say when; an all-day closure must not.
    constraint exceptions_window_consistent check (
        (closed_all_day and closed_start is null and closed_end is null)
        or (not closed_all_day and closed_start is not null
            and closed_end is not null and closed_start < closed_end)
    ),
    -- One exception row per date keeps the model of "what changed" simple.
    constraint exceptions_one_per_date unique (exception_date)
);

-- Booked appointments. patient_phone is the channel-verified WhatsApp number
-- the platform surfaces to the agent (attribution, not authorization).
create table bookings (
    id            bigint generated always as identity primary key,
    slot_start    timestamptz not null,
    patient_phone text not null,
    patient_name  text not null,
    status        text not null default 'confirmed'
                  check (status in ('confirmed', 'cancelled')),
    created_at    timestamptz not null default now(),
    -- Slot granularity: appointments start on the half hour.
    constraint bookings_half_hour_grid check (
        extract(minute from slot_start at time zone 'Asia/Kolkata') in (0, 30)
        and extract(second from slot_start) = 0
    )
);

-- ----------------------------------------------------------------------------
-- RLS is intentionally OFF. Access control in this design is role grants
-- (see Grants section below), and the Data API cannot reach these tables
-- anyway: all privileges are revoked from public, and anon/authenticated
-- hold no grants. The Supabase dashboard nudges operators to "Enable RLS" —
-- doing so with no policies silently blocks BOTH agent roles (default deny:
-- reads return zero rows, writes are rejected). These statements make the
-- intent explicit and repair that misclick on re-run.
-- ----------------------------------------------------------------------------

alter table schedules           disable row level security;
alter table schedule_exceptions disable row level security;
alter table bookings            disable row level security;

-- The double-booking invariant: at most one CONFIRMED booking per slot,
-- no matter what the agent writes. A violation surfaces to the agent as an
-- insert error, which it answers by offering other slots.
create unique index bookings_one_confirmed_per_slot
    on bookings (slot_start) where status = 'confirmed';

-- ----------------------------------------------------------------------------
-- Hours-bounds invariant (cross-table, so a constraint trigger).
--
-- Declarative SQL applied with the schema — not a service, not hosted code.
-- A booking must fall inside a scheduled session on that weekday and must not
-- collide with an exception for that date.
-- ----------------------------------------------------------------------------

create function assert_booking_inside_clinic_hours() returns trigger
language plpgsql as $$
declare
    local_ts   timestamp := new.slot_start at time zone 'Asia/Kolkata';
    local_date date       := local_ts::date;
    local_time time       := local_ts::time;
    dow        smallint   := extract(dow from local_date);
begin
    if new.status = 'cancelled' then
        return new;
    end if;

    if not exists (
        select 1 from schedules s
        where s.day_of_week = dow
          and local_time >= s.session_start
          and local_time <  s.session_end
    ) then
        raise exception 'slot % is outside clinic hours', new.slot_start
            using errcode = 'check_violation';
    end if;

    if exists (
        select 1 from schedule_exceptions e
        where e.exception_date = local_date
          and (e.closed_all_day
               or (local_time >= e.closed_start and local_time < e.closed_end))
    ) then
        raise exception 'clinic is closed on % (exception)', local_date
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

create trigger bookings_inside_clinic_hours
    before insert or update on bookings
    for each row execute function assert_booking_inside_clinic_hours();

-- ----------------------------------------------------------------------------
-- Grants: credential = capability.
--
-- patient_role CANNOT touch the schedule tables' contents beyond reading, and
-- cannot update or delete bookings — physically, not by instruction.
-- ----------------------------------------------------------------------------

revoke all on all tables in schema public from public;

grant usage on schema public to doctor_role, patient_role;

-- Patient agent: read the schedule, read bookings (availability answers),
-- create bookings. Nothing else.
grant select on schedules, schedule_exceptions to patient_role;
grant select, insert on bookings to patient_role;

-- Doctor agent: manage the schedule, read the day's bookings, cancel/restore
-- bookings on the patient's behalf ("cancel Mr. Rao's 6pm").
grant select, insert, update, delete on schedules, schedule_exceptions to doctor_role;
grant select, update on bookings to doctor_role;

-- ----------------------------------------------------------------------------
-- Week-1 bootstrap (Option D): a realistic default schedule so the
-- patient-facing flow works end-to-end before doctor-over-WhatsApp management
-- goes live. Mon-Sat 10:00-13:00 and 17:00-20:00, closed Sunday.
-- ----------------------------------------------------------------------------

insert into schedules (day_of_week, session_start, session_end) values
    (1, '10:00', '13:00'), (1, '17:00', '20:00'),
    (2, '10:00', '13:00'), (2, '17:00', '20:00'),
    (3, '10:00', '13:00'), (3, '17:00', '20:00'),
    (4, '10:00', '13:00'), (4, '17:00', '20:00'),
    (5, '10:00', '13:00'), (5, '17:00', '20:00'),
    (6, '10:00', '13:00'), (6, '17:00', '20:00');
