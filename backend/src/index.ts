import app from "./app";
import { config } from "./utils/config";

const server = app.listen(config.port, () => {
  console.log(`SCM Solution API running on http://localhost:${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/health`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
        `\nPort ${config.port} is already in use. Another SCM Solution API instance may be running.\n` +
        `  Windows: netstat -ano | findstr :${config.port}\n` +
        `  Then: taskkill /PID <pid> /F\n` +
        `  Or set a different PORT in backend/.env\n`
    );
    process.exit(1);
  }
  throw err;
});
