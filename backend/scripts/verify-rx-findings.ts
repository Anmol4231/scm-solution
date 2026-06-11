/**
 * Adversarial verification of dispensing-audit candidate findings (pre-fix).
 *
 *   F1: GET  /api/prescriptions/:id        — cross-facility read by a facility-bound user
 *   F2: PATCH /api/prescriptions/:id/status — cross-facility cancel + no audit entry
 *   F4: POST /api/prescriptions/ocr         — multipart filename "../<name>" escapes uploads/
 *
 * Run: npx tsx scripts/verify-rx-findings.ts
 */
import http from "http";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `VRF${Date.now().toString().slice(-7)}`;
let server: http.Server;
let baseUrl = "";

const ids = { facA: "", facB: "", userA: "", patientB: "", rxB: "" };

async function setup() {
  const facA = await prisma.facility.create({ data: { name: `${SUFFIX} Clinic A`, code: `${SUFFIX}-A` } });
  const facB = await prisma.facility.create({ data: { name: `${SUFFIX} Clinic B`, code: `${SUFFIX}-B` } });
  ids.facA = facA.id; ids.facB = facB.id;

  // PHARMACIST bound to facility A (not a cross-facility role)
  const userA = await prisma.user.create({
    data: {
      email: `${SUFFIX.toLowerCase()}@test.local`, passwordHash: "x",
      firstName: "Adv", lastName: "Tester", role: "PHARMACIST", facilityId: facA.id,
    },
  });
  ids.userA = userA.id;

  const patientB = await prisma.patient.create({
    data: { patientId: `${SUFFIX}-PB`, firstName: "Foreign", lastName: "Patient", gender: "Male", age: 44, facilityId: facB.id },
  });
  ids.patientB = patientB.id;

  const rxB = await prisma.prescription.create({
    data: {
      prescriptionId: `${SUFFIX}-RXB`, patientId: patientB.id, facilityId: facB.id, status: "ACTIVE",
      diagnosisNotes: "CONFIDENTIAL-OTHER-FACILITY",
    },
  });
  ids.rxB = rxB.id;

  return jwt.sign(
    { userId: userA.id, email: userA.email, role: "PHARMACIST", facilityId: facA.id },
    config.jwtSecret
  );
}

async function run() {
  const token = await setup();

  console.log("── F1: cross-facility prescription read ──");
  let res = await fetch(`${baseUrl}/api/prescriptions/${ids.rxB}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  console.log(`  GET /prescriptions/:id (other facility) → ${res.status}`);
  if (res.status === 200) {
    console.log(`  LEAKED: diagnosisNotes="${body?.diagnosisNotes}" patient=${body?.patient?.firstName} ${body?.patient?.lastName}`);
    console.log("  ⚠ F1 CONFIRMED — facility-bound user read another facility's prescription");
  } else {
    console.log("  F1 NOT reproduced");
  }

  console.log("\n── F2: cross-facility status change + audit ──");
  res = await fetch(`${baseUrl}/api/prescriptions/${ids.rxB}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "CANCELLED" }),
  });
  console.log(`  PATCH /prescriptions/:id/status (other facility) → ${res.status}`);
  const after = await prisma.prescription.findUnique({ where: { id: ids.rxB }, select: { status: true } });
  console.log(`  prescription at facility B now: ${after?.status}`);
  const audits = await prisma.auditLog.count({
    where: { entityType: "Prescription", entityId: ids.rxB },
  });
  console.log(`  audit entries for that prescription: ${audits}`);
  if (res.status === 200 && after?.status === "CANCELLED") {
    console.log(`  ⚠ F2 CONFIRMED — cross-facility cancel succeeded${audits === 0 ? ", with NO audit entry" : ""}`);
  } else {
    console.log("  F2 NOT reproduced");
  }

  console.log("\n── F4: multipart filename path traversal ──");
  // 1x1 PNG
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077" +
    "53de0000000c4944415408d763f8cfc0000000030001a5a9a8c50000000049454e44ae426082", "hex");
  const evilName = `..${path.sep}${SUFFIX}-escape.png`;
  const boundary = `----vrf${Date.now()}`;
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="../${SUFFIX}-escape.png"\r\n` +
      `content-type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  res = await fetch(`${baseUrl}/api/prescriptions/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: multipart,
  });
  console.log(`  POST /ocr with filename "../${SUFFIX}-escape.png" → ${res.status}`);
  // Where would it land? uploads/../  ==  backend root
  const escaped = fs.readdirSync(process.cwd()).filter((f) => f.includes(`${SUFFIX}-escape`));
  const inUploads = fs.existsSync(path.join(process.cwd(), "uploads"))
    ? fs.readdirSync(path.join(process.cwd(), "uploads")).filter((f) => f.includes(SUFFIX))
    : [];
  console.log(`  files escaped to backend root: ${JSON.stringify(escaped)}`);
  console.log(`  files inside uploads/: ${JSON.stringify(inUploads)}`);
  if (escaped.length > 0) {
    console.log("  ⚠ F4 CONFIRMED — uploaded file written OUTSIDE uploads/");
    for (const f of escaped) fs.unlinkSync(path.join(process.cwd(), f));
  } else {
    console.log("  F4 NOT reproduced (file stayed in uploads/ or was rejected)");
  }
  void evilName;
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { entityId: ids.rxB } });
  await prisma.prescription.deleteMany({ where: { facilityId: ids.facB } });
  await prisma.patient.deleteMany({ where: { facilityId: ids.facB } });
  await prisma.user.deleteMany({ where: { id: ids.userA } });
  await prisma.facility.deleteMany({ where: { id: { in: [ids.facA, ids.facB] } } });
}

(async () => {
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    await run();
  } catch (e) {
    console.error("UNCAUGHT:", e);
  } finally {
    try { await cleanup(); } catch (e) { console.error("cleanup error", e); }
    server.close();
    await prisma.$disconnect();
  }
})();
