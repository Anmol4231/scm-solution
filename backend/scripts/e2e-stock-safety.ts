/**
 * End-to-end stock-safety verification.
 *
 * Boots the real Express app in-process (real routes, middleware, RBAC, error
 * handler) against the live dev database and drives the guarded paths over HTTP.
 * Creates an isolated test namespace and cleans it up afterwards.
 *
 * Run: npx tsx scripts/e2e-stock-safety.ts
 */
import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `E2E${Date.now().toString().slice(-7)}`;
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

const future = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
};
const pastDateISO = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() - days); return d;
};

// ── created ids for cleanup ──
const ids = {
  facility: "", facility2: "", category: "", medicine: "", vendor: "",
  user: "", patient: "", prescription: "",
};

async function setup() {
  const fac = await prisma.facility.create({ data: { name: `${SUFFIX} Clinic`, code: `${SUFFIX}-A` } });
  const fac2 = await prisma.facility.create({ data: { name: `${SUFFIX} Store`, code: `${SUFFIX}-B` } });
  ids.facility = fac.id; ids.facility2 = fac2.id;

  const cat = await prisma.medicineCategory.create({ data: { name: `${SUFFIX} Cat` } });
  ids.category = cat.id;
  const med = await prisma.medicine.create({
    data: { medicineName: `${SUFFIX} Paracetamol`, categoryId: cat.id, minimumOrderLevel: 10 },
  });
  ids.medicine = med.id;
  const vendor = await prisma.vendor.create({ data: { name: `${SUFFIX} Vendor`, code: `${SUFFIX}-V` } });
  ids.vendor = vendor.id;

  const user = await prisma.user.create({
    data: {
      email: `${SUFFIX.toLowerCase()}@test.local`, passwordHash: "x",
      firstName: "Test", lastName: "Admin", role: "SUPER_ADMIN", facilityId: fac.id,
    },
  });
  ids.user = user.id;

  const patient = await prisma.patient.create({
    data: { patientId: `${SUFFIX}-P1`, firstName: "Jane", lastName: "Doe", gender: "Female", age: 30, facilityId: fac.id },
  });
  ids.patient = patient.id;
  const rx = await prisma.prescription.create({
    data: {
      prescriptionId: `${SUFFIX}-RX1`, patientId: patient.id, facilityId: fac.id, status: "ACTIVE",
      medicines: { create: [{ medicineId: med.id, quantity: 20 }] },
    },
  });
  ids.prescription = rx.id;

  // SUPER_ADMIN token scoped to facility A (cross-facility role, facility-scoped via token)
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: "SUPER_ADMIN", facilityId: fac.id },
    config.jwtSecret
  );
  return { token };
}

async function batchQty(batchNumber: string, facilityId = ids.facility): Promise<number | null> {
  const b = await prisma.stockBatch.findUnique({
    where: { medicineId_facilityId_batchNumber: { medicineId: ids.medicine, facilityId, batchNumber } },
  });
  return b?.quantity ?? null;
}

