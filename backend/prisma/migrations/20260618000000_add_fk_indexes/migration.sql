-- CreateIndex
CREATE INDEX "Alert_medicineId_idx" ON "Alert"("medicineId");

-- CreateIndex
CREATE INDEX "Alert_batchId_idx" ON "Alert"("batchId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "DispensingRecord_medicineId_idx" ON "DispensingRecord"("medicineId");

-- CreateIndex
CREATE INDEX "DispensingRecord_batchId_idx" ON "DispensingRecord"("batchId");

-- CreateIndex
CREATE INDEX "DispensingRecord_prescriptionId_idx" ON "DispensingRecord"("prescriptionId");

-- CreateIndex
CREATE INDEX "ExpiredMedicineRecord_facilityId_idx" ON "ExpiredMedicineRecord"("facilityId");

-- CreateIndex
CREATE INDEX "ExpiredMedicineRecord_medicineId_idx" ON "ExpiredMedicineRecord"("medicineId");

-- CreateIndex
CREATE INDEX "Medicine_categoryId_idx" ON "Medicine"("categoryId");

-- CreateIndex
CREATE INDEX "MedicineReturn_medicineId_idx" ON "MedicineReturn"("medicineId");

-- CreateIndex
CREATE INDEX "MedicineReturn_batchId_idx" ON "MedicineReturn"("batchId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Patient_facilityId_idx" ON "Patient"("facilityId");

-- CreateIndex
CREATE INDEX "Prescription_patientId_idx" ON "Prescription"("patientId");

-- CreateIndex
CREATE INDEX "Prescription_facilityId_idx" ON "Prescription"("facilityId");

-- CreateIndex
CREATE INDEX "PrescriptionMedicine_prescriptionId_idx" ON "PrescriptionMedicine"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionMedicine_medicineId_idx" ON "PrescriptionMedicine"("medicineId");

-- CreateIndex
CREATE INDEX "StockOrderLine_medicineId_idx" ON "StockOrderLine"("medicineId");

-- CreateIndex
CREATE INDEX "StockReceiptLine_medicineId_idx" ON "StockReceiptLine"("medicineId");

-- CreateIndex
CREATE INDEX "StockReceiptLine_batchId_idx" ON "StockReceiptLine"("batchId");

-- CreateIndex
CREATE INDEX "StockTransaction_batchId_idx" ON "StockTransaction"("batchId");

-- CreateIndex
CREATE INDEX "StockTransaction_transferId_idx" ON "StockTransaction"("transferId");

-- CreateIndex
CREATE INDEX "TransferLine_medicineId_idx" ON "TransferLine"("medicineId");

-- CreateIndex
CREATE INDEX "TransferLine_batchId_idx" ON "TransferLine"("batchId");

-- CreateIndex
CREATE INDEX "User_facilityId_idx" ON "User"("facilityId");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");
