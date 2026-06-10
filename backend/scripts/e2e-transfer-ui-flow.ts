/**
 * Replays the EXACT API sequence + payload shapes the transfer UI now issues:
 *   send/page          → POST /transfers/new        { toFacilityId, priority, lines:[{batchId, quantityTransferred}] }
 *   [id]/page authorize→ POST /transfers/:id/authorize
 *   [id]/page dispatch → POST /transfers/:id/dispatch
 *   [id]/page receive  → POST /transfers/:id/receive-multi { lines:[{lineId, quantityReceived}], finalizeShortfall }
 *
 * Asserts the three guarantees: no transfer gets stuck, no inventory loss, no phantom inventory.
 * Run: npx tsx scripts/e2e-transfer-ui-flow.ts
 */
import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `UI${Date.now().toString().slice(-7)}`;
let server: http.Server, baseUrl = "";
let pass = 0, fail = 0; const failures: string[] = [];
function ok(c: boolean, label: string) { if (c) { pass++; console.log(`  ✓ ${label}`); } else { fail++; failures.push(label); console.log(`  ✗ FAIL: ${label}`); } }
async function req(method: string, path: string, token: string, body?: any) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let b: any = null; try { b = text ? JSON.parse(text) : null; } catch { b = text; }
  return { status: res.status, body: b };
}
const future = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const ids: Record<string, string> = {};
const bal = async (medId: string, fac: string) => (await prisma.stockBatch.aggregate({ _sum: { quantity: true }, where: { medicineId: medId, facilityId: fac } }))._sum.quantity ?? 0;

