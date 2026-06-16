/**
 * Final stock-management operational audit — executes scenarios 1–7 end-to-end
 * against the live DB by booting the real Express app in-process. Reports ACTUAL
 * behaviour (not assumptions). Cleans up its namespace afterwards.
 *
 * Run: npx tsx scripts/e2e-final-audit.ts
 */
import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `FA${Date.now().toString().slice(-7)}`;
let server: http.Server;
let baseUrl = "";
const findings: string[] = [];
function note(s: string) { findings.push(s); console.log(`    → ${s}`); }

type Resp = { status: number; body: any };
async function req(method: string, path: string, token: string, body?: any): Promise<Resp> {
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const future = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

const ids: Record<string, string> = {};
const roleIds: string[] = [];

async function mkRole(name: string, permissions: any) {
  const r = await prisma.role.create({ data: { name: `${SUFFIX}-${name}`, code: `${SUFFIX}-${name}`, permissions } });
  roleIds.push(r.id);
  return r.id;
}
function tokenFor(role: string, facilityId: string | null, roleId?: string) {
  return jwt.sign({ userId: ids.user, email: `${SUFFIX}@t.local`, role, facilityId, roleId }, config.jwtSecret);
}

async function setup() {
  const facA = await prisma.facility.create({ data: { name: `${SUFFIX} A`, code: `${SUFFIX}-A` } });
  const facB = await prisma.facility.create({ data: { name: `${SUFFIX} B`, code: `${SUFFIX}-B` } });
  ids.facA = facA.id; ids.facB = facB.id;
  const cat = await prisma.medicineCategory.create({ data: { name: `${SUFFIX} Cat`, requiresPrescription: false } });
  ids.cat = cat.id;
  const med = await prisma.medicine.create({ data: { medicineName: `${SUFFIX} Med`, categoryId: cat.id } });
  ids.med = med.id;
  const vendor = await prisma.vendor.create({ data: { name: `${SUFFIX} V`, code: `${SUFFIX}-V` } });
  ids.vendor = vendor.id;
  const user = await prisma.user.create({ data: { email: `${SUFFIX}@t.local`, passwordHash: "x", firstName: "T", lastName: "A", role: "SUPER_ADMIN", facilityId: facA.id } });
  ids.user = user.id;
  const patient = await prisma.patient.create({ data: { patientId: `${SUFFIX}-P`, firstName: "J", lastName: "D", gender: "F", age: 30, facilityId: facA.id } });
  ids.patient = patient.id;
}

async function batch(bn: string, fac: string) {
  return prisma.stockBatch.findUnique({ where: { medicineId_facilityId_batchNumber: { medicineId: ids.med, facilityId: fac, batchNumber: bn } } });
}

async function run() {
  await setup();
  const admin = tokenFor("SUPER_ADMIN", ids.facA);

  // Seed 200 into facility A
  await req("POST", "/api/stock/receipt", admin, { medicineId: ids.med, batchNumber: `${SUFFIX}-S`, expiryDate: future(400), quantityReceived: 200 });

  console.log("\n[1] TRANSFER OVER-RECEIPT (ship 100, receive 120)");
  const srcBatch = await batch(`${SUFFIX}-S`, ids.facA);
  let t = await req("POST", "/api/transfers/new", admin, { fromFacilityId: ids.facA, toFacilityId: ids.facB, lines: [{ batchId: srcBatch!.id, quantityTransferred: 100 }] });
  const transferId = t.body?.id; const lineId = t.body?.lines?.[0]?.id;
  await req("POST", `/api/transfers/${transferId}/authorize`, admin);
  await req("POST", `/api/transfers/${transferId}/dispatch`, admin);
  const over = await req("POST", `/api/transfers/${transferId}/receive-multi`, admin, { lines: [{ lineId, quantityReceived: 120 }] });
  const facBafter = await batch(`${SUFFIX}-S`, ids.facB);
  if (over.status >= 400) note("BLOCKED over-receipt of 120 vs 100 ✓");
  else note(`DEFECT: receiving 120 against 100 shipped was ACCEPTED (status ${over.status}); facility B credited ${facBafter?.quantity}`);

  console.log("\n[2] PARTIAL TRANSFER LIFECYCLE (ship 100; receive 40, 30, 30)");
  const t2 = await req("POST", "/api/transfers/new", admin, { fromFacilityId: ids.facA, toFacilityId: ids.facB, lines: [{ batchId: srcBatch!.id, quantityTransferred: 100 }] });
  const tid2 = t2.body?.id; const lid2 = t2.body?.lines?.[0]?.id;
  await req("POST", `/api/transfers/${tid2}/authorize`, admin);
  await req("POST", `/api/transfers/${tid2}/dispatch`, admin);
  const r1 = await req("POST", `/api/transfers/${tid2}/receive-multi`, admin, { lines: [{ lineId: lid2, quantityReceived: 40 }] });
  const r2 = await req("POST", `/api/transfers/${tid2}/receive-multi`, admin, { lines: [{ lineId: lid2, quantityReceived: 30 }] });
  const r3 = await req("POST", `/api/transfers/${tid2}/receive-multi`, admin, { lines: [{ lineId: lid2, quantityReceived: 30 }] });
  const finalT = await prisma.transfer.findUnique({ where: { id: tid2 }, include: { lines: true } });
  note(`receipt #1 (40): status ${r1.status}; #2 (30): status ${r2.status}; #3 (30): status ${r3.status}`);
  note(`transfer.line.quantityReceived = ${finalT?.lines[0]?.quantityReceived} (expected cumulative 100); transfer.status = ${finalT?.status}`);
  if (r2.status >= 400 && r3.status >= 400) note("DEFECT: cannot receive remaining 60 after first partial — remainder is stranded; transfer never closes at 100");
  else if (finalT?.lines[0]?.quantityReceived !== 100) note(`DEFECT: cumulative received is ${finalT?.lines[0]?.quantityReceived}, not tracked to 100`);

  console.log("\n[3] PRESCRIPTION FULFILLMENT (Rx qty 10; dispense 5, 5, 1)");
  // Fresh, well-stocked batch so the only thing under test is fulfillment limits.
  await req("POST", "/api/stock/receipt", admin, { medicineId: ids.med, batchNumber: `${SUFFIX}-RXB`, expiryDate: future(400), quantityReceived: 100 });
  const rx = await prisma.prescription.create({ data: { prescriptionId: `${SUFFIX}-RX`, patientId: ids.patient, facilityId: ids.facA, status: "ACTIVE", medicines: { create: [{ medicineId: ids.med, quantity: 10 }] } } });
  const sb = await batch(`${SUFFIX}-RXB`, ids.facA);
  const d1 = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 5 }] });
  const d2 = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 5 }] });
  const d3 = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 1 }] });
  const totalDispensed = await prisma.dispensingRecord.aggregate({ _sum: { quantity: true }, where: { prescriptionId: rx.id } });
  const rxAfter = await prisma.prescription.findUnique({ where: { id: rx.id } });
  note(`dispense 5: ${d1.status}; 5: ${d2.status}; +1 over: ${d3.status}; total dispensed = ${totalDispensed._sum.quantity} vs prescribed 10`);
  if (d3.status === 201) note("DEFECT: 11th unit dispensed against a 10-unit prescription — over-dispensing not blocked");
  if (rxAfter?.status !== "COMPLETED") note(`Rx status after full dispense = ${rxAfter?.status} (no auto-completion / fulfillment tracking)`);

  console.log("\n[4] RECEIPT EDIT BELOW CONSUMED");
  // order → receive 50 → dispense 30 → try to edit receipt down to 10
  const ord = await req("POST", "/api/orders", admin, { vendorId: ids.vendor, lines: [{ medicineId: ids.med, quantityOrdered: 50 }] });
  const ordId = ord.body?.id; const ordLineId = ord.body?.lines?.[0]?.id;
  const rec = await req("POST", `/api/orders/${ordId}/receive`, admin, { lines: [{ lineId: ordLineId, batchNumber: `${SUFFIX}-O`, expiryDate: future(300), quantityReceived: 50 }] });
  const recBatch = await batch(`${SUFFIX}-O`, ids.facA);
  // dispense 30 from this batch (need rx with this med — reuse rx but it's "completed"? still ACTIVE). create fresh rx
  const rx2 = await prisma.prescription.create({ data: { prescriptionId: `${SUFFIX}-RX2`, patientId: ids.patient, facilityId: ids.facA, status: "ACTIVE", medicines: { create: [{ medicineId: ids.med, quantity: 30 }] } } });
  await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx2.id, lines: [{ medicineId: ids.med, batchId: recBatch!.id, quantity: 30 }] });
  const orderFull = await req("GET", `/api/orders/${ordId}`, admin);
  const receiptId = orderFull.body?.receipts?.[0]?.id;
  const receiptLineId = orderFull.body?.receipts?.[0]?.lines?.[0]?.id;
  const edit = await req("PATCH", `/api/orders/${ordId}/receipts/${receiptId}`, admin, { reasonForChange: "test reduce below consumed", lines: [{ lineId: receiptLineId, quantityReceived: 10 }] });
  const batchNow = await batch(`${SUFFIX}-O`, ids.facA);
  note(`batch after receiving 50, dispensing 30 = ${batchNow?.quantity}`);
  if (edit.status >= 400) note(`BLOCKED reducing receipt to 10 (below 30 consumed) ✓ — msg: ${edit.body?.error?.slice(0, 80)}`);
  else note(`DEFECT: receipt reduced below consumed; batch now ${(await batch(`${SUFFIX}-O`, ids.facA))?.quantity}`);
  const negAny = await prisma.stockBatch.count({ where: { quantity: { lt: 0 } } });
  note(`negative batches in DB after edit attempt = ${negAny}`);

  console.log("\n[5] ORDER LIFECYCLE TRANSITIONS");
  const o2 = await req("POST", "/api/orders", admin, { vendorId: ids.vendor, lines: [{ medicineId: ids.med, quantityOrdered: 20 }] });
  const o2id = o2.body?.id; const o2line = o2.body?.lines?.[0]?.id;
  note(`created status = ${o2.body?.status} (expect SUBMITTED)`);
  const p1 = await req("POST", `/api/orders/${o2id}/receive`, admin, { lines: [{ lineId: o2line, batchNumber: `${SUFFIX}-O2`, expiryDate: future(300), quantityReceived: 8 }] });
  note(`after receiving 8/20 status = ${p1.body?.status} (expect PARTIALLY_RECEIVED)`);
  const p2 = await req("POST", `/api/orders/${o2id}/receive`, admin, { lines: [{ lineId: o2line, batchNumber: `${SUFFIX}-O2`, expiryDate: future(300), quantityReceived: 12 }] });
  note(`after receiving remaining 12 status = ${p2.body?.status} (expect RECEIVED)`);
  const over2 = await req("POST", `/api/orders/${o2id}/receive`, admin, { lines: [{ lineId: o2line, batchNumber: `${SUFFIX}-O2`, expiryDate: future(300), quantityReceived: 1 }] });
  note(`receiving more after RECEIVED: status ${over2.status} (expect blocked) ${over2.status >= 400 ? "✓" : "DEFECT"}`);

  console.log("\n[6] ROLE PERMISSIONS (API enforcement)");
  const ordOnly = tokenFor("PHARMACIST", ids.facA, await mkRole("ord", { orders: ["view", "create"] }));
  const recOnly = tokenFor("PHARMACIST", ids.facA, await mkRole("rec", { receiveStock: ["view", "create"] }));
  const invOnly = tokenFor("PHARMACIST", ids.facA, await mkRole("inv", { stock: ["view"] }));
  const a = await req("POST", "/api/orders", ordOnly, { vendorId: ids.vendor, lines: [{ medicineId: ids.med, quantityOrdered: 5 }] });
  const b = await req("POST", `/api/orders/${o2id}/receive`, ordOnly, { lines: [] });
  const c = await req("GET", "/api/stock/in-hand", ordOnly);
  note(`ordering-only: create order ${a.status} (want 201), receive ${b.status} (want 403), inventory ${c.status} (want 403)`);
  const e = await req("POST", "/api/orders", recOnly, { vendorId: ids.vendor, lines: [{ medicineId: ids.med, quantityOrdered: 5 }] });
  const f = await req("GET", "/api/stock/in-hand", recOnly);
  note(`receiving-only: create order ${e.status} (want 403), inventory ${f.status} (want 403)`);
  const g = await req("GET", "/api/stock/in-hand", invOnly);
  const h = await req("POST", "/api/orders", invOnly, { vendorId: ids.vendor, lines: [{ medicineId: ids.med, quantityOrdered: 5 }] });
  note(`inventory-only: inventory ${g.status} (want 200), create order ${h.status} (want 403)`);
  const okPerms = a.status === 201 && b.status === 403 && c.status === 403 && e.status === 403 && f.status === 403 && g.status === 200 && h.status === 403;
  note(okPerms ? "API permission enforcement CORRECT across all role shapes ✓" : "DEFECT: permission enforcement inconsistent (see above)");

  console.log("\n[7] AUDIT TRAIL COMPLETENESS (StockTransaction fields per movement type)");
  const txs = await prisma.stockTransaction.findMany({ where: { facilityId: { in: [ids.facA, ids.facB] } } });
  const byType: Record<string, { n: number; who: number; when: number; after: number; reason: number }> = {};
  for (const tx of txs) {
    const k = tx.type;
    byType[k] ??= { n: 0, who: 0, when: 0, after: 0, reason: 0 };
    byType[k].n++;
    if (tx.performedById) byType[k].who++;
    if (tx.createdAt) byType[k].when++;
    if (tx.balanceAfter != null) byType[k].after++;
    if (tx.reason) byType[k].reason++;
  }
  for (const [type, s] of Object.entries(byType)) {
    note(`${type}: n=${s.n} who=${s.who}/${s.n} when=${s.when}/${s.n} balanceAfter=${s.after}/${s.n} reason=${s.reason}/${s.n}`);
  }
  note("NOTE: StockTransaction has no explicit 'before quantity' column on any movement type.");
}

async function cleanup() {
  const facs = [ids.facA, ids.facB].filter(Boolean);
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
  if (ids.med) await prisma.medicine.deleteMany({ where: { id: ids.med } });
  if (ids.cat) await prisma.medicineCategory.deleteMany({ where: { id: ids.cat } });
  if (ids.vendor) await prisma.vendor.deleteMany({ where: { id: ids.vendor } });
  if (roleIds.length) await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.facility.deleteMany({ where: { id: { in: facs } } });
}

(async () => {
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try { await run(); }
  catch (e) { console.error("UNCAUGHT", e); }
  finally { try { await cleanup(); } catch (e) { console.error("cleanup", e); } server.close(); await prisma.$disconnect(); }
  process.exit(0);
})();
