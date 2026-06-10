/**
 * End-to-end OCR verification — the FULL pipeline, not just the parser:
 * generated prescription PNGs → POST /api/prescriptions/ocr → tesseract.js →
 * structural parse → Medicine Master fuzzy match → assertions.
 *
 * Fixtures: scripts/ocr-fixtures/*.png (created by the audit; see git history).
 * Run: npx tsx scripts/e2e-ocr-dispense.ts
 */
import http from "http";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/utils/config";

const SUFFIX = `OCR${Date.now().toString().slice(-7)}`;
const FIXTURES = path.join(__dirname, "ocr-fixtures");
let server: http.Server;
let baseUrl = "";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ FAIL: ${label}`); }
}

const ids = { facility: "", category: "", user: "" };
const createdMedicineIds: string[] = [];
const med: Record<string, string> = {}; // name → id

/**
 * Find-or-create a master medicine (names are globally unique). Reuses a
 * near-identical existing entry first so the test does not plant catalogue
 * duplicates ("ORS Sachet" vs the real "ORS Sachets") that would make every
 * match legitimately ambiguous.
 */
async function ensureMedicine(name: string, genericName?: string, strengths?: string[]) {
  let m = await prisma.medicine.findUnique({ where: { medicineName: name } });
  if (!m) {
    m = await prisma.medicine.findFirst({
      where: { medicineName: { startsWith: name, mode: "insensitive" }, isActive: true, deletedAt: null },
    });
  }
  if (!m) {
    m = await prisma.medicine.create({
      data: {
        medicineName: name,
        genericName,
        categoryId: ids.category,
        strengths: strengths ? { create: strengths.map((s, i) => ({ strength: s, sortOrder: i })) } : undefined,
      },
    });
    createdMedicineIds.push(m.id);
  }
  med[name] = m.id;
}

async function setup() {
  const fac = await prisma.facility.create({ data: { name: `${SUFFIX} Clinic`, code: `${SUFFIX}-A` } });
  ids.facility = fac.id;
  const cat = await prisma.medicineCategory.create({ data: { name: `${SUFFIX} Cat` } });
  ids.category = cat.id;

  await ensureMedicine("Paracetamol 500mg", "Paracetamol", ["500mg"]);
  await ensureMedicine("Paracetamol 650mg", "Paracetamol", ["650mg"]);
  await ensureMedicine("Amoxicillin 250mg", "Amoxicillin", ["250mg"]);
  await ensureMedicine("ORS Sachet", "Oral Rehydration Salts");

  const user = await prisma.user.create({
    data: {
      email: `${SUFFIX.toLowerCase()}@test.local`, passwordHash: "x",
      firstName: "OCR", lastName: "Tester", role: "SUPER_ADMIN", facilityId: fac.id,
    },
  });
  ids.user = user.id;
  return jwt.sign({ userId: user.id, email: user.email, role: "SUPER_ADMIN", facilityId: fac.id }, config.jwtSecret);
}

interface OcrMed {
  medicineName: string; strength: string | null; quantity: number | null;
  medicineId: string | null; matchedName: string | null; matchConfidence: number;
  candidates: { id: string; medicineName: string }[];
}
interface OcrResp {
  rawText: string; confidence: number; doctorName: string | null; diagnosisNotes: string | null;
  medicines: OcrMed[]; fieldsDetected: string[]; warnings: string[]; error?: string;
}

async function runOcr(file: string, token: string): Promise<OcrResp> {
  const buf = fs.readFileSync(path.join(FIXTURES, file));
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "image/png" }), file);
  const res = await fetch(`${baseUrl}/api/prescriptions/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return (await res.json()) as OcrResp;
}

const findLine = (r: OcrResp, medicineId: string) => r.medicines.find((m) => m.medicineId === medicineId);

