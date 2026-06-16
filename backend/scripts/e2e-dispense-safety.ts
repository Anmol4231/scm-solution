/**
 * End-to-end dispensing-safety verification (Phase 5 of the dispensing audit).
 *
 * Boots the real Express app in-process against the live dev database and
 * verifies every patient-safety invariant of the dispensing workflow:
 *
 *   1.  Cannot dispense more than prescribed (single + batch endpoints)
 *   2.  Cannot dispense more than available stock
 *   3.  Cannot dispense expired stock
 *   4.  Cannot dispense quarantined stock
 *   5.  Cannot create negative stock
 *   6.  FEFO batch recommendation (plan picks soonest expiry)
 *   7.  Partial dispensing → plan reflects remaining; Rx stays ACTIVE
 *   8.  Fully dispensed → Rx becomes COMPLETED
 *   9.  COMPLETED Rx cannot be dispensed again (dispense + plan endpoints)
 *   10. Inventory, stock transactions, and audit logs stay consistent
 *   11. CONCURRENCY: two parallel dispenses of the last remaining quantity —
 *       exactly one succeeds (regression test for the FOR UPDATE row lock)
 *
 * Run: npx tsx scripts/e2e-dispense-safety.ts
 */
import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `DSP${Date.now().toString().slice(-7)}`;
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

const futureDate = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };

const ids = {
  facility: "", category: "", medicine: "", user: "", patient: "",
  batchEarly: "", batchLate: "", batchExpired: "", batchQuarantined: "",
};

async function setup() {
  const fac = await prisma.facility.create({ data: { name: `${SUFFIX} Clinic`, code: `${SUFFIX}-A` } });
  ids.facility = fac.id;
  const cat = await prisma.medicineCategory.create({ data: { name: `${SUFFIX} Cat` } });
  ids.category = cat.id;
  const med = await prisma.medicine.create({
    data: { medicineName: `${SUFFIX} Testamol 500mg`, categoryId: cat.id },
  });
  ids.medicine = med.id;

  // Batches: FEFO pair + expired + quarantined (seeded directly — receipt would rightly reject these)
  const bEarly = await prisma.stockBatch.create({
    data: { medicineId: med.id, facilityId: fac.id, batchNumber: `${SUFFIX}-EARLY`, expiryDate: futureDate(30), quantity: 20 },
  });
  const bLate = await prisma.stockBatch.create({
    data: { medicineId: med.id, facilityId: fac.id, batchNumber: `${SUFFIX}-LATE`, expiryDate: futureDate(365), quantity: 50 },
  });
  const bExpired = await prisma.stockBatch.create({
    data: { medicineId: med.id, facilityId: fac.id, batchNumber: `${SUFFIX}-EXP`, expiryDate: futureDate(-10), quantity: 40 },
  });
  const bQuar = await prisma.stockBatch.create({
    data: { medicineId: med.id, facilityId: fac.id, batchNumber: `${SUFFIX}-QUAR`, expiryDate: futureDate(180), quantity: 40, status: "QUARANTINED", quarantinedAt: new Date(), quarantineReason: "test" },
  });
  ids.batchEarly = bEarly.id; ids.batchLate = bLate.id; ids.batchExpired = bExpired.id; ids.batchQuarantined = bQuar.id;

  const user = await prisma.user.create({
    data: {
      email: `${SUFFIX.toLowerCase()}@test.local`, passwordHash: "x",
      firstName: "Disp", lastName: "Tester", role: "SUPER_ADMIN", facilityId: fac.id,
    },
  });
  ids.user = user.id;
  const patient = await prisma.patient.create({
    data: { patientId: `${SUFFIX}-P1`, firstName: "Jane", lastName: "Doe", gender: "Female", age: 30, facilityId: fac.id },
  });
  ids.patient = patient.id;

  return jwt.sign({ userId: user.id, email: user.email, role: "SUPER_ADMIN", facilityId: fac.id }, config.jwtSecret);
}

