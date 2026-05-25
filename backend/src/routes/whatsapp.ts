import { Router } from "express";
import { config } from "../utils/config";
import { whatsappService } from "../whatsapp/service";

const router = Router();

// Webhook verification (Meta Cloud API)
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Incoming messages (placeholder handler)
router.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (message?.type === "text") {
      const from = message.from;
      const text = message.text?.body || "";
      const result = await whatsappService.handleIncomingMessage(from, text);
      console.log("[WhatsApp inbound]", from, text, result);
    }
    res.sendStatus(200);
  } catch {
    res.sendStatus(200);
  }
});

// Manual command test endpoint (dev)
router.post("/command", async (req, res, next) => {
  try {
    const { text, facilityId } = req.body;
    const { parseWhatsAppCommand } = await import("../whatsapp/commands");
    const result = await parseWhatsAppCommand(text, facilityId);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