async function run() {
  const token = await setup();

  console.log("\n── Case 1: clean typed prescription ──");
  let r = await runOcr("case1-clean-typed.png", token);
  ok(/sharma/i.test(r.doctorName ?? ""), `doctor "Sharma" extracted (got "${r.doctorName}")`);
  ok(/fever/i.test(r.diagnosisNotes ?? ""), `diagnosis "Fever" extracted (got "${r.diagnosisNotes}")`);
  let line = findLine(r, med["Paracetamol 500mg"]);
  ok(!!line, `Paracetamol 500mg auto-matched (lines: ${r.medicines.map((m) => `${m.medicineName}→${m.matchedName}`).join("; ")})`);
  ok(line?.quantity === 5, `quantity 5 extracted (got ${line?.quantity})`);

  console.log("\n── Case 2: multiple medicines ──");
  r = await runOcr("case2-multi-meds.png", token);
  ok(/john/i.test(r.doctorName ?? ""), `doctor "John" extracted (got "${r.doctorName}")`);
  ok(/infection/i.test(r.diagnosisNotes ?? ""), `diagnosis "Infection" extracted (got "${r.diagnosisNotes}")`);
  const amox = findLine(r, med["Amoxicillin 250mg"]);
  const para = findLine(r, med["Paracetamol 500mg"]);
  const ors = findLine(r, med["ORS Sachet"]);
  ok(!!amox && amox.quantity === 10, `Amoxicillin 250mg qty 10 (got ${amox?.quantity})`);
  ok(!!para && para.quantity === 6, `Paracetamol 500mg qty 6 (got ${para?.quantity})`);
  ok(!!ors && ors.quantity === 2, `ORS qty 2 (got ${ors?.quantity})`);

  console.log("\n── Case 3: missing diagnosis ──");
  r = await runOcr("case3-no-diagnosis.png", token);
  ok(/smith/i.test(r.doctorName ?? ""), `doctor "Smith" extracted (got "${r.doctorName}")`);
  ok(!r.diagnosisNotes, `no diagnosis hallucinated (got "${r.diagnosisNotes}")`);
  // "Paracetamol" without a strength must NOT silently pick 500mg vs 650mg —
  // it must surface both as candidates for pharmacist confirmation.
  const ambig = r.medicines.find((m) => /paracet/i.test(m.medicineName));
  ok(!!ambig && ambig.quantity === 3, `Paracetamol qty 3 extracted (got ${ambig?.quantity})`);
  const candNames = (ambig?.candidates ?? []).map((c) => c.medicineName);
  ok(
    !!ambig && ambig.medicineId === null && candNames.includes("Paracetamol 500mg") && candNames.includes("Paracetamol 650mg"),
    `strength-ambiguous match offers both 500mg and 650mg (got auto=${ambig?.matchedName}, candidates=${candNames.join("|")})`
  );

  console.log("\n── Case 4: medicine typo (Paracetmol) ──");
  r = await runOcr("case4-medicine-typo.png", token);
  line = findLine(r, med["Paracetamol 500mg"]);
  ok(!!line, `typo "Paracetmol 500mg" resolved to Paracetamol 500mg (lines: ${r.medicines.map((m) => `${m.medicineName}→${m.matchedName}`).join("; ")})`);
  ok(line?.quantity === 5, `quantity 5 extracted (got ${line?.quantity})`);

  console.log("\n── Case 5: strength typo (50Omg, letter O) ──");
  r = await runOcr("case5-strength-typo.png", token);
  line = findLine(r, med["Paracetamol 500mg"]);
  ok(!!line, `"50Omg" normalized to 500mg and matched (lines: ${r.medicines.map((m) => `${m.medicineName} s=${m.strength}→${m.matchedName}`).join("; ")})`);
  ok(line?.quantity === 5, `quantity 5 extracted (got ${line?.quantity})`);

  console.log("\n── Case 6: mixed formatting (Rx: / PCM 500 / Qty 5) ──");
  r = await runOcr("case6-mixed-pcm.png", token);
  line = findLine(r, med["Paracetamol 500mg"]);
  ok(!!line, `abbreviation "PCM 500" resolved to Paracetamol 500mg (lines: ${r.medicines.map((m) => `${m.medicineName} s=${m.strength}→${m.matchedName}`).join("; ")})`);
  ok(line?.quantity === 5, `quantity 5 attached from following line (got ${line?.quantity})`);

  console.log("\n── Case 7: OCR noise (split name/strength/qty lines) ──");
  r = await runOcr("case7-ocr-noise.png", token);
  line = findLine(r, med["Paracetamol 500mg"]);
  ok(!!line, `split "Paraceta mol"+"500 mg" resolved to Paracetamol 500mg (lines: ${r.medicines.map((m) => `${m.medicineName} s=${m.strength}→${m.matchedName}`).join("; ")})`);
  ok(line?.quantity === 5, `"QTY:5" attached (got ${line?.quantity})`);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
  if (createdMedicineIds.length) {
    await prisma.medicineStrength.deleteMany({ where: { medicineId: { in: createdMedicineIds } } });
    await prisma.medicine.deleteMany({ where: { id: { in: createdMedicineIds } } });
  }
  if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  if (ids.category) await prisma.medicineCategory.deleteMany({ where: { id: ids.category } });
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
  console.log(`OCR E2E RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(fail ? 1 : 0);
})();
