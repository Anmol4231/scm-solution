import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { NegativeStockError, ExpiredStockError, ValidationError } from "../utils/stockGuards";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Typed business-rule / stock-safety errors — surface as structured 400 client
  // errors with the message intact. These are expected validation outcomes, not
  // server faults, so they are not logged with a stack trace.
  if (err instanceof ValidationError || err instanceof NegativeStockError || err instanceof ExpiredStockError) {
    return res.status(400).json({ error: err.message, code: err.name });
  }

  if (err instanceof ZodError) {
    const msgs = err.issues.map((i) => {
      const field = i.path.length ? i.path.join(".") : null;
      return field ? `${field}: ${i.message}` : i.message;
    });
    return res.status(400).json({ error: msgs.join("; ") });
  }

  // Prisma client-side validation errors (wrong input shape / null where not allowed)
  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error("[Prisma validation]", err.message);
    return res.status(400).json({ error: "Invalid request data. Please check your inputs and try again." });
  }

  // Prisma known DB errors (FK violations, unique conflicts, not-found, etc.)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(`[Prisma ${err.code}]`, err.message);
    if (err.code === "P2002") return res.status(409).json({ error: "A record with this value already exists." });
    if (err.code === "P2025") return res.status(404).json({ error: "Record not found." });
    if (err.code === "P2003") return res.status(400).json({ error: "Please select a medicine from the Medicine Master." });
    return res.status(400).json({ error: "Database operation failed. Please try again." });
  }

  console.error(err);
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
}
