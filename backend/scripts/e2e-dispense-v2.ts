/**
 * End-to-end verification of the dispensing stabilization pass (audit P1 fixes):
 *
 *   H3  Prescription validity — 30-day window enforced in plan + dispense
 *   C3  Controlled drugs — 7-day window, quantified-line requirement,
 *       plan `controlled` flag, controlled drug register endpoint
 *   C4  Required quantities — POST /prescriptions rejects unquantified lines;
 *       legacy unquantified lines flagged in the plan (noQuantityWarning)
 *   C2  Allergy visibility — plan returns patient + prescription-history allergies
 *   H1  GET /dispensing filters — patientId (cuid + human ID), prescriptionId, from/to
 *   OCR parser — department / symptoms / allergies / follow-up extraction
 *
 * Run: npx tsx scripts/e2e-dispense-v2.ts
 */
import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";
import { parsePrescriptionText } from "../src/utils/ocrPrescriptionParser";

const SUFFIX = `DV2${Date.now().toString().slice(-7)}`;
let server: http.Server;
let baseUrl = "";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ FAIL: ${label}`); }
}

type Resp = { status: number; body: any };
async function req(method: string, path: string, token: string, body?: any): Promise<Resp> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed: any = null;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
const futureDate = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };

const ids = {
  facility: "", catNormal: "", catControlled: "", medNormal: "", medControlled: "",
  user: "", patientA: "", patientB: "", batchNormal: "", batchControlled: "",
};

async function setup() {
  const fac = await prisma.facility.create({ data: { name: `${SUFFIX} Clinic`, code: `${SUFFIX}-A` } });
  ids.facility = fac.id;
  const catN = await prisma.medicineCategory.create({ data: { name: `${SUFFIX} Normal` } });
  const catC = await prisma.medicineCategory.create({
    data: { name: `${SUFFIX} Controlled`, controlledDrug: true, requiresPrescription: true },
  });
  ids.catNormal = catN.id; ids.catControlled = catC.id;

  const medN = await prisma.medicine.create({ data: { medicineName: `${SUFFIX} Plainamol 500mg`, categoryId: catN.id } });
  const medC = await prisma.medicine.create({ data: { medicineName: `${SUFFIX} Morphintest 10mg`, categoryId: catC.id } });
  ids.medNormal = medN.id; ids.medControlled = medC.id;

  const bN = await prisma.stockBatch.create({
    data: { medicineId: medN.id, facilityId: fac.id, batchNumber: `${SUFFIX}-N1`, expiryDate: futureDate(365), quantity: 100 },
  });
  const bC = await prisma.stockBatch.create({
    data: { medicineId: medC.id, facilityId: fac.id, batchNumber: `${SUFFIX}-C1`, expiryDate: futureDate(365), quantity: 100 },
  });
  ids.batchNormal = bN.id; ids.batchControlled = bC.id;

  const user = await prisma.user.create({
    data: {
      email: `${SUFFIX.toLowerCase()}@test.local`, passwordHash: "x",
      firstName: "DispV2", lastName: "Tester", role: "SUPER_ADMIN", facilityId: fac.id,
    },
  });
  ids.user = user.id;

  const pA = await prisma.patient.create({
    data: { patientId: `${SUFFIX}-PA`, firstName: "Alice", lastName: "Aondo", gender: "Female", age: 34, facilityId: fac.id, allergies: "Penicillin" },
  });
  const pB = await prisma.patient.create({
    data: { patientId: `${SUFFIX}-PB`, firstName: "Bob", lastName: "Banda", gender: "Male", age: 41, facilityId: fac.id },
  });
  ids.patientA = pA.id; ids.patientB = pB.id;

  return jwt.sign({ userId: user.id, email: user.email, role: "SUPER_ADMIN", facilityId: fac.id }, config.jwtSecret);
}

async function newRx(opts: {
  patientId: string;
  daysOld?: number;
  lines: { medicineId: string; quantity: number | null }[];
  allergies?: string;
}): Promise<string> {
  const rx = await prisma.prescription.create({
    data: {
      prescriptionId: `${SUFFIX}-RX${Math.random().toString(36).slice(2, 8)}`,
      patientId: opts.patientId, facilityId: ids.facility, status: "ACTIVE",
      prescriptionDate: daysAgo(opts.daysOld ?? 0),
      allergies: opts.allergies,
      medicines: { create: opts.lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity })) },
    },
  });
  return rx.id;
}

async function run() {
  const token = await setup();
  const dispense = (rxId: string, patientId: string, medicineId: string, batchId: string, qty: number) =>
    req("POST", "/api/dispensing", token, { patientId, prescriptionId: rxId, medicineId, batchId, quantity: qty });
  const batchDispense = (rxId: string, patientId: string, lines: { medicineId: string; batchId: string; quantity: number }[]) =>
    req("POST", "/api/dispensing/batch", token, { patientId, prescriptionId: rxId, lines });

  console.log("\n── H3. Prescription validity window (30 days) ──");
  const oldRx = await newRx({ patientId: ids.patientA, daysOld: 31, lines: [{ medicineId: ids.medNormal, quantity: 10 }] });
  let r = await req("GET", `/api/dispensing/prescription/${oldRx}/plan`, token);
  ok(r.status === 400 && /expired/i.test(r.body?.error ?? ""), `plan for 31-day-old Rx rejected (${r.status}: ${r.body?.error})`);
  r = await dispense(oldRx, ids.patientA, ids.medNormal, ids.batchNormal, 1);
  ok(r.status === 400 && /expired/i.test(r.body?.error ?? ""), `single dispense on expired Rx rejected (${r.status})`);
  r = await batchDispense(oldRx, ids.patientA, [{ medicineId: ids.medNormal, batchId: ids.batchNormal, quantity: 1 }]);
  ok(r.status === 400 && /expired/i.test(r.body?.error ?? ""), `batch dispense on expired Rx rejected (${r.status})`);

  const freshishRx = await newRx({ patientId: ids.patientA, daysOld: 29, lines: [{ medicineId: ids.medNormal, quantity: 10 }] });
  r = await req("GET", `/api/dispensing/prescription/${freshishRx}/plan`, token);
  ok(r.status === 200, `plan for 29-day-old Rx still allowed (${r.status})`);
  ok(!!r.body?.prescription?.expiresAt, "plan exposes expiresAt");

  console.log("\n── C3. Controlled: 7-day window ──");
  const ctrlOldRx = await newRx({
    patientId: ids.patientA, daysOld: 8,
    lines: [{ medicineId: ids.medControlled, quantity: 10 }, { medicineId: ids.medNormal, quantity: 10 }],
  });
  r = await dispense(ctrlOldRx, ids.patientA, ids.medControlled, ids.batchControlled, 1);
  ok(r.status === 400 && /controlled/i.test(r.body?.error ?? ""), `controlled med blocked on 8-day-old Rx (${r.status}: ${r.body?.error})`);
  r = await dispense(ctrlOldRx, ids.patientA, ids.medNormal, ids.batchNormal, 2);
  ok(r.status === 201, `non-controlled med on same 8-day-old Rx still dispensable (${r.status})`);

  console.log("\n── C3/C4. Controlled: unquantified line blocked ──");
  const ctrlOpenRx = await newRx({ patientId: ids.patientA, lines: [{ medicineId: ids.medControlled, quantity: null }] });
  r = await dispense(ctrlOpenRx, ids.patientA, ids.medControlled, ids.batchControlled, 1);
  ok(r.status === 400 && /prescribed quantity/i.test(r.body?.error ?? ""), `single: controlled w/o qty rejected (${r.status}: ${r.body?.error})`);
  r = await batchDispense(ctrlOpenRx, ids.patientA, [{ medicineId: ids.medControlled, batchId: ids.batchControlled, quantity: 1 }]);
  ok(r.status === 400 && /prescribed quantity/i.test(r.body?.error ?? ""), `batch: controlled w/o qty rejected (${r.status})`);

  console.log("\n── C3. Plan flags + controlled dispense ──");
  const ctrlRx = await newRx({
    patientId: ids.patientA, daysOld: 2, allergies: "Sulfa drugs",
    lines: [{ medicineId: ids.medControlled, quantity: 5 }, { medicineId: ids.medNormal, quantity: null }],
  });
  r = await req("GET", `/api/dispensing/prescription/${ctrlRx}/plan`, token);
  const ctrlLine = r.body?.lines?.find((l: any) => l.medicineId === ids.medControlled);
  const openLine = r.body?.lines?.find((l: any) => l.medicineId === ids.medNormal);
  ok(ctrlLine?.controlled === true, "plan marks controlled line");
  ok(openLine?.noQuantityWarning === true, "plan warns on legacy unquantified line");

  console.log("\n── C2. Allergy visibility in plan ──");
  ok(r.body?.allergies?.patient === "Penicillin", `plan returns patient allergies (got "${r.body?.allergies?.patient}")`);
  ok(
    Array.isArray(r.body?.allergies?.fromPrescriptions) && r.body.allergies.fromPrescriptions.includes("Sulfa drugs"),
    `plan returns prescription-history allergies (got ${JSON.stringify(r.body?.allergies?.fromPrescriptions)})`
  );

  // Controlled dispense within window, quantified — must succeed and hit the register.
  r = await batchDispense(ctrlRx, ids.patientA, [{ medicineId: ids.medControlled, batchId: ids.batchControlled, quantity: 5 }]);
  ok(r.status === 201, `controlled dispense (valid window, quantified) succeeds (${r.status})`);

  console.log("\n── C4. POST /prescriptions requires quantities ──");
  r = await req("POST", "/api/prescriptions", token, {
    patientId: ids.patientA,
    medicines: JSON.stringify([{ medicineId: ids.medNormal }]),
  });
  ok(r.status === 400, `Rx line without quantity rejected (${r.status})`);
  r = await req("POST", "/api/prescriptions", token, {
    patientId: ids.patientA,
    medicines: JSON.stringify([{ medicineId: ids.medNormal, quantity: 5 }]),
  });
  ok(r.status === 201, `Rx line with quantity accepted (${r.status})`);

  console.log("\n── H1. GET /dispensing filters ──");
  // Dispense to patient B so both patients have records.
  const rxB = await newRx({ patientId: ids.patientB, lines: [{ medicineId: ids.medNormal, quantity: 3 }] });
  r = await batchDispense(rxB, ids.patientB, [{ medicineId: ids.medNormal, batchId: ids.batchNormal, quantity: 3 }]);
  ok(r.status === 201, `dispense to patient B succeeds (${r.status})`);

  r = await req("GET", `/api/dispensing?patientId=${ids.patientA}`, token);
  ok(
    Array.isArray(r.body) && r.body.length > 0 && r.body.every((rec: any) => rec.patientId === ids.patientA),
    `patientId (cuid) filter returns only patient A records (${Array.isArray(r.body) ? r.body.length : "?"} records)`
  );
  r = await req("GET", `/api/dispensing?patientId=${SUFFIX}-PB`, token);
  ok(
    Array.isArray(r.body) && r.body.length > 0 && r.body.every((rec: any) => rec.patientId === ids.patientB),
    `patientId (human ID) filter returns only patient B records (${Array.isArray(r.body) ? r.body.length : "?"} records)`
  );
  r = await req("GET", `/api/dispensing?prescriptionId=${rxB}`, token);
  ok(
    Array.isArray(r.body) && r.body.length === 1 && r.body[0].prescriptionId === rxB,
    `prescriptionId filter returns exactly that Rx's record`
  );
  const tomorrow = futureDate(1).toISOString().slice(0, 10);
  r = await req("GET", `/api/dispensing?from=${tomorrow}`, token);
  ok(Array.isArray(r.body) && r.body.length === 0, "from=tomorrow returns no records");
  r = await req("GET", `/api/dispensing?today=true&take=200`, token);
  ok(Array.isArray(r.body) && r.body.some((rec: any) => rec.facilityId === ids.facility), "today filter includes today's records");

  console.log("\n── C3. Controlled drug register ──");
  r = await req("GET", `/api/dispensing/controlled-register`, token);
  const regRecords = r.body?.records ?? [];
  const ours = regRecords.filter((rec: any) => rec.medicineId === ids.medControlled);
  ok(r.status === 200, `register endpoint responds (${r.status})`);
  ok(ours.length === 1 && ours[0].quantity === 5, `register lists the controlled dispense (got ${ours.length})`);
  ok(ours[0]?.patient?.patientId === `${SUFFIX}-PA`, "register record carries patient identity");
  ok(!!ours[0]?.dispensedBy?.firstName, "register record carries dispenser identity");
  const sum = (r.body?.summary ?? []).find((s: any) => s.medicineId === ids.medControlled);
  ok(sum?.dispensedTotal === 5 && sum?.onHand === 95, `register summary totals correct (dispensed ${sum?.dispensedTotal}, onHand ${sum?.onHand})`);
  ok(regRecords.every((rec: any) => rec.medicineId !== ids.medNormal), "register excludes non-controlled medicines");

  console.log("\n── OCR parser: new clinical fields ──");
  const parsed = parsePrescriptionText([
    "Dr. Mensah",
    "Department: Paediatrics",
    "Symptoms: cough and mild fever",
    "Diagnosis: URTI",
    "Allergies: Penicillin",
    "Follow-up: 15/07/2026",
    "Paracetamol 500mg Qty 5",
  ].join("\n"));
  ok(parsed.doctorName === "Mensah", `doctor extracted (got "${parsed.doctorName}")`);
  ok(parsed.department === "Paediatrics", `department extracted (got "${parsed.department}")`);
  ok(parsed.symptoms === "cough and mild fever", `symptoms extracted (got "${parsed.symptoms}")`);
  ok(parsed.allergies === "Penicillin", `allergies extracted (got "${parsed.allergies}")`);
  ok(parsed.followUpDate === "2026-07-15", `follow-up date parsed (got "${parsed.followUpDate}")`);
  ok(parsed.medicines.length === 1 && parsed.medicines[0].quantity === 5, "medicine line still parsed alongside new fields");
  const nkda = parsePrescriptionText("Dr. Smith\nNo known drug allergies\nParacetamol 500mg Qty 2");
  ok(nkda.allergies === "NKDA", `NKDA detected (got "${nkda.allergies}")`);
  ok(nkda.medicines.length === 1, "NKDA line not mistaken for a medicine");
}

