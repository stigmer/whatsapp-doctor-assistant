/**
 * Seed and verify the clinic's weekly schedule in the clinic-records
 * datastore — the DD-009 migration-script prototype.
 *
 * Every row enters through the same insertRecord RPC every other caller
 * uses: grant-checked, constraint-checked, and attributed to the
 * operator running this script (honest imports — `created_by` is the
 * truth of the insertion, never a claimed historical value).
 *
 * Discipline (DD-009): validate-first, all-or-nothing per collection.
 *   1. All rows are validated locally before anything is sent.
 *   2. A non-empty schedules collection aborts the seed — re-runs are
 *      by RESET (delete the unreferenced datastore, re-apply, re-seed),
 *      never by tracking or merging.
 *   3. Any server-side rejection aborts with the violating row and the
 *      constraint message; the report tells you the exact state.
 *
 * Usage:
 *   npm run seed     — seed the 12-row weekly schedule, then verify
 *   npm run verify   — verification pass only (counts + read-back)
 *
 * Environment:
 *   STIGMER_BASE_URL   Stigmer API endpoint (default http://localhost:7234)
 *   STIGMER_API_KEY    API key (omit against an unauthenticated local server)
 *   CLINIC_ORG         Org slug owning the datastore (omit locally: the
 *                      local server resolves the caller's own context)
 *   CLINIC_DATASTORE   Datastore slug (default clinic-records)
 */
import { create, type JsonObject } from "@bufbuild/protobuf";
import { Stigmer, StigmerError } from "@stigmer/sdk";
import {
  DescribeDatastoreRequestSchema,
  FindRecordsRequestSchema,
  InsertRecordRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";

interface ScheduleRow {
  day_of_week: number;
  session_start: string;
  session_end: string;
}

/**
 * The clinic's standing weekly schedule (the 12 bootstrap rows from the
 * retired schema/clinic.sql): Mon-Sat, a morning and an evening session;
 * closed Sunday. day_of_week: 0=Sunday .. 6=Saturday.
 */
const WEEKLY_SCHEDULE: ScheduleRow[] = [1, 2, 3, 4, 5, 6].flatMap((day) => [
  { day_of_week: day, session_start: "10:00", session_end: "13:00" },
  { day_of_week: day, session_start: "17:00", session_end: "20:00" },
]);

const COLLECTION = "schedules";

interface Config {
  baseUrl: string;
  apiKey: string | undefined;
  org: string;
  datastore: string;
}

function loadConfig(): Config {
  return {
    baseUrl: process.env.STIGMER_BASE_URL ?? "http://localhost:7234",
    apiKey: process.env.STIGMER_API_KEY || undefined,
    org: process.env.CLINIC_ORG ?? "",
    datastore: process.env.CLINIC_DATASTORE ?? "clinic-records",
  };
}

/**
 * Local validation of every row before anything is sent — the
 * validate-first half of the DD-009 posture. The server re-validates
 * authoritatively; this pass exists so a typo aborts before row 1, not
 * at row 7.
 */
function validateRows(rows: ScheduleRow[]): string[] {
  const problems: string[] = [];
  const starts = new Set<string>();
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  rows.forEach((row, i) => {
    const at = `row ${i + 1} (${JSON.stringify(row)})`;
    if (!Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6) {
      problems.push(`${at}: day_of_week must be 0..6`);
    }
    if (!timeRe.test(row.session_start) || !timeRe.test(row.session_end)) {
      problems.push(`${at}: times must be zero-padded HH:MM`);
    }
    if (row.session_start >= row.session_end) {
      problems.push(`${at}: session_start must be before session_end`);
    }
    const key = `${row.day_of_week}@${row.session_start}`;
    if (starts.has(key)) {
      problems.push(`${at}: duplicate (day_of_week, session_start)`);
    }
    starts.add(key);
  });
  return problems;
}

function formatError(e: unknown): string {
  if (e instanceof StigmerError) {
    return `[${e.code}] ${e.message}`;
  }
  return String(e);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function countRows(stigmer: Stigmer, cfg: Config): Promise<number> {
  const list = await stigmer.datastore.findRecords(
    create(FindRecordsRequestSchema, {
      datastore: cfg.datastore,
      collection: COLLECTION,
      org: cfg.org,
      limit: 1,
    }),
  );
  return list.total;
}

/** The read-back half of the verification: print what patients will be told. */
async function verify(stigmer: Stigmer, cfg: Config): Promise<boolean> {
  const list = await stigmer.datastore.findRecords(
    create(FindRecordsRequestSchema, {
      datastore: cfg.datastore,
      collection: COLLECTION,
      org: cfg.org,
      limit: 100,
    }),
  );

  console.log(`\nVerification — ${cfg.datastore}/${COLLECTION}`);
  console.log(`  rows: ${list.total} (expected ${WEEKLY_SCHEDULE.length})`);

  const sessions = list.records
    .map((rec) => {
      // Struct fields surface as plain JSON objects in protobuf-es v2.
      const f = (rec.fields ?? {}) as Record<string, unknown>;
      return {
        day: Number(f.day_of_week),
        start: String(f.session_start),
        end: String(f.session_end),
      };
    })
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));

  for (const s of sessions) {
    console.log(`  ${DAY_NAMES[s.day] ?? `day ${s.day}`}  ${s.start} - ${s.end}`);
  }

  const ok = list.total === WEEKLY_SCHEDULE.length;
  console.log(ok ? "\nVerification PASSED" : "\nVerification FAILED: row count mismatch");
  return ok;
}