async function run() {
  const { token } = await setup();

  console.log("\n── P2: Receiving rejects expired / past expiry ──");
  let r = await req("POST", "/api/stock/receipt", token, {
    medicineId: ids.medicine, batchNumber: `${SUFFIX}-EXPRX`, expiryDate: future(-1), quantityReceived: 50,
  });
  ok(r.status === 400, `past-dated stock receipt rejected (got ${r.status})`);
  ok((await batchQty(`${SUFFIX}-EXPRX`)) === null, "no batch created for rejected expired receipt");

  console.log("\n── Seed: receive good stock ──");
  r = await req("POST", "/api/stock/receipt", token, {
    medicineId: ids.medicine, batchNumber: `${SUFFIX}-B1`, expiryDate: future(365), quantityReceived: 10,
  });
  ok(r.status === 201, `valid receipt accepted (got ${r.status})`);
  ok((await batchQty(`${SUFFIX}-B1`)) === 10, "batch B1 has qty 10 after receipt");

  console.log("\n── P1: Consumption cannot oversell (no negative) ──");
  r = await req("POST", "/api/stock/consumption", token, {
    medicineId: ids.medicine, quantityUsed: 100, reportingPeriod: "2026-06",
  });
  ok(r.status === 400, `over-consumption rejected (got ${r.status})`);
  ok((await batchQty(`${SUFFIX}-B1`)) === 10, "batch unchanged after rejected over-consumption (no negative)");

  console.log("\n── P1: Transfer cannot oversell (no negative) ──");
  const b1 = await prisma.stockBatch.findUnique({
    where: { medicineId_facilityId_batchNumber: { medicineId: ids.medicine, facilityId: ids.facility, batchNumber: `${SUFFIX}-B1` } },
  });
  r = await req("POST", "/api/transfers", token, {
    toFacilityId: ids.facility2, medicineId: ids.medicine, batchId: b1!.id, quantity: 9999,
  });
  ok(r.status === 400, `over-quantity transfer rejected (got ${r.status})`);
  ok((await batchQty(`${SUFFIX}-B1`)) === 10, "batch unchanged after rejected transfer (no negative)");

  console.log("\n── P1/P2: Dispensing happy path + expired block ──");
  r = await req("POST", "/api/dispensing/batch", token, {
    patientId: ids.patient, prescriptionId: ids.prescription,
    lines: [{ medicineId: ids.medicine, batchId: b1!.id, quantity: 4 }],
  });
  ok(r.status === 201, `dispense 4 succeeded (got ${r.status}) ${r.status !== 201 ? JSON.stringify(r.body) : ""}`);
  ok((await batchQty(`${SUFFIX}-B1`)) === 6, "batch B1 reduced to 6 after dispense");

  // create an ACTIVE-but-expired batch directly, then prove it can't be used
  const expiredBatch = await prisma.stockBatch.create({
    data: { medicineId: ids.medicine, facilityId: ids.facility, batchNumber: `${SUFFIX}-EXP`, expiryDate: pastDateISO(2), quantity: 50, status: "ACTIVE" },
  });
  r = await req("POST", "/api/dispensing/batch", token, {
    patientId: ids.patient, prescriptionId: ids.prescription,
    lines: [{ medicineId: ids.medicine, batchId: expiredBatch.id, quantity: 1 }],
  });
  ok(r.status === 400, `dispensing expired batch rejected (got ${r.status})`);
  ok((await batchQty(`${SUFFIX}-EXP`)) === 50, "expired batch untouched after rejected dispense");

  r = await req("POST", "/api/transfers", token, {
    toFacilityId: ids.facility2, medicineId: ids.medicine, batchId: expiredBatch.id, quantity: 1,
  });
  ok(r.status === 400, `transferring expired batch rejected (got ${r.status})`);

  console.log("\n── P1: Stock adjustment never goes negative ──");
  // physical count 2 vs system (B1=6, EXP=50) = 56 → reduce by 54, spread FEFO, none negative
  r = await req("POST", "/api/stock/adjustment", token, {
    medicineId: ids.medicine, physicalCount: 2, reason: "stock take",
  });
  ok(r.status === 201, `downward adjustment accepted (got ${r.status})`);
  const negCount = await prisma.stockBatch.count({ where: { medicineId: ids.medicine, facilityId: ids.facility, quantity: { lt: 0 } } });
  ok(negCount === 0, "no negative batch after large downward adjustment");

  console.log("\n── P3: Expired lifecycle (auto-expire, quarantine, dispose) ──");
  // re-stock an active batch and an active-expired batch for lifecycle tests
  await prisma.stockBatch.updateMany({ where: { medicineId: ids.medicine, facilityId: ids.facility, batchNumber: `${SUFFIX}-EXP` }, data: { quantity: 30, status: "ACTIVE" } });
  // GET expiry alerts triggers refreshExpiredBatches → EXP should flip to EXPIRED
  r = await req("GET", `/api/expiry/alerts?facilityId=${ids.facility}`, token);
  ok(r.status === 200, `expiry alerts loaded (got ${r.status})`);
  let exp = await prisma.stockBatch.findFirst({ where: { medicineId: ids.medicine, facilityId: ids.facility, batchNumber: `${SUFFIX}-EXP` } });
  ok(exp?.status === "EXPIRED", `expired batch auto-flipped to EXPIRED (got ${exp?.status})`);

  // quarantine the good batch B1, then prove it's unusable
  r = await req("POST", "/api/expiry/quarantine", token, { batchId: b1!.id, reason: "investigation" });
  ok(r.status === 200, `quarantine accepted (got ${r.status})`);
  const qb = await prisma.stockBatch.findUnique({ where: { id: b1!.id } });
  ok(qb?.status === "QUARANTINED", `batch B1 now QUARANTINED (got ${qb?.status})`);
  r = await req("POST", "/api/transfers", token, { toFacilityId: ids.facility2, medicineId: ids.medicine, batchId: b1!.id, quantity: 1 });
  ok(r.status === 400, `quarantined batch cannot be transferred (got ${r.status})`);

  // dispose the expired batch
  r = await req("POST", "/api/expiry/record-expired", token, {
    medicineId: ids.medicine, batchNumber: `${SUFFIX}-EXP`, expiryDate: pastDateISO(2).toISOString().slice(0, 10),
    quantity: 30, disposalMethod: "Incineration", disposalWitness: "Witness X", facilityId: ids.facility,
  });
  ok(r.status === 201, `disposal recorded (got ${r.status})`);
  exp = await prisma.stockBatch.findFirst({ where: { medicineId: ids.medicine, facilityId: ids.facility, batchNumber: `${SUFFIX}-EXP` } });
  ok(exp?.quantity === 0, `disposed batch emptied (got ${exp?.quantity})`);
  ok(exp?.status === "DISPOSED", `disposed batch status DISPOSED (got ${exp?.status})`);

  console.log("\n── Audit trail integrity ──");
  const disposalAudit = await prisma.auditLog.findFirst({ where: { userId: ids.user, action: "DISPOSAL" } });
  ok(!!disposalAudit, "DISPOSAL audit entry written");
  ok(!!(disposalAudit?.details as any)?.disposalWitness, "disposal audit captures witness");
  const quarantineAudit = await prisma.auditLog.findFirst({ where: { userId: ids.user, action: "BATCH_QUARANTINE" } });
  ok(!!quarantineAudit, "BATCH_QUARANTINE audit entry written");
  const expiredTx = await prisma.stockTransaction.findFirst({ where: { medicineId: ids.medicine, facilityId: ids.facility, type: "EXPIRED" } });
  ok(!!expiredTx && expiredTx.quantity === -30, `EXPIRED ledger entry matches disposed qty (got ${expiredTx?.quantity})`);

  console.log("\n── Global invariant: no negative stock anywhere ──");
  const anyNeg = await prisma.stockBatch.count({ where: { quantity: { lt: 0 } } });
  ok(anyNeg === 0, `zero negative-quantity batches in the entire database (found ${anyNeg})`);
}