async function cleanup() {
  await prisma.dispensingRecord.deleteMany({ where: { facilityId: ids.facility } });
  await prisma.stockTransaction.deleteMany({ where: { facilityId: ids.facility } });
  await prisma.alert.deleteMany({ where: { facilityId: ids.facility } });
  await prisma.auditLog.deleteMany({ where: { facilityId: ids.facility } });
  if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
  await prisma.stockBatch.deleteMany({ where: { facilityId: ids.facility } });
  await prisma.prescriptionMedicine.deleteMany({ where: { prescription: { facilityId: ids.facility } } });
  await prisma.prescription.deleteMany({ where: { facilityId: ids.facility } });
  await prisma.patient.deleteMany({ where: { facilityId: ids.facility } });
  await prisma.medicine.deleteMany({ where: { id: { in: [ids.medNormal, ids.medControlled].filter(Boolean) } } });
  await prisma.medicineCategory.deleteMany({ where: { id: { in: [ids.catNormal, ids.catControlled].filter(Boolean) } } });
  if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  if (ids.facility) await prisma.facility.deleteMany({ where: { id: ids.facility } });
}

(async () => {
  server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    await run();
  } catch (e) {
    fail++; failures.push(`UNCAUGHT: ${e instanceof Error ? e.message : String(e)}`);
    console.error(e);
  } finally {
    try { await cleanup(); } catch (e) { console.error("cleanup error", e); }
    server.close();
    await prisma.$disconnect();
  }
  console.log(`\n══════════════════════════════════════`);
  console.log(`DISPENSE V2 RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(fail ? 1 : 0);
})();