async function seed(stigmer: Stigmer, cfg: Config): Promise<void> {
  // Reachability + access preflight: describe returns the collections
  // and this caller's effective verbs; a missing insert grant should
  // abort here, not at row 1.
  const description = await stigmer.datastore.describeDatastore(
    create(DescribeDatastoreRequestSchema, { datastore: cfg.datastore, org: cfg.org }),
  );
  const coll = description.collections.find((c) => c.name === COLLECTION);
  if (!coll) {
    throw new Error(`datastore "${cfg.datastore}" declares no "${COLLECTION}" collection`);
  }
  const canInsert = coll.access.some((a) => String(a.verb) === "insert" || a.verb === 2);
  if (!canInsert) {
    throw new Error(
      `this caller has no insert grant on "${COLLECTION}" — ` +
        `bind your principal to a role that can insert (see the datastore's authorization block)`,
    );
  }

  const problems = validateRows(WEEKLY_SCHEDULE);
  if (problems.length > 0) {
    console.error("Local validation failed — nothing was sent:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const existing = await countRows(stigmer, cfg);
  if (existing > 0) {
    console.error(
      `"${COLLECTION}" already holds ${existing} row(s) — seeding is all-or-nothing.\n` +
        `Re-runs are by reset: delete the (unreferenced) datastore, re-apply the ` +
        `manifest, and seed again.`,
    );
    process.exit(1);
  }

  console.log(`Seeding ${WEEKLY_SCHEDULE.length} schedule rows into ${cfg.datastore}/${COLLECTION}...`);
  for (const [i, row] of WEEKLY_SCHEDULE.entries()) {
    try {
      await stigmer.datastore.insertRecord(
        create(InsertRecordRequestSchema, {
          datastore: cfg.datastore,
          collection: COLLECTION,
          org: cfg.org,
          // google.protobuf.Struct fields take plain JSON objects in
          // protobuf-es v2 — no Struct message construction.
          record: { ...row } as JsonObject,
        }),
      );
    } catch (e) {
      console.error(
        `\nSeed ABORTED at row ${i + 1}/${WEEKLY_SCHEDULE.length} ` +
          `(${JSON.stringify(row)}): ${formatError(e)}\n` +
          `${i} row(s) were inserted before the failure. Restore all-or-nothing by ` +
          `reset: delete the datastore, re-apply the manifest, fix the cause, re-seed.`,
      );
      process.exit(1);
    }
  }
  console.log("All rows inserted.");
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "seed" && mode !== "verify") {
    console.error("usage: seed-schedule.ts <seed|verify>");
    process.exit(2);
  }

  const cfg = loadConfig();
  console.log(`Target: ${cfg.baseUrl} org=${cfg.org || "(caller context)"} datastore=${cfg.datastore}`);

  // The default grpc-web transport: the stigmer server (local and cloud)
  // serves gRPC + gRPC-Web; the Connect-JSON protocol is not enabled.
  const stigmer = new Stigmer({
    baseUrl: cfg.baseUrl,
    // A null token provider skips auth per-request — the documented shape
    // for an unauthenticated local server (apiKey and getAccessToken are
    // mutually exclusive, so exactly one is passed).
    ...(cfg.apiKey !== undefined ? { apiKey: cfg.apiKey } : { getAccessToken: () => null }),
  });

  if (mode === "seed") {
    await seed(stigmer, cfg);
  }
  const ok = await verify(stigmer, cfg);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(formatError(e));
  process.exit(1);
});
