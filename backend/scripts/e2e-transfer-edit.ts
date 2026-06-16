/**
 * Verifies PATCH /transfers/:id — editing a PENDING transfer (destination + lines),
 * no stock movement, over-qty rejection, and lock-after-authorize.
 * Run: npx tsx scripts/e2e-transfer-edit.ts
 */
import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `TE${Date.now().toString().slice(-7)}`;
let server: http.Server, baseUrl = "";
let pass = 0, fail = 0; const failures: string[] = [];
const ok = (c: boolean, l: string) => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; failures.push(l); console.log(`  ✗ FAIL: ${l}`); } };
async function req(method: string, path: string, token: string, body?: any) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let b: any = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  return { status: res.status, body: b };
}
const future = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const ids: Record<string, string> = {};
const bal = async (medId: string, fac: string) => (await prisma.stockBatch.aggregate({ _sum: { quantity: true }, where: { medicineId: medId, facilityId: fac } }))._sum.quantity ?? 0;

async function run() {
  const facA = await prisma.facility.create({ data: { name: `${SUFFIX} A`, code: `${SUFFIX}-A` } });
  const facB = await prisma.facility.create({ data: { name: `${SUFFIX} B`, code: `${SUFFIX}-B` } });
  const facC = await prisma.facility.create({ data: { name: `${SUFFIX} C`, code: `${SUFFIX}-C` } });
  ids.facA = facA.id; ids.facB = facB.id; ids.facC = facC.id;
  const cat = await prisma.medicineCategory.create({ data: { name: `${SUFFIX} C` } }); ids.cat = cat.id;
  const med1 = await prisma.medicine.create({ data: { medicineName: `${SUFFIX} M1`, categoryId: cat.id } });
  const med2 = await prisma.medicine.create({ data: { medicineName: `${SUFFIX} M2`, categoryId: cat.id } });
  ids.med1 = med1.id; ids.med2 = med2.id;
  const user = await prisma.user.create({ data: { email: `${SUFFIX}@t.local`, passwordHash: "x", firstName: "T", lastName: "A", role: "SUPER_ADMIN", facilityId: facA.id } });
  ids.user = user.id;
  const admin = jwt.sign({ userId: user.id, email: user.email, role: "SUPER_ADMIN", facilityId: facA.id }, config.jwtSecret);

  await req("POST", "/api/stock/receipt", admin, { medicineId: med1.id, batchNumber: `${SUFFIX}-B1`, expiryDate: future(400), quantityReceived: 100 });
  await req("POST", "/api/stock/receipt", admin, { medicineId: med2.id, batchNumber: `${SUFFIX}-B2`, expiryDate: future(400), quantityReceived: 100 });
  const b1 = await prisma.stockBatch.findFirst({ where: { medicineId: med1.id, facilityId: facA.id } });
  const b2 = await prisma.stockBatch.findFirst({ where: { medicineId: med2.id, facilityId: facA.id } });
  const a1Start = await bal(med1.id, facA.id), a2Start = await bal(med2.id, facA.id);

  console.log("\n[create PENDING transfer: M1×50 → B]");
  const created = await req("POST", "/api/transfers/new", admin, { fromFacilityId: facA.id, toFacilityId: facB.id, lines: [{ batchId: b1!.id, quantityTransferred: 50 }] });
  ok(created.status === 201 && created.body.status === "PENDING", `created PENDING (${created.status})`);
  const tid = created.body.id;

  console.log("\n[edit: change destination → C and line → M2×30]");
  const edit = await req("PATCH", `/api/transfers/${tid}`, admin, { toFacilityId: facC.id, lines: [{ batchId: b2!.id, quantityTransferred: 30 }] });
  ok(edit.status === 200, `edit accepted (${edit.status})`);
  ok(edit.body?.toFacilityId === facC.id, "destination updated to C");
  ok(edit.body?.lines?.length === 1 && edit.body.lines[0].medicineId === med2.id && edit.body.lines[0].quantityTransferred === 30, "line replaced with M2×30");
  ok((await bal(med1.id, facA.id)) === a1Start && (await bal(med2.id, facA.id)) === a2Start, "no stock moved by edit (PENDING)");

  console.log("\n[edit guard: over-quantity rejected]");
  const over = await req("PATCH", `/api/transfers/${tid}`, admin, { lines: [{ batchId: b2!.id, quantityTransferred: 9999 }] });
  ok(over.status === 400, `over-qty edit rejected (${over.status})`);

  console.log("\n[edit guard: same-facility destination rejected]");
  const same = await req("PATCH", `/api/transfers/${tid}`, admin, { toFacilityId: facA.id });
  ok(same.status === 400, `same-facility destination rejected (${same.status})`);

  console.log("\n[lock: cannot edit after authorize]");
  const auth = await req("POST", `/api/transfers/${tid}/authorize`, admin);
  ok(auth.status === 200 && auth.body.status === "AUTHORIZED", `authorized (${auth.status})`);
  const lateEdit = await req("PATCH", `/api/transfers/${tid}`, admin, { lines: [{ batchId: b2!.id, quantityTransferred: 10 }] });
  ok(lateEdit.status === 400, `edit blocked after authorize (${lateEdit.status})`);

  const neg = await prisma.stockBatch.count({ where: { quantity: { lt: 0 } } });
  ok(neg === 0, `no negative stock (${neg})`);
}

async function cleanup() {
  const facs = [ids.facA, ids.facB, ids.facC].filter(Boolean); if (!facs.length) return;
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
