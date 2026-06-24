import app from "./app";
import { config } from "./utils/config";
import { validateEmailConfig } from "./utils/email";

const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(config.port, HOST, () => {
  console.log(`StockTrackRx API running on http://${HOST}:${config.port}`);
  console.log(`Local health check: http://localhost:${config.port}/health`);
  validateEmailConfig();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
        `\nPort ${config.port} is already in use. Another StockTrackRx API instance may be running.\n` +
        `  Windows: netstat -ano | findstr :${config.port}\n` +
        `  Then: taskkill /PID <pid> /F\n` +
        `  Or set a different PORT in backend/.env\n`
    );
    process.exit(1);
  }
  throw err;
});
