import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  expiryWarningDays: parseInt(process.env.EXPIRY_WARNING_DAYS || "90", 10),
  expiryCriticalDays: parseInt(process.env.EXPIRY_CRITICAL_DAYS || "30", 10),
  shortfallThresholdPercent: parseFloat(process.env.SHORTFALL_THRESHOLD_PERCENT || "30"),
  nonReportingDays: parseInt(process.env.NON_REPORTING_DAYS || "7", 10),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  whatsapp: {
    apiUrl: process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v18.0",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "medflow_webhook_verify",
  },
};
