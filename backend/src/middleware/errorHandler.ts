import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const msgs = err.issues.map((i) => {
      const field = i.path.length ? i.path.join(".") : null;
      return field ? `${field}: ${i.message}` : i.message;
    });
    return res.status(400).json({ error: msgs.join("; ") });
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
}
