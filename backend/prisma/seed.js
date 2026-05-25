"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log("Seeding MedFlow database...");
    const facilities = await Promise.all([
        prisma.facility.upsert({
            where: { code: "HC-001" },
            update: {},
            create: { name: "Riverside Health Centre", code: "HC-001", province: "Eastern", district: "Valley", phone: "+263771000001" },
        }),
        prisma.facility.upsert({
            where: { code: "HC-002" },
            update: {},
            create: { name: "Hillview Clinic", code: "HC-002", province: "Eastern", district: "Highlands", phone: "+263771000002" },
        }),
        prisma.facility.upsert({
            where: { code: "HC-003" },
            update: {},
            create: { name: "Lakeview Dispensary", code: "HC-003", province: "Central", district: "Lake", phone: "+263771000003" },
        }),
    ]);
    const passwordHash = await bcryptjs_1.default.hash("password123", 10);
    await prisma.user.upsert({
        where: { email: "manager@medflow.local" },
        update: {},
        create: {
            email: "manager@medflow.local",
            passwordHash,
            firstName: "Provincial",
            lastName: "Manager",
            role: client_1.UserRole.PROVINCIAL_MANAGER,
            phone: "+263771000000",
        },
    });
    const users = [
        { email: "pharmacist@hc001.local", role: client_1.UserRole.PHARMACIST, facility: facilities[0] },
        { email: "storekeeper@hc001.local", role: client_1.UserRole.STOREKEEPER, facility: facilities[0] },
        { email: "nurse@hc001.local", role: client_1.UserRole.NURSE_ADMIN, facility: facilities[0] },
        { email: "pharmacist@hc002.local", role: client_1.UserRole.PHARMACIST, facility: facilities[1] },
    ];
    for (const u of users) {
        await prisma.user.upsert({
            where: { email: u.email },
            update: {},
            create: {
                email: u.email,
                passwordHash,
                firstName: u.role.split("_")[0],
                lastName: u.facility.code,
                role: u.role,
                facilityId: u.facility.id,
                phone: u.facility.phone,
            },
        });
    }
    const medicines = [
        { medicineName: "Paracetamol 500mg", genericName: "Acetaminophen", dosageForm: "Tablet", strength: "500mg", unitType: "tablets", reorderThreshold: 200 },
        { medicineName: "Amoxicillin 250mg", genericName: "Amoxicillin", dosageForm: "Capsule", strength: "250mg", unitType: "capsules", reorderThreshold: 100 },
        { medicineName: "Metformin 500mg", genericName: "Metformin", dosageForm: "Tablet", strength: "500mg", unitType: "tablets", reorderThreshold: 150 },
        { medicineName: "ORS Sachets", genericName: "Oral Rehydration Salts", dosageForm: "Sachet", strength: "Standard", unitType: "sachets", reorderThreshold: 80 },
        { medicineName: "Zinc Sulphate 20mg", genericName: "Zinc", dosageForm: "Tablet", strength: "20mg", unitType: "tablets", reorderThreshold: 60 },
    ];
    const medRecords = [];
    for (const m of medicines) {
        let med = await prisma.medicine.findFirst({ where: { medicineName: m.medicineName } });
        if (!med)
            med = await prisma.medicine.create({ data: m });
        medRecords.push(med);
    }
    const pharmacist = await prisma.user.findUnique({ where: { email: "pharmacist@hc001.local" } });
    const facility = facilities[0];
    for (let i = 0; i < medRecords.length; i++) {
        const med = medRecords[i];
        if (!med)
            continue;
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + (i < 2 ? 2 : 8));
        await prisma.stockBatch.upsert({
            where: {
                medicineId_facilityId_batchNumber: {
                    medicineId: med.id,
                    facilityId: facility.id,
                    batchNumber: `BATCH-${1000 + i}`,
                },
            },
            update: {},
            create: {
                medicineId: med.id,
                facilityId: facility.id,
                batchNumber: `BATCH-${1000 + i}`,
                expiryDate: expiry,
                quantity: 500 - i * 80,
            },
        });
    }
    const patients = [
        { patientId: "PAT-26-00001", firstName: "Grace", lastName: "Moyo", gender: "Female", age: 34, phoneNumber: "+263771100001" },
        { patientId: "PAT-26-00002", firstName: "Tendai", lastName: "Chikwanha", gender: "Male", age: 45, phoneNumber: "+263771100002" },
        { patientId: "PAT-26-00003", firstName: "Rudo", lastName: "Sibanda", gender: "Female", age: 28, phoneNumber: "+263771100003" },
    ];
    for (const p of patients) {
        await prisma.patient.upsert({
            where: { patientId: p.patientId },
            update: {},
            create: { ...p, facilityId: facility.id },
        });
    }
    const patient = await prisma.patient.findFirst({ where: { facilityId: facility.id } });
    const paracetamol = medRecords[0];
    if (patient && paracetamol && pharmacist) {
        const rx = await prisma.prescription.upsert({
            where: { prescriptionId: "RX-26-00001" },
            update: {},
            create: {
                prescriptionId: "RX-26-00001",
                patientId: patient.id,
                facilityId: facility.id,
                doctorName: "Dr. Ncube",
                diagnosisNotes: "Mild fever and headache",
                medicines: {
                    create: [{ medicineId: paracetamol.id, dosage: "500mg", form: "Tablet", quantity: 20, duration: "5 days" }],
                },
            },
        });
        const batch = await prisma.stockBatch.findFirst({
            where: { medicineId: paracetamol.id, facilityId: facility.id },
        });
        if (batch) {
            await prisma.dispensingRecord.create({
                data: {
                    facilityId: facility.id,
                    patientId: patient.id,
                    prescriptionId: rx.id,
                    medicineId: paracetamol.id,
                    batchId: batch.id,
                    batchNumber: batch.batchNumber,
                    expiryDate: batch.expiryDate,
                    dosage: "500mg",
                    form: "Tablet",
                    quantity: 10,
                    duration: "5 days",
                    dispensedById: pharmacist.id,
                },
            });
        }
    }
    console.log("Seed complete.");
    console.log("Demo logins (password: password123):");
    console.log("  manager@medflow.local - Provincial Manager");
    console.log("  pharmacist@hc001.local - Pharmacist @ HC-001");
    console.log("  storekeeper@hc001.local - Storekeeper @ HC-001");
    console.log("  nurse@hc001.local - Nurse/Admin @ HC-001");
}
main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
