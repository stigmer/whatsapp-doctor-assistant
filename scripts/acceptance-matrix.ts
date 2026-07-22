/**
 * Acceptance matrix for the clinic-records datastore: exercises every
 * clinic invariant against a live store through the same record RPCs
 * the assistant's tools use, asserting the exact relayable message of
 * each rejection (cross-edition contract bytes).
 *
 * Runs against a local server (apply scripts/clinic-records.local.yaml
 * first) and, at cutover, against the dark production datastore as the
 * dry-run verification step. Cleans bookings/exceptions before and
 * after itself; never touches the seeded schedule.
 *
 * Usage: npm run acceptance   (env: STIGMER_BASE_URL, STIGMER_API_KEY,
 * CLINIC_ORG — same knobs as seed-schedule.ts)
 */
import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Stigmer, StigmerError } from "@stigmer/sdk";
import {
  DeleteRecordRequestSchema,
  DescribeDatastoreRequestSchema,
  FindRecordsRequestSchema,
  InsertRecordRequestSchema,
  UpdateRecordRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";

const apiKey = process.env.STIGMER_API_KEY || undefined;
const stigmer = new Stigmer({
  baseUrl: process.env.STIGMER_BASE_URL ?? "http://localhost:17234",
  ...(apiKey !== undefined ? { apiKey } : { getAccessToken: () => null }),
});

const DS = process.env.CLINIC_DATASTORE ?? "clinic-records";
const ORG = process.env.CLINIC_ORG ?? "";
let pass = 0;
let fail = 0;

function ok(name: string): void {
  pass += 1;
  console.log(`  PASS  ${name}`);
}
function bad(name: string, detail: string): void {
  fail += 1;
  console.log(`  FAIL  ${name}: ${detail}`);
}

async function insert(collection: string, record: JsonObject) {
  return stigmer.datastore.insertRecord(
    create(InsertRecordRequestSchema, { datastore: DS, org: ORG, collection, record }),
  );
}

async function expectError(
  name: string,
  action: () => Promise<unknown>,
  wantCode: string,
  wantMessage: string,
): Promise<void> {
  try {
    await action();
    bad(name, "expected rejection, but the write committed");
  } catch (e) {
    if (!(e instanceof StigmerError)) {
      bad(name, `non-Stigmer error: ${String(e)}`);
      return;
    }
    if (e.code !== wantCode) {
      bad(name, `code ${e.code} (want ${wantCode}): ${e.message}`);
      return;
    }
    if (!e.message.includes(wantMessage)) {
      bad(name, `message ${JSON.stringify(e.message)} lacks ${JSON.stringify(wantMessage)}`);
      return;
    }
    ok(name);
  }
}

/** Idempotency: clear bookings and exceptions left by a prior run. */
async function cleanCollections(): Promise<void> {
  for (const collection of ["bookings", "schedule_exceptions"]) {
    const list = await stigmer.datastore.findRecords(
      create(FindRecordsRequestSchema, { datastore: DS, org: ORG, collection, limit: 100 }),
    );
    for (const rec of list.records) {
      await stigmer.datastore.deleteRecord(
        create(DeleteRecordRequestSchema, { datastore: DS, org: ORG, collection, id: rec.id }),
      );
    }
  }
}

async function main(): Promise<void> {
  console.log("clinic-records acceptance matrix\n");
  await cleanCollections();

  // Tuesday 2026-07-28 10:30 IST == 05:00 UTC — inside the Tue morning session.
  const inHours = "2026-07-28T05:00:00Z";

  // 1. Valid booking commits, with server-stamped attribution.
  const booked = await insert("bookings", {
    slot_start: inHours, patient_name: "Asha", patient_phone: "919000000001",
  });
  if (booked.createdBy !== undefined && booked.id.startsWith("dsr_")) {
    ok("valid booking commits; created_by stamped; dsr_ id");
  } else {
    bad("valid booking commits", `id=${booked.id} createdBy=${JSON.stringify(booked.createdBy)}`);
  }

  // 2. Double-booking the same slot → declared unique message.
  await expectError(
    "double-booking rejected (one_confirmed_per_slot)",
    () => insert("bookings", { slot_start: inHours, patient_name: "Ravi" }),
    "already-exists",
    "that slot is already booked",
  );

  // 3. Cancelling frees the slot: cancel then rebook.
  await stigmer.datastore.updateRecord(create(UpdateRecordRequestSchema, {
    datastore: DS, org: ORG, collection: "bookings", id: booked.id,
    fields: { status: "cancelled" } as JsonObject,
  }));
  const rebooked = await insert("bookings", { slot_start: inHours, patient_name: "Ravi" });
  ok("cancelled booking frees the slot (conditional unique)");

  // 4. Off-grid time → half_hour_grid check.
  await expectError(
    "off-grid slot rejected (half_hour_grid)",
    () => insert("bookings", { slot_start: "2026-07-28T05:15:00Z", patient_name: "Meena" }),
    "failed-precondition",
    "appointments start on the hour or half hour",
  );

  // 5. Outside clinic hours (Tue 15:00 IST == 09:30 UTC) → exists check.
  await expectError(
    "outside clinic hours rejected (inside_clinic_hours)",
    () => insert("bookings", { slot_start: "2026-07-28T09:30:00Z", patient_name: "Meena" }),
    "failed-precondition",
    "that time is outside clinic hours",
  );

  // 6. Sunday (no session declared) → same exists check, weekday path.
  await expectError(
    "Sunday booking rejected (no session that weekday)",
    () => insert("bookings", { slot_start: "2026-07-26T05:00:00Z", patient_name: "Meena" }),
    "failed-precondition",
    "that time is outside clinic hours",
  );

  // 7. Exception day: close 2026-07-29 all day, then booking dies on not_exists.
  const exception = await insert("schedule_exceptions", {
    exception_date: "2026-07-29", closed_all_day: true, reason: "conference",
  });
  await expectError(
    "booking on a closed date rejected (not_on_closed_date)",
    () => insert("bookings", { slot_start: "2026-07-29T05:00:00Z", patient_name: "Meena" }),
    "failed-precondition",
    "the clinic is closed at that time",
  );

  // 8. Partial-closure window consistency check on the exception itself.
  await expectError(
    "inconsistent exception rejected (window_consistent)",
    () => insert("schedule_exceptions", {
      exception_date: "2026-07-30", closed_all_day: false,
    }),
    "failed-precondition",
    "a partial closure needs a start and end time",
  );

  // 9. One exception per date.
  await expectError(
    "duplicate exception date rejected (one_exception_per_date)",
    () => insert("schedule_exceptions", { exception_date: "2026-07-29", closed_all_day: true }),
    "already-exists",
    "that date already has an exception",
  );

  // 10. Duplicate weekly session → schedules unique.
  await expectError(
    "duplicate session rejected (one_session_per_start)",
    () => insert("schedules", { day_of_week: 2, session_start: "10:00", session_end: "12:00" }),
    "already-exists",
    "that day already has a session starting at that time",
  );

  // 11. Invalid weekday → schedules check.
  await expectError(
    "invalid weekday rejected (valid_weekday)",
    () => insert("schedules", { day_of_week: 7, session_start: "10:00", session_end: "12:00" }),
    "failed-precondition",
    "day_of_week must be 0 (Sunday) through 6 (Saturday)",
  );

  // 12. describe: local principal (admin binding) sees all four verbs on schedules.
  const description = await stigmer.datastore.describeDatastore(
    create(DescribeDatastoreRequestSchema, { datastore: DS, org: ORG }),
  );
  const schedules = description.collections.find((c) => c.name === "schedules");
  const verbs = (schedules?.access ?? []).length;
  if (verbs === 4) {
    ok("describe returns caller-effective verbs (admin: 4 on schedules)");
  } else {
    bad("describe caller-effective verbs", `got ${verbs} verbs on schedules`);
  }

  // 13. Filtered find: confirmed bookings for the slot.
  const found = await stigmer.datastore.findRecords(create(FindRecordsRequestSchema, {
    datastore: DS, org: ORG, collection: "bookings",
    filter: { conditions: [{ field: "status", op: 1 /* eq */, value: fromJson(ValueSchema, "confirmed") }] },
  }));
  if (found.records.length === 1 && found.records[0].id === rebooked.id) {
    ok("typed filter finds exactly the confirmed booking");
  } else {
    bad("typed filter", `got ${found.records.length} records`);
  }

  // Cleanup the exception so re-runs of this driver start clean-ish.
  await stigmer.datastore.deleteRecord(create(DeleteRecordRequestSchema, {
    datastore: DS, org: ORG, collection: "schedule_exceptions", id: exception.id,
  }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof StigmerError ? `[${e.code}] ${e.message}` : e);
  process.exit(1);
});
