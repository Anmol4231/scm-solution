/**
 * Regression suite for the confirmed defects C-1, C-2, B-1 and audit completeness.
 * Boots the real app in-process against the live DB; strict pass/fail with exit code.
 *
 * Run: npx tsx scripts/e2e-stock-regression.ts
 */
import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `RG${Date.now().toString().slice(-7)}`;
let server: http.Server;
let baseUrl = "";
let pass = 0, fail = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ FAIL: ${label}`); }
}

type Resp = { status: number; body: any };
async function req(method: string, path: string, token: string, body?: any): Promise<Resp> {
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const future = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const ids: Record<string, string> = {};

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
const batch = (bn: string, fac: string) => prisma.stockBatch.findUnique({ where: { medicineId_facilityId_batchNumber: { medicineId: ids.med, facilityId: fac, batchNumber: bn } } });
async function newTransfer(token: string, bn: string, qty: number) {
  const sb = await batch(bn, ids.facA);
  const t = await req("POST", "/api/transfers/new", token, { fromFacilityId: ids.facA, toFacilityId: ids.facB, lines: [{ batchId: sb!.id, quantityTransferred: qty }] });
  const tid = t.body.id, lid = t.body.lines[0].id;
  await req("POST", `/api/transfers/${tid}/authorize`, token);
  await req("POST", `/api/transfers/${tid}/dispatch`, token);
  return { tid, lid };
}

async function run() {
  await setup();
  const admin = jwt.sign({ userId: ids.user, email: `${SUFFIX}@t.local`, role: "SUPER_ADMIN", facilityId: ids.facA }, config.jwtSecret);
  // stock A heavily for all transfer tests
  await req("POST", "/api/stock/receipt", admin, { medicineId: ids.med, batchNumber: `${SUFFIX}-S`, expiryDate: future(400), quantityReceived: 500 });

  console.log("\n[C-1] Transfer over-receipt blocked");
  { const { tid, lid } = await newTransfer(admin, `${SUFFIX}-S`, 100);
    const r = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lid, quantityReceived: 120 }] });
    ok(r.status === 400, `receive 120 vs 100 shipped rejected (got ${r.status})`);
    const fb = await batch(`${SUFFIX}-S`, ids.facB);
    ok((fb?.quantity ?? 0) === 0, `facility B credited nothing on rejected over-receipt (got ${fb?.quantity ?? 0})`);
    // also reject over-receipt across a valid partial then an overage
    const ok40 = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lid, quantityReceived: 40 }] });
    const over = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lid, quantityReceived: 70 }] });
    ok(ok40.status === 200 && over.status === 400, `after receiving 40, receiving 70 more (>60 remaining) rejected (got ${over.status})`);
  }

  console.log("\n[C-2] Cumulative partial receipts → exact completion");
  { const { tid, lid } = await newTransfer(admin, `${SUFFIX}-S`, 100);
    const r1 = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lid, quantityReceived: 40 }] });
    const s1 = (await prisma.transfer.findUnique({ where: { id: tid } }))!.status;
    const r2 = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lid, quantityReceived: 30 }] });
    const r3 = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lid, quantityReceived: 30 }] });
    ok(r1.status === 200 && r2.status === 200 && r3.status === 200, `all three partial receipts accepted (${r1.status}/${r2.status}/${r3.status})`);
    ok(s1 === "PARTIALLY_RECEIVED", `status after first 40 = PARTIALLY_RECEIVED (got ${s1})`);
    const tf = await prisma.transfer.findUnique({ where: { id: tid }, include: { lines: true } });
    ok(tf?.lines[0].quantityReceived === 100, `cumulative received tracked to 100 (got ${tf?.lines[0].quantityReceived})`);
    ok(tf?.status === "RECEIVED", `transfer auto-closed to RECEIVED at 100 (got ${tf?.status})`);
    // inventory conservation: source out == dest in
    const out = await prisma.stockTransaction.aggregate({ _sum: { quantity: true }, where: { transferId: tid, type: "TRANSFER_OUT" } });
    const inn = await prisma.stockTransaction.aggregate({ _sum: { quantity: true }, where: { transferId: tid, type: "TRANSFER_IN" } });
    ok((out._sum.quantity ?? 0) === -100 && (inn._sum.quantity ?? 0) === 100, `conservation: source -${-(out._sum.quantity ?? 0)} == dest +${inn._sum.quantity ?? 0}`);
  }

  console.log("\n[C-2b] Short shipment closes with documented loss (no stranding)");
  { const { tid, lid } = await newTransfer(admin, `${SUFFIX}-S`, 50);
    const r = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lid, quantityReceived: 30 }], finalizeShortfall: true });
    ok(r.status === 200, `short receipt (30/50) with finalize accepted (got ${r.status})`);
    const tf = await prisma.transfer.findUnique({ where: { id: tid }, include: { lines: true } });
    ok(tf?.status === "RECEIVED", `short shipment closed to RECEIVED (got ${tf?.status})`);
    ok(tf?.lines[0].shortfallFlag === true, "shortfall flagged on the line");
    const loss = await prisma.auditLog.findFirst({ where: { entityId: tid, action: "TRANSFER_SHORTFALL_LOSS" } });
    const lostQty = (loss?.details as any)?.lostInTransit?.[0]?.shortfall;
    ok(lostQty === 20, `documented loss = 20 (source 50 = dest 30 + loss 20) (got ${lostQty})`);
  }

  console.log("\n[B-1] Prescription fulfillment (prescribe 10; dispense 5,5,+1)");
  { await req("POST", "/api/stock/receipt", admin, { medicineId: ids.med, batchNumber: `${SUFFIX}-RX`, expiryDate: future(400), quantityReceived: 100 });
    const sb = await batch(`${SUFFIX}-RX`, ids.facA);
    const rx = await prisma.prescription.create({ data: { prescriptionId: `${SUFFIX}-RXa`, patientId: ids.patient, facilityId: ids.facA, status: "ACTIVE", medicines: { create: [{ medicineId: ids.med, quantity: 10 }] } } });
    const d1 = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 5 }] });
    // While still ACTIVE with 5 remaining, attempt 6 → blocked by the remaining-quantity cap.
    const dOver = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 6 }] });
    const d2 = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 5 }] });
    const d3 = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 1 }] });
    ok(d1.status === 201 && d2.status === 201, `dispenses of 5 then 5 accepted (${d1.status}/${d2.status})`);
    ok(dOver.status === 400 && /remaining/i.test(dOver.body?.error ?? ""), `dispensing 6 with 5 remaining rejected with remaining message: "${dOver.body?.error?.slice(0, 90)}"`);
    ok(d3.status === 400, `11th unit rejected (got ${d3.status})`);
    const total = await prisma.dispensingRecord.aggregate({ _sum: { quantity: true }, where: { prescriptionId: rx.id } });
    ok((total._sum.quantity ?? 0) === 10, `total dispensed capped at 10 (got ${total._sum.quantity})`);
    const after = await prisma.prescription.findUnique({ where: { id: rx.id } });
    ok(after?.status === "COMPLETED", `prescription auto-completed (got ${after?.status})`);
    const d4 = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 1 }] });
    ok(d4.status === 400, `no dispensing allowed against a completed prescription (got ${d4.status})`);
  }

  console.log("\n[B-1b] Partial-then-complete tracking");
  { await req("POST", "/api/stock/receipt", admin, { medicineId: ids.med, batchNumber: `${SUFFIX}-RX2`, expiryDate: future(400), quantityReceived: 100 });
    const sb = await batch(`${SUFFIX}-RX2`, ids.facA);
    const rx = await prisma.prescription.create({ data: { prescriptionId: `${SUFFIX}-RXb`, patientId: ids.patient, facilityId: ids.facA, status: "ACTIVE", medicines: { create: [{ medicineId: ids.med, quantity: 10 }] } } });
    await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 7 }] });
    const mid = await prisma.prescription.findUnique({ where: { id: rx.id } });
    ok(mid?.status === "ACTIVE", `still ACTIVE after 7/10 (got ${mid?.status})`);
    const over = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 4 }] });
    ok(over.status === 400, `dispensing 4 when only 3 remain rejected (got ${over.status})`);
    const fin = await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: sb!.id, quantity: 3 }] });
    ok(fin.status === 201, `final 3 accepted (got ${fin.status})`);
    const done = await prisma.prescription.findUnique({ where: { id: rx.id } });
    ok(done?.status === "COMPLETED", `completed after exactly 10 (got ${done?.status})`);
  }

  console.log("\n[Receipt-edit] Reducing below consumed → structured 400, no 500");
  { const ord = await req("POST", "/api/orders", admin, { vendorId: ids.vendor, lines: [{ medicineId: ids.med, quantityOrdered: 50 }] });
    const ordId = ord.body.id, ordLine = ord.body.lines[0].id;
    await req("POST", `/api/orders/${ordId}/receive`, admin, { lines: [{ lineId: ordLine, batchNumber: `${SUFFIX}-RE`, expiryDate: future(300), quantityReceived: 50 }] });
    const reBatch = await batch(`${SUFFIX}-RE`, ids.facA);
    const rx = await prisma.prescription.create({ data: { prescriptionId: `${SUFFIX}-RXc`, patientId: ids.patient, facilityId: ids.facA, status: "ACTIVE", medicines: { create: [{ medicineId: ids.med, quantity: 30 }] } } });
    await req("POST", "/api/dispensing/batch", admin, { patientId: ids.patient, prescriptionId: rx.id, lines: [{ medicineId: ids.med, batchId: reBatch!.id, quantity: 30 }] });
    const full = await req("GET", `/api/orders/${ordId}`, admin);
    const receiptId = full.body.receipts[0].id, receiptLineId = full.body.receipts[0].lines[0].id;
    const edit = await req("PATCH", `/api/orders/${ordId}/receipts/${receiptId}`, admin, { reasonForChange: "reduce below consumed", lines: [{ lineId: receiptLineId, quantityReceived: 10 }] });
    ok(edit.status === 400, `receipt-edit below consumed returns 400 (got ${edit.status})`);
    ok(edit.body?.code === "ValidationError", `structured error code present (got ${JSON.stringify(edit.body?.code)})`);
    ok(typeof edit.body?.error === "string" && /below/i.test(edit.body.error) && !/\bat\s|node_modules/.test(edit.body.error), `friendly message, no stack trace: "${edit.body?.error?.slice(0, 70)}"`);
    const b = await batch(`${SUFFIX}-RE`, ids.facA);
    ok((b?.quantity ?? 0) === 20, `inventory unchanged by rejected edit (got ${b?.quantity})`);
  }

  console.log("\n[P3] Audit completeness — generate RETURN + EXPIRED, then verify ledger");
  { // facility return generates RETURN_OUT (A) + RETURN_IN (B)
    await req("POST", "/api/returns/facility", admin, { returnType: "FACILITY_TO_AMS", receivingFacilityId: ids.facB, medicineId: ids.med, batchNumber: `${SUFFIX}-RX`, expiryDate: future(400), quantity: 5, returnReason: "surplus" });
    // disposal generates EXPIRED
    const expB = await prisma.stockBatch.create({ data: { medicineId: ids.med, facilityId: ids.facA, batchNumber: `${SUFFIX}-EXP`, expiryDate: new Date(future(-3)), quantity: 10, status: "EXPIRED" } });
    void expB;
    await req("POST", "/api/expiry/record-expired", admin, { medicineId: ids.med, batchNumber: `${SUFFIX}-EXP`, expiryDate: future(-3), quantity: 10, disposalMethod: "Incineration", facilityId: ids.facA });

    const types = ["DISPENSING", "TRANSFER_OUT", "TRANSFER_IN", "RETURN_IN", "RETURN_OUT", "EXPIRED"];
    for (const type of types) {
      const rows = await prisma.stockTransaction.findMany({ where: { facilityId: { in: [ids.facA, ids.facB] }, type: type as any } });
      const withBoth = rows.filter((r) => r.balanceBefore != null && r.balanceAfter != null);
      const reconstructs = rows.every((r) => r.balanceBefore != null && r.balanceAfter != null && Math.abs((r.balanceBefore! + r.quantity) - r.balanceAfter!) < 1e-9);
      ok(rows.length > 0 && withBoth.length === rows.length, `${type}: all ${rows.length} rows have balanceBefore & balanceAfter`);
      ok(rows.length > 0 && reconstructs, `${type}: balanceAfter == balanceBefore + quantityChanged on every row`);
    }
  }
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
  await prisma.stockBatch.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.prescriptionMedicine.deleteMany({ where: { prescription: { facilityId: { in: facs } } } });
  await prisma.prescription.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.patient.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.alert.deleteMany({ where: { facilityId: { in: facs } } });
  if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
  await prisma.auditLog.deleteMany({ where: { facilityId: { in: facs } } });
  if (ids.med) await prisma.medicine.deleteMany({ where: { id: ids.med } });
  if (ids.cat) await prisma.medicineCategory.deleteMany({ where: { id: ids.cat } });
  if (ids.vendor) await prisma.vendor.deleteMany({ where: { id: ids.vendor } });
  if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.facility.deleteMany({ where: { id: { in: facs } } });
}

(async () => {
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try { await run(); } catch (e) { fail++; failures.push(`UNCAUGHT: ${e instanceof Error ? e.message : String(e)}`); console.error(e); }
  finally { try { await cleanup(); } catch (e) { console.error("cleanup", e); } server.close(); await prisma.$disconnect(); }
  console.log(`\n══════════════════════════════════════\nRESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(fail ? 1 : 0);
})();