async function newRx(quantity: number): Promise<string> {
  const rx = await prisma.prescription.create({
    data: {
      prescriptionId: `${SUFFIX}-RX${Math.random().toString(36).slice(2, 8)}`,
      patientId: ids.patient, facilityId: ids.facility, status: "ACTIVE",
      medicines: { create: [{ medicineId: ids.medicine, quantity }] },
    },
  });
  return rx.id;
}

const batchQty = async (id: string) => (await prisma.stockBatch.findUnique({ where: { id } }))!.quantity;
const rxStatus = async (id: string) => (await prisma.prescription.findUnique({ where: { id } }))!.status;

async function run() {
  const token = await setup();
  const dispense = (rxId: string, qty: number, batchId = ids.batchEarly) =>
    req("POST", "/api/dispensing", token, {
      patientId: ids.patient, prescriptionId: rxId, medicineId: ids.medicine, batchId, quantity: qty,
    });
  const batchDispense = (rxId: string, lines: { batchId: string; quantity: number }[]) =>
    req("POST", "/api/dispensing/batch", token, {
      patientId: ids.patient, prescriptionId: rxId,
      lines: lines.map((l) => ({ medicineId: ids.medicine, ...l })),
    });

  console.log("\n── 1. Cannot dispense more than prescribed ──");
  let rx = await newRx(10);
  let r = await dispense(rx, 11);
  ok(r.status === 400 && /remaining|prescribed/i.test(r.body?.error ?? ""), `single: 11 of 10 rejected (${r.status}: ${r.body?.error})`);
  r = await batchDispense(rx, [{ batchId: ids.batchEarly, quantity: 6 }, { batchId: ids.batchLate, quantity: 6 }]);
  ok(r.status === 400, `batch: 6+6 of 10 across two batches rejected (got ${r.status})`);
  ok((await batchQty(ids.batchEarly)) === 20 && (await batchQty(ids.batchLate)) === 50, "no stock moved on rejected over-prescription dispense");

  console.log("\n── 2/5. Cannot exceed stock / go negative ──");
  rx = await newRx(100);
  r = await dispense(rx, 30, ids.batchEarly); // batch has 20
  ok(r.status === 400, `dispense 30 from batch of 20 rejected (got ${r.status})`);
  ok((await batchQty(ids.batchEarly)) === 20, "batch unchanged after rejected over-stock dispense (no negative)");

  console.log("\n── 3. Cannot dispense expired stock ──");
  r = await dispense(rx, 5, ids.batchExpired);
  ok(r.status === 400 && /expired/i.test(r.body?.error ?? ""), `expired batch rejected (${r.status}: ${r.body?.error})`);
  ok((await batchQty(ids.batchExpired)) === 40, "expired batch quantity unchanged");

  console.log("\n── 4. Cannot dispense quarantined stock ──");
  r = await dispense(rx, 5, ids.batchQuarantined);
  ok(r.status === 400 && /quarantin/i.test(r.body?.error ?? ""), `quarantined batch rejected (${r.status}: ${r.body?.error})`);
  ok((await batchQty(ids.batchQuarantined)) === 40, "quarantined batch quantity unchanged");

  console.log("\n── 6. FEFO recommendation ──");
  r = await req("GET", `/api/dispensing/prescription/${rx}/plan`, token);
  const line = r.body?.lines?.[0];
  ok(r.status === 200 && line?.recommendedBatchId === ids.batchEarly, `plan recommends soonest-expiry batch (got ${line?.recommendedBatchId === ids.batchEarly ? "EARLY" : line?.recommendedBatchId})`);
  ok(Array.isArray(line?.batches) && line.batches.every((b: any) => b.id !== ids.batchExpired && b.id !== ids.batchQuarantined),
    "plan excludes expired and quarantined batches");
  ok(line?.onHand === 70, `onHand counts only usable stock (got ${line?.onHand}, expect 70 = 20+50)`);

  console.log("\n── 7. Partial dispensing ──");
  rx = await newRx(10);
  r = await batchDispense(rx, [{ batchId: ids.batchEarly, quantity: 4 }]);
  ok(r.status === 201, `partial dispense of 4/10 accepted (got ${r.status})`);
  ok((await rxStatus(rx)) === "ACTIVE", "prescription stays ACTIVE after partial dispense");
  r = await req("GET", `/api/dispensing/prescription/${rx}/plan`, token);
  const pline = r.body?.lines?.[0];
  ok(pline?.alreadyDispensed === 4 && pline?.remainingQuantity === 6 && pline?.requestedQuantity === 6,
    `plan shows 4 dispensed / 6 remaining and pre-fills 6 (got ${pline?.alreadyDispensed}/${pline?.remainingQuantity}/${pline?.requestedQuantity})`);

  console.log("\n── 8/9. Completion + re-dispense block ──");
  r = await batchDispense(rx, [{ batchId: ids.batchEarly, quantity: 6 }]);
  ok(r.status === 201, `remaining 6 dispensed (got ${r.status})`);
  ok((await rxStatus(rx)) === "COMPLETED", "prescription auto-COMPLETED when fully dispensed");
  r = await dispense(rx, 1);
  ok(r.status === 400, `dispense against COMPLETED Rx rejected (got ${r.status})`);
  r = await req("GET", `/api/dispensing/prescription/${rx}/plan`, token);
  ok(r.status === 400, `plan for COMPLETED Rx rejected (got ${r.status}: ${r.body?.error})`);

  console.log("\n── 10. Inventory / transaction / audit consistency ──");
  // batchEarly: 20 - 4 - 6 = 10
  ok((await batchQty(ids.batchEarly)) === 10, `batch quantity 10 after 4+6 dispensed (got ${await batchQty(ids.batchEarly)})`);
  const txns = await prisma.stockTransaction.findMany({ where: { facilityId: ids.facility, type: "DISPENSING" } });
  const txnSum = txns.reduce((s, t) => s + t.quantity, 0);
  ok(txnSum === -10, `stock transactions sum to -10 (got ${txnSum})`);
  const recs = await prisma.dispensingRecord.findMany({ where: { facilityId: ids.facility } });
  const recSum = recs.reduce((s, x) => s + x.quantity, 0);
  ok(recSum === 10, `dispensing records sum to 10 (got ${recSum})`);
  const audits = await prisma.auditLog.count({ where: { facilityId: ids.facility, action: "DISPENSE" } });
  ok(audits >= 2, `DISPENSE audit entries written (got ${audits})`);
  for (const t of txns) {
    ok(t.balanceAfter === t.balanceBefore + t.quantity, `txn balance math consistent (${t.balanceBefore} ${t.quantity} → ${t.balanceAfter})`);
  }

  console.log("\n── 11. CONCURRENCY: parallel dispense of last remaining quantity ──");
  rx = await newRx(5);
  const [r1, r2] = await Promise.all([dispense(rx, 5, ids.batchLate), dispense(rx, 5, ids.batchLate)]);
  const statuses = [r1.status, r2.status].sort();
  ok(statuses[0] === 201 && statuses[1] === 400,
    `exactly one of two parallel 5-of-5 dispenses succeeded (got ${r1.status}, ${r2.status})`);
  const dispensedTotal = await prisma.dispensingRecord.aggregate({
    where: { prescriptionId: rx }, _sum: { quantity: true },
  });
  ok((dispensedTotal._sum.quantity ?? 0) === 5, `total dispensed is exactly 5, not 10 (got ${dispensedTotal._sum.quantity})`);
  ok((await rxStatus(rx)) === "COMPLETED", "racing prescription ended COMPLETED");
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
  if (ids.medicine) await prisma.medicine.deleteMany({ where: { id: ids.medicine } });
  if (ids.category) await prisma.medicineCategory.deleteMany({ where: { id: ids.category } });
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
  console.log(`DISPENSE SAFETY RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(fail ? 1 : 0);
})();
