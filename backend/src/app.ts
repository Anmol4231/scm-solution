import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./utils/config";
import { errorHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/auth";
import healthcareWorkerRoutes from "./routes/healthcare-workers";
import patientRoutes from "./routes/patients";
import prescriptionRoutes from "./routes/prescriptions";
import medicineRoutes from "./routes/medicines";
import categoryRoutes from "./routes/categories";
import stockRoutes from "./routes/stock";
import vendorOrderRoutes from "./routes/vendor-orders";
import dispensingRoutes from "./routes/dispensing";
import expiryRoutes from "./routes/expiry";
import returnRoutes from "./routes/returns";
import transferRoutes from "./routes/transfers";
import alertRoutes from "./routes/alerts";
import dashboardRoutes from "./routes/dashboard";
import whatsappRoutes from "./routes/whatsapp";

const app = express();

const allowedOrigins = config.corsOrigin.split(",").map((o) => o.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (
        config.nodeEnv === "development" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => res.json({ status: "ok", service: "scm-solution-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/healthcare-workers", healthcareWorkerRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.use("/api/medicines", medicineRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/vendor-orders", vendorOrderRoutes);
app.use("/api/dispensing", dispensingRoutes);
app.use("/api/expiry", expiryRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/whatsapp", whatsappRoutes);

app.use(errorHandler);

export default app;
