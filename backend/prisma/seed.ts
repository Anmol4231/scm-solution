import {
  PrismaClient,
  UserRole,
  StockTransactionType,
  AlertType,
  AlertSeverity,
  TransferStatus,
  ReturnType,
  MedicineCondition,
  PrescriptionStatus,
  DispensingRecipientType,
  VendorOrderStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function addDays(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

async function clearDemoData() {
  await prisma.stockOrderLine.deleteMany();
  await prisma.stockOrder.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.expiredMedicineRecord.deleteMany();
  await prisma.medicineReturn.deleteMany();
  await prisma.dispensingRecord.deleteMany();
  await prisma.healthcareWorker.deleteMany();
  await prisma.consumptionReport.deleteMany();
  await prisma.stockTransaction.deleteMany();
  await prisma.transfer.deleteMany();
  await prisma.prescriptionMedicine.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.stockBatch.deleteMany();
  await prisma.patient.deleteMany();
}

async function main() {
  console.log("Resetting demo data...");
  await clearDemoData();

  const facilityDefs = [
    { code: "HC-001", name: "Goroka", province: "Eastern Highlands", district: "Goroka", phone: "+67553210001" },
    { code: "HC-002", name: "Mt Hagen", province: "Western Highlands", district: "Mt Hagen", phone: "+67554210002" },
    { code: "HC-003", name: "Lae", province: "Morobe", district: "Lae", phone: "+67547210003" },
    { code: "HC-004", name: "Port Moresby", province: "National Capital", district: "Port Moresby", phone: "+67532510004" },
    { code: "HC-005", name: "Kagamuga", province: "Western Highlands", district: "Kagamuga", phone: "+67554210005" },
    { code: "HC-006", name: "Pai", province: "Enga", district: "Wabag", phone: "+67554710006" },
  ];

  const facilities = await Promise.all(
    facilityDefs.map((f) =>
      prisma.facility.upsert({
        where: { code: f.code },
        update: { name: f.name, province: f.province, district: f.district, phone: f.phone },
        create: f,
      })
    )
  );

  const [hc1, hc2, hc3, hc4, hc5, hc6] = facilities;
  const passwordHash = await bcrypt.hash("password123", 10);

  const manager = await prisma.user.upsert({
    where: { email: "manager@scm.local" },
    update: { passwordHash },
    create: {
      email: "manager@scm.local",
      passwordHash,
      firstName: "Provincial",
      lastName: "Manager",
      role: UserRole.PROVINCIAL_MANAGER,
      phone: "+263771000000",
    },
  });

  const userDefs = [
    { email: "pharmacist@hc001.local", role: UserRole.PHARMACIST, facility: hc1, firstName: "Tariro", lastName: "Mhlanga" },
    { email: "storekeeper@hc001.local", role: UserRole.STOREKEEPER, facility: hc1, firstName: "Blessing", lastName: "Ndlovu" },
    { email: "nurse@hc001.local", role: UserRole.NURSE_ADMIN, facility: hc1, firstName: "Chipo", lastName: "Dube" },
    { email: "pharmacist@hc002.local", role: UserRole.PHARMACIST, facility: hc2, firstName: "Farai", lastName: "Gumbo" },
    { email: "storekeeper@hc002.local", role: UserRole.STOREKEEPER, facility: hc2, firstName: "Nyasha", lastName: "Mutasa" },
    { email: "pharmacist@hc003.local", role: UserRole.PHARMACIST, facility: hc3, firstName: "Ruvimbo", lastName: "Chuma" },
    { email: "pharmacist@hc004.local", role: UserRole.PHARMACIST, facility: hc4, firstName: "Michael", lastName: "Tau" },
    { email: "storekeeper@hc004.local", role: UserRole.STOREKEEPER, facility: hc4, firstName: "Lisa", lastName: "Kila" },
    { email: "pharmacist@hc005.local", role: UserRole.PHARMACIST, facility: hc5, firstName: "Steven", lastName: "Wai" },
    { email: "pharmacist@hc006.local", role: UserRole.PHARMACIST, facility: hc6, firstName: "Helen", lastName: "Pai" },
  ];

  const users: Record<string, { id: string }> = {};
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash, facilityId: u.facility.id },
      create: {
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        facilityId: u.facility.id,
        phone: u.facility.phone,
      },
    });
    users[u.email] = user;
  }

  const pharmacist1 = users["pharmacist@hc001.local"];
  const storekeeper1 = users["storekeeper@hc001.local"];
  const pharmacist2 = users["pharmacist@hc002.local"];
  const pharmacist3 = users["pharmacist@hc003.local"];
  const pharmacist4 = users["pharmacist@hc004.local"];
  const pharmacist5 = users["pharmacist@hc005.local"];
  const pharmacist6 = users["pharmacist@hc006.local"];

  const categoryDefs = [
    { name: "Antibiotics", description: "Antibacterial medicines", sortOrder: 1 },
    { name: "Analgesics", description: "Pain relief medicines", sortOrder: 2 },
    { name: "Antimalarials", description: "Malaria treatment and prevention", sortOrder: 3 },
    { name: "Vaccines", description: "Immunization commodities", sortOrder: 4 },
    { name: "Emergency Medicines", description: "Critical care and emergency stock", sortOrder: 5 },
    { name: "Pediatric Medicines", description: "Child health formulations", sortOrder: 6 },
    { name: "Chronic Disease Medicines", description: "NCD — diabetes, hypertension, etc.", sortOrder: 7 },
    { name: "IV Fluids", description: "Intravenous fluids and solutions", sortOrder: 8 },
    { name: "Surgical Supplies", description: "Surgical and procedural supplies", sortOrder: 9 },
    { name: "Controlled Medicines", description: "Regulated and controlled substances", sortOrder: 10 },
    { name: "GI & Rehydration", description: "ORS, diarrhoea treatment", sortOrder: 11 },
    { name: "Respiratory", description: "Asthma, cough, respiratory", sortOrder: 12 },
  ];

  const categories: Record<string, { id: string }> = {};
  for (const c of categoryDefs) {
    const cat = await prisma.medicineCategory.upsert({
      where: { name: c.name },
      update: { description: c.description, sortOrder: c.sortOrder },
      create: c,
    });
    categories[c.name] = cat;
  }

  const medicineDefs = [
    { medicineName: "Paracetamol 500mg", genericName: "Acetaminophen", dosageForm: "Tablet", strength: "500mg", unitType: "tablets", reorderThreshold: 200, category: "Analgesics", storageCondition: "Room temperature", emergencyStockFlag: false },
    { medicineName: "Amoxicillin 250mg", genericName: "Amoxicillin", dosageForm: "Capsule", strength: "250mg", unitType: "capsules", reorderThreshold: 100, category: "Antibiotics", storageCondition: "Cool dry place" },
    { medicineName: "Metformin 500mg", genericName: "Metformin", dosageForm: "Tablet", strength: "500mg", unitType: "tablets", reorderThreshold: 150, category: "Chronic Disease Medicines" },
    { medicineName: "ORS Sachets", genericName: "Oral Rehydration Salts", dosageForm: "Sachet", strength: "Standard", unitType: "sachets", reorderThreshold: 80, category: "GI & Rehydration" },
    { medicineName: "Zinc Sulphate 20mg", genericName: "Zinc", dosageForm: "Tablet", strength: "20mg", unitType: "tablets", reorderThreshold: 60, category: "Pediatric Medicines" },
    { medicineName: "Artemether/Lumefantrine", genericName: "Coartem", dosageForm: "Tablet", strength: "20/120mg", unitType: "tablets", reorderThreshold: 120, category: "Antimalarials" },
    { medicineName: "Ciprofloxacin 500mg", genericName: "Ciprofloxacin", dosageForm: "Tablet", strength: "500mg", unitType: "tablets", reorderThreshold: 80, category: "Antibiotics" },
    { medicineName: "Salbutamol Inhaler", genericName: "Salbutamol", dosageForm: "Inhaler", strength: "100mcg", unitType: "inhalers", reorderThreshold: 25, category: "Respiratory" },
    { medicineName: "Adrenaline 1mg/ml", genericName: "Epinephrine", dosageForm: "Injection", strength: "1mg/ml", unitType: "ampoules", reorderThreshold: 20, category: "Emergency Medicines", emergencyStockFlag: true, temperatureSensitive: true },
    { medicineName: "BCG Vaccine", genericName: "BCG", dosageForm: "Vial", strength: "0.05ml", unitType: "vials", reorderThreshold: 30, category: "Vaccines", temperatureSensitive: true },
    { medicineName: "Normal Saline 500ml", genericName: "Sodium Chloride", dosageForm: "IV Fluid", strength: "0.9%", unitType: "bags", reorderThreshold: 40, category: "IV Fluids" },
    { medicineName: "Ibuprofen 400mg", genericName: "Ibuprofen", dosageForm: "Tablet", strength: "400mg", unitType: "tablets", reorderThreshold: 100, category: "Analgesics" },
    { medicineName: "Amlodipine 5mg", genericName: "Amlodipine", dosageForm: "Tablet", strength: "5mg", unitType: "tablets", reorderThreshold: 80, category: "Chronic Disease Medicines" },
    { medicineName: "Gauze Bandage 10cm", genericName: "Gauze", dosageForm: "Supply", strength: "10cm", unitType: "rolls", reorderThreshold: 50, category: "Surgical Supplies" },
    { medicineName: "Morphine 10mg", genericName: "Morphine", dosageForm: "Injection", strength: "10mg", unitType: "ampoules", reorderThreshold: 10, category: "Controlled Medicines", emergencyStockFlag: true },
    { medicineName: "Amoxicillin Suspension", genericName: "Amoxicillin", dosageForm: "Suspension", strength: "250mg/5ml", unitType: "bottles", reorderThreshold: 40, category: "Pediatric Medicines" },
  ];

  const meds: Record<string, { id: string; medicineName: string }> = {};
  for (const m of medicineDefs) {
    const { category, ...medData } = m;
    const categoryId = categories[category].id;
    let med = await prisma.medicine.findFirst({ where: { medicineName: m.medicineName } });
    if (!med) med = await prisma.medicine.create({ data: { ...medData, categoryId } });
    else med = await prisma.medicine.update({ where: { id: med.id }, data: { ...medData, categoryId } });
    meds[m.medicineName] = med;
  }

  // --- Stock batches per facility ---
  type BatchDef = { med: string; batch: string; qty: number; expiryDays: number };
  const hc1Batches: BatchDef[] = [
    { med: "Paracetamol 500mg", batch: "BATCH-1001", qty: 45, expiryDays: 120 },
    { med: "Paracetamol 500mg", batch: "BATCH-1001B", qty: 320, expiryDays: 280 },
    { med: "Amoxicillin 250mg", batch: "BATCH-1002", qty: 380, expiryDays: 180 },
    { med: "Metformin 500mg", batch: "BATCH-1003", qty: 220, expiryDays: 240 },
    { med: "ORS Sachets", batch: "BATCH-1004", qty: 12, expiryDays: 90 },
    { med: "Zinc Sulphate 20mg", batch: "BATCH-CRIT-01", qty: 80, expiryDays: 18 },
    { med: "Artemether/Lumefantrine", batch: "BATCH-WARN-01", qty: 150, expiryDays: 55 },
    { med: "Ciprofloxacin 500mg", batch: "BATCH-1007", qty: 95, expiryDays: 200 },
    { med: "Salbutamol Inhaler", batch: "BATCH-1008", qty: 8, expiryDays: 365 },
    { med: "Adrenaline 1mg/ml", batch: "BATCH-EMRG-01", qty: 15, expiryDays: 200 },
    { med: "BCG Vaccine", batch: "BATCH-VAC-01", qty: 25, expiryDays: 45 },
    { med: "Normal Saline 500ml", batch: "BATCH-IV-01", qty: 60, expiryDays: 300 },
    { med: "Ibuprofen 400mg", batch: "BATCH-EXPIRED-01", qty: 40, expiryDays: -10 },
    { med: "Morphine 10mg", batch: "BATCH-CTRL-01", qty: 8, expiryDays: 150 },
    { med: "Amoxicillin Suspension", batch: "BATCH-PED-01", qty: 22, expiryDays: 25 },
  ];

  const hc2Batches: BatchDef[] = [
    { med: "Paracetamol 500mg", batch: "BATCH-2001", qty: 310, expiryDays: 150 },
    { med: "Amoxicillin 250mg", batch: "BATCH-2002", qty: 0, expiryDays: 90 },
    { med: "Metformin 500mg", batch: "BATCH-2003", qty: 25, expiryDays: 60 },
    { med: "ORS Sachets", batch: "BATCH-2004", qty: 200, expiryDays: 300 },
    { med: "Artemether/Lumefantrine", batch: "BATCH-NEAR-02", qty: 200, expiryDays: 42 },
    { med: "Amlodipine 5mg", batch: "BATCH-2005", qty: 18, expiryDays: 75 },
    { med: "Gauze Bandage 10cm", batch: "BATCH-2006", qty: 120, expiryDays: 500 },
    { med: "Ibuprofen 400mg", batch: "BATCH-2007-EXP", qty: 55, expiryDays: -5 },
    { med: "Adrenaline 1mg/ml", batch: "BATCH-2008", qty: 5, expiryDays: 22 },
  ];

  const hc3Batches: BatchDef[] = [
    { med: "Paracetamol 500mg", batch: "BATCH-3001", qty: 180, expiryDays: 200 },
    { med: "Zinc Sulphate 20mg", batch: "BATCH-3002", qty: 40, expiryDays: 90 },
    { med: "Ciprofloxacin 500mg", batch: "BATCH-SURPLUS", qty: 320, expiryDays: 38 },
    { med: "Normal Saline 500ml", batch: "BATCH-3003", qty: 90, expiryDays: 120 },
    { med: "BCG Vaccine", batch: "BATCH-3004-CRIT", qty: 12, expiryDays: 20 },
    { med: "Morphine 10mg", batch: "BATCH-3005", qty: 6, expiryDays: 85 },
    { med: "Amoxicillin Suspension", batch: "BATCH-3006", qty: 35, expiryDays: 65 },
  ];

  async function createBatches(facilityId: string, defs: BatchDef[]) {
    const created = [];
    for (const d of defs) {
      const medicine = meds[d.med];
      const batch = await prisma.stockBatch.create({
        data: {
          medicineId: medicine.id,
          facilityId,
          batchNumber: d.batch,
          expiryDate: addDays(d.expiryDays),
          quantity: d.qty,
        },
      });
      created.push({ ...batch, medicineName: d.med });
    }
    return created;
  }

  const hc4Batches: BatchDef[] = [
    { med: "Paracetamol 500mg", batch: "BATCH-4001", qty: 210, expiryDays: 160 },
    { med: "Amoxicillin 250mg", batch: "BATCH-4002", qty: 140, expiryDays: 120 },
    { med: "ORS Sachets", batch: "BATCH-4003", qty: 95, expiryDays: 200 },
    { med: "Normal Saline 500ml", batch: "BATCH-4004", qty: 45, expiryDays: 90 },
  ];
  const hc5Batches: BatchDef[] = [
    { med: "Metformin 500mg", batch: "BATCH-5001", qty: 88, expiryDays: 180 },
    { med: "Artemether/Lumefantrine", batch: "BATCH-5002", qty: 65, expiryDays: 48 },
    { med: "Ibuprofen 400mg", batch: "BATCH-5003", qty: 30, expiryDays: 70 },
  ];
  const hc6Batches: BatchDef[] = [
    { med: "Zinc Sulphate 20mg", batch: "BATCH-6001", qty: 55, expiryDays: 100 },
    { med: "Salbutamol Inhaler", batch: "BATCH-6002", qty: 12, expiryDays: 300 },
    { med: "Gauze Bandage 10cm", batch: "BATCH-6003", qty: 75, expiryDays: 400 },
  ];

  const batches1 = await createBatches(hc1.id, hc1Batches);
  const batches2 = await createBatches(hc2.id, hc2Batches);
  await createBatches(hc3.id, hc3Batches);
  await createBatches(hc4.id, hc4Batches);
  await createBatches(hc5.id, hc5Batches);
  await createBatches(hc6.id, hc6Batches);

  // Stock transactions (receipts, adjustments)
  const parBatch = batches1.find((b) => b.medicineName === "Paracetamol 500mg")!;
  await prisma.stockTransaction.create({
    data: {
      facilityId: hc1.id,
      medicineId: meds["Paracetamol 500mg"].id,
      batchId: parBatch.id,
      type: StockTransactionType.RECEIPT,
      quantity: 500,
      requestedQty: 600,
      receivedQty: 500,
      shortfallFlag: true,
      shortfallPercent: 16.67,
      balanceAfter: 45,
      performedById: storekeeper1.id,
      notes: "Medical stores issue voucher #MS-4421",
    },
  });

  await prisma.stockTransaction.create({
    data: {
      facilityId: hc1.id,
      medicineId: meds["Salbutamol Inhaler"].id,
      type: StockTransactionType.ADJUSTMENT,
      quantity: -2,
      balanceAfter: 8,
      reason: "Physical count discrepancy — 2 inhalers unaccounted",
      performedById: storekeeper1.id,
    },
  });

  await prisma.consumptionReport.createMany({
    data: [
      { facilityId: hc1.id, medicineId: meds["ORS Sachets"].id, quantityUsed: 45, reportingPeriod: "2026-04" },
      { facilityId: hc1.id, medicineId: meds["Paracetamol 500mg"].id, quantityUsed: 120, reportingPeriod: "2026-04" },
      { facilityId: hc2.id, medicineId: meds["Metformin 500mg"].id, quantityUsed: 80, reportingPeriod: "2026-03" },
    ],
  });

  // Patients
  const patientDefs = [
    { patientId: "PAT-26-00001", firstName: "Grace", lastName: "Moyo", gender: "Female", age: 34, phoneNumber: "+263771100001", facilityId: hc1.id },
    { patientId: "PAT-26-00002", firstName: "Tendai", lastName: "Chikwanha", gender: "Male", age: 45, phoneNumber: "+263771100002", facilityId: hc1.id },
    { patientId: "PAT-26-00003", firstName: "Rudo", lastName: "Sibanda", gender: "Female", age: 28, phoneNumber: "+263771100003", facilityId: hc1.id },
    { patientId: "PAT-26-00004", firstName: "John", lastName: "Mazuru", gender: "Male", age: 62, phoneNumber: "+263771100004", facilityId: hc1.id },
    { patientId: "PAT-26-00005", firstName: "Esnath", lastName: "Mpofu", gender: "Female", age: 8, phoneNumber: "+263771100005", facilityId: hc2.id },
    { patientId: "PAT-26-00006", firstName: "Simbarashe", lastName: "Nkomo", gender: "Male", age: 19, phoneNumber: "+263771100006", facilityId: hc2.id },
    { patientId: "PAT-26-00007", firstName: "Patience", lastName: "Mlambo", gender: "Female", age: 51, phoneNumber: "+263771100007", facilityId: hc3.id },
    { patientId: "PAT-26-00008", firstName: "James", lastName: "Tau", gender: "Male", age: 40, phoneNumber: "+67571000008", facilityId: hc4.id },
    { patientId: "PAT-26-00009", firstName: "Maria", lastName: "Kila", gender: "Female", age: 33, phoneNumber: "+67571000009", facilityId: hc5.id },
    { patientId: "PAT-26-00010", firstName: "Peter", lastName: "Pai", gender: "Male", age: 55, phoneNumber: "+67571000010", facilityId: hc6.id },
  ];

  const patients: Record<string, { id: string }> = {};
  for (const p of patientDefs) {
    const patient = await prisma.patient.create({ data: p });
    patients[p.patientId] = patient;
  }

  const grace = patients["PAT-26-00001"];
  const tendai = patients["PAT-26-00002"];
  const esnath = patients["PAT-26-00005"];

  // Healthcare workers
  const workerDefs = [
    { workerId: "HW-HC1-001", firstName: "Rudo", lastName: "Moyo", department: "Maternity", role: "Nurse", facilityId: hc1.id },
    { workerId: "HW-HC1-002", firstName: "Tinashe", lastName: "Dube", department: "OPD", role: "Doctor", facilityId: hc1.id },
    { workerId: "HW-HC1-003", firstName: "Patience", lastName: "Ncube", department: "Laboratory", role: "Lab Technician", facilityId: hc1.id },
    { workerId: "HW-HC1-004", firstName: "Farai", lastName: "Gumbo", department: "Pharmacy", role: "Pharmacist", facilityId: hc1.id },
    { workerId: "HW-HC1-005", firstName: "Esnath", lastName: "Mpofu", department: "Community Outreach", role: "Community Health Worker", facilityId: hc1.id },
    { workerId: "HW-HC2-001", firstName: "Nyasha", lastName: "Mutasa", department: "Emergency", role: "Nurse", facilityId: hc2.id },
    { workerId: "HW-HC2-002", firstName: "Simbarashe", lastName: "Chuma", department: "OPD", role: "Doctor", facilityId: hc2.id },
    { workerId: "HW-HC3-001", firstName: "Ruvimbo", lastName: "Sibanda", department: "Pediatrics", role: "Nurse", facilityId: hc3.id },
    { workerId: "HW-HC4-001", firstName: "Andrew", lastName: "Moresby", department: "Emergency", role: "Doctor", facilityId: hc4.id },
    { workerId: "HW-HC5-001", firstName: "Karen", lastName: "Kagamuga", department: "OPD", role: "Nurse", facilityId: hc5.id },
    { workerId: "HW-HC6-001", firstName: "William", lastName: "Enga", department: "Laboratory", role: "Lab Technician", facilityId: hc6.id },
  ];
  const workers: Record<string, { id: string }> = {};
  for (const w of workerDefs) {
    const worker = await prisma.healthcareWorker.create({ data: w });
    workers[w.workerId] = worker;
  }

  // Prescriptions
  const rx1 = await prisma.prescription.create({
    data: {
      prescriptionId: "RX-26-00001",
      patientId: grace.id,
      facilityId: hc1.id,
      doctorName: "Dr. Ncube",
      department: "General OPD",
      diagnosisNotes: "Mild fever and headache",
      symptoms: "Fever 38.2°C, headache, body aches",
      followUpDate: addDays(7),
      allergies: "None known",
      prescriptionNotes: "Rest and adequate fluids",
      priority: "ROUTINE",
      status: PrescriptionStatus.ACTIVE,
      medicines: {
        create: [
          { medicineId: meds["Paracetamol 500mg"].id, dosage: "500mg", form: "Tablet", quantity: 20, duration: "5 days" },
          { medicineId: meds["ORS Sachets"].id, dosage: "1 sachet", form: "Sachet", quantity: 6, duration: "3 days" },
        ],
      },
    },
  });

  const rx2 = await prisma.prescription.create({
    data: {
      prescriptionId: "RX-26-00002",
      patientId: tendai.id,
      facilityId: hc1.id,
      doctorName: "Dr. Moyo",
      department: "NCD Clinic",
      diagnosisNotes: "Type 2 diabetes — continuing treatment",
      symptoms: "Polyuria, routine follow-up",
      priority: "ROUTINE",
      status: PrescriptionStatus.ACTIVE,
      medicines: {
        create: [{ medicineId: meds["Metformin 500mg"].id, dosage: "500mg", form: "Tablet", quantity: 60, duration: "30 days" }],
      },
    },
  });

  await prisma.prescription.create({
    data: {
      prescriptionId: "RX-26-00003",
      patientId: esnath.id,
      facilityId: hc2.id,
      doctorName: "Dr. Chuma",
      department: "Emergency",
      diagnosisNotes: "Suspected malaria",
      symptoms: "Fever, chills, positive RDT",
      priority: "URGENT",
      status: PrescriptionStatus.COMPLETED,
      medicines: {
        create: [{ medicineId: meds["Artemether/Lumefantrine"].id, dosage: "20/120mg", form: "Tablet", quantity: 24, duration: "3 days" }],
      },
    },
  });

  const today = new Date();
  const zincBatch = batches1.find((b) => b.medicineName === "Zinc Sulphate 20mg")!;

  // Dispensing (today + historical)
  await prisma.dispensingRecord.createMany({
    data: [
      {
        facilityId: hc1.id,
        patientId: grace.id,
        prescriptionId: rx1.id,
        medicineId: meds["Paracetamol 500mg"].id,
        batchId: parBatch.id,
        batchNumber: parBatch.batchNumber,
        expiryDate: parBatch.expiryDate,
        dosage: "500mg",
        form: "Tablet",
        quantity: 10,
        duration: "5 days",
        dispensedById: pharmacist1.id,
        dispensedAt: today,
      },
      {
        facilityId: hc1.id,
        patientId: grace.id,
        prescriptionId: rx1.id,
        medicineId: meds["ORS Sachets"].id,
        batchId: batches1.find((b) => b.medicineName === "ORS Sachets")!.id,
        batchNumber: "BATCH-1004",
        expiryDate: addDays(90),
        dosage: "1 sachet",
        form: "Sachet",
        quantity: 6,
        duration: "3 days",
        dispensedById: pharmacist1.id,
        dispensedAt: today,
      },
      {
        facilityId: hc1.id,
        patientId: tendai.id,
        prescriptionId: rx2.id,
        medicineId: meds["Metformin 500mg"].id,
        batchId: batches1.find((b) => b.medicineName === "Metformin 500mg")!.id,
        batchNumber: "BATCH-1003",
        expiryDate: addDays(240),
        dosage: "500mg",
        form: "Tablet",
        quantity: 30,
        duration: "30 days",
        dispensedById: pharmacist1.id,
        dispensedAt: today,
      },
      {
        facilityId: hc1.id,
        patientId: patients["PAT-26-00003"].id,
        medicineId: meds["Zinc Sulphate 20mg"].id,
        batchId: zincBatch.id,
        batchNumber: zincBatch.batchNumber,
        expiryDate: zincBatch.expiryDate,
        dosage: "20mg",
        form: "Tablet",
        quantity: 14,
        duration: "14 days",
        dispensedById: pharmacist1.id,
        dispensedAt: addDays(-3),
      },
      {
        facilityId: hc1.id,
        recipientType: DispensingRecipientType.HEALTHCARE_WORKER,
        healthcareWorkerId: workers["HW-HC1-001"].id,
        medicineId: meds["Paracetamol 500mg"].id,
        batchId: parBatch.id,
        batchNumber: parBatch.batchNumber,
        expiryDate: parBatch.expiryDate,
        dosage: "500mg",
        form: "Tablet",
        quantity: 20,
        dispensingPurpose: "Staff prophylaxis kit — night shift",
        prescribingDepartment: "Maternity",
        dispensedById: pharmacist1.id,
        dispensedAt: today,
      },
      {
        facilityId: hc1.id,
        recipientType: DispensingRecipientType.HEALTHCARE_WORKER,
        healthcareWorkerId: workers["HW-HC1-003"].id,
        medicineId: meds["Ibuprofen 400mg"].id,
        batchId: batches1.find((b) => b.medicineName === "Ibuprofen 400mg")!.id,
        batchNumber: "BATCH-EXPIRED-01",
        expiryDate: addDays(-10),
        dosage: "400mg",
        form: "Tablet",
        quantity: 10,
        dispensingPurpose: "Lab staff internal use",
        prescribingDepartment: "Laboratory",
        dispensedById: pharmacist1.id,
        dispensedAt: addDays(-1),
      },
    ],
  });

  // Transfers
  const surplusBatch = await prisma.stockBatch.findFirst({
    where: { facilityId: hc3.id, batchNumber: "BATCH-SURPLUS" },
  });

  const pendingTransfer = await prisma.transfer.create({
    data: {
      transferCode: "TRF-DEMO01",
      fromFacilityId: hc1.id,
      toFacilityId: hc2.id,
      medicineId: meds["Artemether/Lumefantrine"].id,
      batchId: batches1.find((b) => b.medicineName === "Artemether/Lumefantrine")!.id,
      batchNumber: "BATCH-WARN-01",
      expiryDate: addDays(55),
      quantity: 50,
      status: TransferStatus.PENDING,
      authorizationNotes: "Near-expiry redistribution to Mt Hagen",
      createdById: manager.id,
    },
  });

  const artBatch = batches1.find((b) => b.medicineName === "Artemether/Lumefantrine")!;
  await prisma.stockBatch.update({
    where: { id: artBatch.id },
    data: { quantity: { decrement: 50 } },
  });
  await prisma.stockTransaction.create({
    data: {
      facilityId: hc1.id,
      medicineId: meds["Artemether/Lumefantrine"].id,
      batchId: artBatch.id,
      type: StockTransactionType.TRANSFER_OUT,
      quantity: -50,
      transferId: pendingTransfer.id,
      performedById: manager.id,
    },
  });

  await prisma.transfer.create({
    data: {
      transferCode: "TRF-DEMO02",
      fromFacilityId: hc2.id,
      toFacilityId: hc3.id,
      medicineId: meds["ORS Sachets"].id,
      batchId: batches2.find((b) => b.medicineName === "ORS Sachets")!.id,
      batchNumber: "BATCH-2004",
      expiryDate: addDays(300),
      quantity: 40,
      quantityReceived: 40,
      status: TransferStatus.RECEIVED,
      receivedById: pharmacist3.id,
      receivedAt: addDays(-2),
      createdById: pharmacist2.id,
    },
  });

  if (surplusBatch) {
    await prisma.transfer.create({
      data: {
        transferCode: "TRF-DEMO03",
        fromFacilityId: hc3.id,
        toFacilityId: hc1.id,
        medicineId: meds["Ciprofloxacin 500mg"].id,
        batchId: surplusBatch.id,
        batchNumber: surplusBatch.batchNumber,
        expiryDate: surplusBatch.expiryDate,
        quantity: 100,
        status: TransferStatus.PENDING,
        authorizationNotes: "Surplus near-expiry — provincial recommendation",
        createdById: manager.id,
      },
    });
  }

  // Returns
  await prisma.medicineReturn.create({
    data: {
      returnType: ReturnType.PATIENT_RETURN,
      facilityId: hc1.id,
      medicineId: meds["Paracetamol 500mg"].id,
      patientId: grace.id,
      batchNumber: "BATCH-1001",
      quantity: 5,
      condition: MedicineCondition.UNOPENED,
      returnReason: "No longer needed",
      reusable: true,
      stockAdjusted: true,
      processedById: pharmacist1.id,
    },
  });

  await prisma.medicineReturn.create({
    data: {
      returnType: ReturnType.FACILITY_TO_AMS,
      facilityId: hc1.id,
      medicineId: meds["Zinc Sulphate 20mg"].id,
      batchNumber: "BATCH-CRIT-01",
      expiryDate: addDays(18),
      quantity: 20,
      returnReason: "Near expiry",
      returnDestination: "AMS Central Store",
      reusable: true,
      stockAdjusted: true,
      processedById: storekeeper1.id,
    },
  });

  // Expired medicine record
  await prisma.expiredMedicineRecord.create({
    data: {
      facilityId: hc2.id,
      medicineId: meds["Amoxicillin 250mg"].id,
      batchNumber: "BATCH-EXPIRED-99",
      expiryDate: addDays(-14),
      quantity: 30,
      disposalMethod: "Incineration at district hospital",
      processedById: pharmacist2.id,
    },
  });

  // Alerts
  await prisma.alert.createMany({
    data: [
      {
        facilityId: hc1.id,
        type: AlertType.LOW_STOCK,
        severity: AlertSeverity.WARNING,
        title: "Low stock: Paracetamol 500mg",
        message: "Balance (45) is below reorder threshold (200).",
        medicineId: meds["Paracetamol 500mg"].id,
      },
      {
        facilityId: hc1.id,
        type: AlertType.LOW_STOCK,
        severity: AlertSeverity.WARNING,
        title: "Low stock: ORS Sachets",
        message: "Balance (12) is below reorder threshold (80).",
        medicineId: meds["ORS Sachets"].id,
      },
      {
        facilityId: hc1.id,
        type: AlertType.LOW_STOCK,
        severity: AlertSeverity.WARNING,
        title: "Low stock: Salbutamol Inhaler",
        message: "Balance (8) is below reorder threshold (25).",
        medicineId: meds["Salbutamol Inhaler"].id,
      },
      {
        facilityId: hc1.id,
        type: AlertType.EXPIRY_CRITICAL,
        severity: AlertSeverity.CRITICAL,
        title: "Critical expiry: Zinc Sulphate 20mg",
        message: "Batch BATCH-CRIT-01 expires in 18 days.",
        medicineId: meds["Zinc Sulphate 20mg"].id,
      },
      {
        facilityId: hc1.id,
        type: AlertType.EXPIRY_WARNING,
        severity: AlertSeverity.WARNING,
        title: "Near expiry: Artemether/Lumefantrine",
        message: "Batch BATCH-WARN-01 expires in 55 days.",
        medicineId: meds["Artemether/Lumefantrine"].id,
      },
      {
        facilityId: hc2.id,
        type: AlertType.STOCKOUT,
        severity: AlertSeverity.CRITICAL,
        title: "Stockout: Amoxicillin 250mg",
        message: "Amoxicillin 250mg is out of stock at Mt Hagen.",
        medicineId: meds["Amoxicillin 250mg"].id,
      },
      {
        facilityId: hc2.id,
        type: AlertType.LOW_STOCK,
        severity: AlertSeverity.WARNING,
        title: "Low stock: Metformin 500mg",
        message: "Balance (25) is below reorder threshold (150).",
        medicineId: meds["Metformin 500mg"].id,
      },
      {
        facilityId: hc2.id,
        type: AlertType.TRANSFER_PENDING,
        severity: AlertSeverity.INFO,
        title: "Incoming transfer TRF-DEMO01",
        message: "50 units Artemether/Lumefantrine from Goroka",
      },
      {
        facilityId: hc3.id,
        type: AlertType.EXPIRY_WARNING,
        severity: AlertSeverity.WARNING,
        title: "Near expiry: Ciprofloxacin 500mg",
        message: "Batch BATCH-SURPLUS expires in 38 days — redistribution recommended.",
        medicineId: meds["Ciprofloxacin 500mg"].id,
      },
      {
        facilityId: hc3.id,
        type: AlertType.NON_REPORTING,
        severity: AlertSeverity.WARNING,
        title: "Consumption report overdue",
        message: "No consumption report submitted in the last 7+ days.",
      },
      {
        facilityId: hc1.id,
        type: AlertType.SHORTFALL,
        severity: AlertSeverity.WARNING,
        title: "Stock receipt shortfall",
        message: "Paracetamol receipt: 500 received vs 600 requested.",
        medicineId: meds["Paracetamol 500mg"].id,
      },
    ],
  });

  const vendorDefs = [
    { code: "VND-AMS", name: "PNG National Medical Stores", contactName: "Procurement Desk", phone: "+67532501001", email: "orders@pnmstores.pg" },
    { code: "VND-HGL", name: "Highlands Pharma Distributors", contactName: "James Kila", phone: "+67554202002", email: "supply@highlandspharma.pg" },
    { code: "VND-MRB", name: "Morobe Health Logistics", contactName: "Sarah Wai", phone: "+67547203003", email: "logistics@morobehealth.pg" },
    { code: "VND-PMC", name: "Port Moresby Medical Supplies", contactName: "Michael Tau", phone: "+67532504004", email: "orders@pmcsupplies.pg" },
  ];
  const vendors: Record<string, { id: string }> = {};
  for (const v of vendorDefs) {
    const vendor = await prisma.vendor.upsert({
      where: { code: v.code },
      update: { name: v.name, contactName: v.contactName, phone: v.phone, email: v.email },
      create: v,
    });
    vendors[v.code] = vendor;
  }

  await prisma.stockOrder.create({
    data: {
      orderCode: "ORD-26-00001",
      facilityId: hc1.id,
      vendorId: vendors["VND-AMS"].id,
      status: VendorOrderStatus.CONFIRMED,
      priority: "URGENT",
      expectedDeliveryDate: addDays(14),
      notes: "Replenish low-stock analgesics and ORS",
      orderedById: storekeeper1.id,
      lines: {
        create: [
          { medicineId: meds["Paracetamol 500mg"].id, quantityOrdered: 500, unitCost: 0.12 },
          { medicineId: meds["ORS Sachets"].id, quantityOrdered: 200, unitCost: 0.45 },
        ],
      },
    },
  });

  await prisma.stockOrder.create({
    data: {
      orderCode: "ORD-26-00002",
      facilityId: hc2.id,
      vendorId: vendors["VND-HGL"].id,
      status: VendorOrderStatus.SUBMITTED,
      priority: "ROUTINE",
      expectedDeliveryDate: addDays(21),
      notes: "Restock antibiotics after stockout",
      orderedById: pharmacist2.id,
      lines: {
        create: [
          { medicineId: meds["Amoxicillin 250mg"].id, quantityOrdered: 300, unitCost: 0.28 },
          { medicineId: meds["Metformin 500mg"].id, quantityOrdered: 150, unitCost: 0.15 },
        ],
      },
    },
  });

  await prisma.auditLog.createMany({
    data: [
      { facilityId: hc1.id, userId: pharmacist1.id, action: "DISPENSE", entityType: "DispensingRecord", details: { note: "Demo dispensing" } },
      { facilityId: hc1.id, userId: storekeeper1.id, action: "STOCK_RECEIPT", entityType: "StockBatch", details: { note: "Demo receipt" } },
      { facilityId: hc2.id, userId: pharmacist2.id, action: "EXPIRED_MEDICINE", entityType: "ExpiredMedicine", details: { note: "Demo disposal" } },
    ],
  });

  console.log("\n✅ Demo data loaded successfully!\n");
  console.log("Logins (password: password123):");
  console.log("  manager@scm.local           — Provincial Manager");
  console.log("  pharmacist@hc001.local    — Goroka (low stock, expiry, transfers)");
  console.log("  storekeeper@hc001.local   — Goroka (stock receipt)");
  console.log("  nurse@hc001.local         — Goroka");
  console.log("  pharmacist@hc002.local    — Mt Hagen (stockout, incoming transfer)");
  console.log("  pharmacist@hc003.local    — Lae (non-reporting, surplus expiry)");
  console.log("  pharmacist@hc004.local    — Port Moresby");
  console.log("  pharmacist@hc005.local    — Kagamuga");
  console.log("  pharmacist@hc006.local    — Pai");
  console.log("\nDemo transfer code to receive: TRF-DEMO01");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