async function cleanup() {
  const facs = [ids.facility, ids.facility2].filter(Boolean);
  if (!facs.length) return;
  await prisma.dispensingRecord.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.stockTransaction.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.expiredMedicineRecord.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.medicineReturn.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.transferLine.deleteMany({ where: { transfer: { OR: [{ fromFacilityId: { in: facs } }, { toFacilityId: { in: facs } }] } } });
  await prisma.shipmentEvent.deleteMany({ where: { shipment: { destinationFacilityId: { in: facs } } } });
  await prisma.shipment.deleteMany({ where: { destinationFacilityId: { in: facs } } });
  await prisma.transfer.deleteMany({ where: { OR: [{ fromFacilityId: { in: facs } }, { toFacilityId: { in: facs } }] } });
  await prisma.stockReceiptLine.deleteMany({ where: { receipt: { facilityId: { in: facs } } } });
  await prisma.stockReceipt.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.stockOrderLine.deleteMany({ where: { order: { facilityId: { in: facs } } } });
  await prisma.stockOrder.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.alert.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.auditLog.deleteMany({ where: { facilityId: { in: facs } } });
  if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
  await prisma.stockBatch.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.prescriptionMedicine.deleteMany({ where: { prescription: { facilityId: { in: facs } } } });
  await prisma.prescription.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.patient.deleteMany({ where: { facilityId: { in: facs } } });
  if (ids.medicine) await prisma.medicine.deleteMany({ where: { id: ids.medicine } });
  if (ids.category) await prisma.medicineCategory.deleteMany({ where: { id: ids.category } });
  if (ids.vendor) await prisma.vendor.deleteMany({ where: { id: ids.vendor } });
  if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.facility.deleteMany({ where: { id: { in: facs } } });
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
  console.log(`RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(fail ? 1 : 0);
})();