async function run() {
  const facA = await prisma.facility.create({ data: { name: `${SUFFIX} A`, code: `${SUFFIX}-A` } });
  const facB = await prisma.facility.create({ data: { name: `${SUFFIX} B`, code: `${SUFFIX}-B` } });
  ids.facA = facA.id; ids.facB = facB.id;
  const cat = await prisma.medicineCategory.create({ data: { name: `${SUFFIX} C` } }); ids.cat = cat.id;
  const med1 = await prisma.medicine.create({ data: { medicineName: `${SUFFIX} Med1`, categoryId: cat.id } });
  const med2 = await prisma.medicine.create({ data: { medicineName: `${SUFFIX} Med2`, categoryId: cat.id } });
  ids.med1 = med1.id; ids.med2 = med2.id;
  const user = await prisma.user.create({ data: { email: `${SUFFIX}@t.local`, passwordHash: "x", firstName: "T", lastName: "A", role: "SUPER_ADMIN", facilityId: facA.id } });
  ids.user = user.id;
  const admin = jwt.sign({ userId: user.id, email: user.email, role: "SUPER_ADMIN", facilityId: facA.id }, config.jwtSecret);

  // stock source facility A
  await req("POST", "/api/stock/receipt", admin, { medicineId: med1.id, batchNumber: `${SUFFIX}-B1`, expiryDate: future(400), quantityReceived: 100 });
  await req("POST", "/api/stock/receipt", admin, { medicineId: med2.id, batchNumber: `${SUFFIX}-B2`, expiryDate: future(400), quantityReceived: 50 });
  const b1 = await prisma.stockBatch.findFirst({ where: { medicineId: med1.id, facilityId: facA.id } });
  const b2 = await prisma.stockBatch.findFirst({ where: { medicineId: med2.id, facilityId: facA.id } });
  const aStart1 = await bal(med1.id, facA.id), aStart2 = await bal(med2.id, facA.id);

  console.log("\n[UI: send/page] Create multi-line transfer (Med1×100, Med2×50)");
  const created = await req("POST", "/api/transfers/new", admin, {
    fromFacilityId: facA.id, toFacilityId: facB.id, priority: "ROUTINE",
    lines: [{ batchId: b1!.id, quantityTransferred: 100 }, { batchId: b2!.id, quantityTransferred: 50 }],
  });
  ok(created.status === 201 && created.body.status === "PENDING", `created → PENDING (got ${created.status}/${created.body?.status})`);
  const tid = created.body.id;
  const lineMed1 = created.body.lines.find((l: any) => l.medicineId === med1.id).id;
  const lineMed2 = created.body.lines.find((l: any) => l.medicineId === med2.id).id;
  ok((await bal(med1.id, facA.id)) === aStart1, "no stock moved on create (source unchanged)");

  console.log("\n[UI: detail] Authorize");
  const auth = await req("POST", `/api/transfers/${tid}/authorize`, admin);
  ok(auth.status === 200 && auth.body.status === "AUTHORIZED", `authorized (got ${auth.status}/${auth.body?.status})`);

  console.log("\n[UI: detail] Dispatch (deduct source, IN_TRANSIT)");
  const disp = await req("POST", `/api/transfers/${tid}/dispatch`, admin);
  ok(disp.status === 200 && disp.body.status === "IN_TRANSIT", `dispatched → IN_TRANSIT (got ${disp.status}/${disp.body?.status})`);
  ok((await bal(med1.id, facA.id)) === aStart1 - 100 && (await bal(med2.id, facA.id)) === aStart2 - 50, "source decremented by full transferred on dispatch");
  ok((await bal(med1.id, facB.id)) === 0, "destination still 0 in transit (no early credit)");

  console.log("\n[UI: detail] Partial receive #1 — Med1 40 (Med2 0)");
  let r = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lineMed1, quantityReceived: 40 }], finalizeShortfall: false });
  ok(r.status === 200 && r.body.status === "PARTIALLY_RECEIVED", `status PARTIALLY_RECEIVED (got ${r.body?.status})`);
  ok((await bal(med1.id, facB.id)) === 40, "destination Med1 = 40 after first partial");

  console.log("\n[UI: detail] Over-receipt guard — try Med1 70 (only 60 remain)");
  const over = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lineMed1, quantityReceived: 70 }], finalizeShortfall: false });
  ok(over.status === 400, `over-receipt rejected (got ${over.status})`);
  ok((await bal(med1.id, facB.id)) === 40, "no phantom inventory — destination still 40 after rejected over-receipt");

  console.log("\n[UI: detail] Partial receive #2 — Med1 30");
  r = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lineMed1, quantityReceived: 30 }], finalizeShortfall: false });
  ok(r.status === 200 && r.body.status === "PARTIALLY_RECEIVED", `still PARTIALLY_RECEIVED (got ${r.body?.status})`);

  console.log("\n[UI: detail] Final receive — Med1 30 + Med2 50 → RECEIVED");
  r = await req("POST", `/api/transfers/${tid}/receive-multi`, admin, { lines: [{ lineId: lineMed1, quantityReceived: 30 }, { lineId: lineMed2, quantityReceived: 50 }], finalizeShortfall: false });
  ok(r.status === 200 && r.body.status === "RECEIVED", `transfer closed → RECEIVED, not stuck (got ${r.body?.status})`);

  const dEnd1 = await bal(med1.id, facB.id), dEnd2 = await bal(med2.id, facB.id);
  const aEnd1 = await bal(med1.id, facA.id), aEnd2 = await bal(med2.id, facA.id);
  ok(dEnd1 === 100 && dEnd2 === 50, `destination fully credited (Med1 ${dEnd1}/100, Med2 ${dEnd2}/50)`);
  // Conservation: source decrease == destination increase (no loss, no phantom)
  ok((aStart1 - aEnd1) === dEnd1 && (aStart2 - aEnd2) === dEnd2, `conservation holds: source −(${aStart1 - aEnd1},${aStart2 - aEnd2}) == dest +(${dEnd1},${dEnd2})`);

  const finalTransfer = await prisma.transfer.findUnique({ where: { id: tid }, include: { lines: true } });
  ok(finalTransfer?.lines.every((l) => (l.quantityReceived ?? 0) === l.quantityTransferred) ?? false, "every line received in full (no stranded remainder)");
  const neg = await prisma.stockBatch.count({ where: { quantity: { lt: 0 } } });
  ok(neg === 0, `no negative stock anywhere (found ${neg})`);
}

async function cleanup() {
  const facs = [ids.facA, ids.facB].filter(Boolean); if (!facs.length) return;
  await prisma.stockTransaction.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.transferLine.deleteMany({ where: { transfer: { OR: [{ fromFacilityId: { in: facs } }, { toFacilityId: { in: facs } }] } } });
  await prisma.shipmentEvent.deleteMany({ where: { shipment: { destinationFacilityId: { in: facs } } } });
  await prisma.shipment.deleteMany({ where: { destinationFacilityId: { in: facs } } });
  await prisma.transfer.deleteMany({ where: { OR: [{ fromFacilityId: { in: facs } }, { toFacilityId: { in: facs } }] } });
  await prisma.stockBatch.deleteMany({ where: { facilityId: { in: facs } } });
  await prisma.alert.deleteMany({ where: { facilityId: { in: facs } } });
  if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
  await prisma.auditLog.deleteMany({ where: { facilityId: { in: facs } } });
  if (ids.med1) await prisma.medicine.deleteMany({ where: { id: { in: [ids.med1, ids.med2] } } });
  if (ids.cat) await prisma.medicineCategory.deleteMany({ where: { id: ids.cat } });
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
