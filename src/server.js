require("dotenv").config();

const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.WHATSAPP_SERVICE_API_KEY || "";

// =============================
// VARIABLES DE ESTADO
// =============================
let latestQrImage = null;
let clientReady = false;
let clientState = "starting";

// =============================
// CLIENTE WHATSAPP
// =============================
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: process.env.WWEBJS_CLIENT_ID || "umg-rover",
    dataPath: process.env.WWEBJS_DATA_PATH || "./.wwebjs_auth"
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  }
});

// =============================
// EVENTOS
// =============================
client.on("qr", async (qr) => {
  latestQrImage = await QRCode.toDataURL(qr);
  clientState = "qr_required";
  clientReady = false;
  console.log("Escanea el QR desde tu WhatsApp");
});

client.on("ready", () => {
  clientReady = true;
  clientState = "ready";
  latestQrImage = null;
  console.log("WhatsApp listo");
});

client.on("authenticated", () => {
  console.log("Autenticado correctamente");
});

client.on("auth_failure", (msg) => {
  clientReady = false;
  clientState = "auth_failure";
  console.log("Fallo de autenticacion:", msg);
});

client.on("disconnected", (reason) => {
  clientReady = false;
  clientState = "disconnected";
  console.log("Desconectado:", reason);
});

// =============================
// MIDDLEWARE API KEY
// =============================
function checkApiKey(req, res, next) {
  if (!API_KEY) return next();

  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    return res.status(401).json({ error: "API Key invalida" });
  }

  next();
}

// =============================
// UTILIDADES
// =============================
function formatPhone(phone) {
  let cleaned = String(phone || "").replace(/\D/g, "");

  if (!cleaned) {
    throw new Error("Numero de telefono invalido");
  }

  if (cleaned.length === 8) {
    cleaned = "502" + cleaned;
  }

  if (cleaned.length === 11 && cleaned.startsWith("502")) {
    return cleaned + "@c.us";
  }

  throw new Error("Numero de telefono invalido. Usa 8 digitos o 502 seguido del numero.");
}
// =============================
// ENDPOINTS
// =============================

app.get("/health", (req, res) => {
  res.json({
    ready: clientReady,
    state: clientState
  });
});

app.get("/session/status", checkApiKey, (req, res) => {
  res.json({
    ready: clientReady,
    state: clientState,
    qr_available: !!latestQrImage
  });
});

app.get("/session/qr", (req, res) => {
  if (!latestQrImage) {
    return res.status(404).json({ error: "No hay QR disponible" });
  }

  res.json({
    qr_base64: latestQrImage
  });
});

app.get("/qr-view", (req, res) => {
  if (!latestQrImage) {
    return res.send("<h2>No hay QR disponible todavia</h2>");
  }

  res.send(`
    <html>
      <head>
        <title>QR WhatsApp</title>
      </head>
      <body style="font-family: Arial; text-align:center; padding:40px;">
        <h1>Escanea este QR con WhatsApp</h1>
        <img src="${latestQrImage}" alt="QR WhatsApp" style="max-width:300px;" />
      </body>
    </html>
  `);
});

app.post("/messages/text", checkApiKey, async (req, res) => {
  try {
    if (!clientReady) {
      return res.status(503).json({ error: "WhatsApp no esta listo" });
    }

    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: "to y message son obligatorios" });
    }

    const chatId = formatPhone(to);
    const result = await client.sendMessage(chatId, message);

    res.json({
      ok: true,
      id: result.id?._serialized || null
    });
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    res.status(500).json({ error: "Error enviando mensaje" });
  }
});

app.post("/messages/media", checkApiKey, async (req, res) => {
  try {
    if (!clientReady) {
      return res.status(503).json({ error: "WhatsApp no esta listo" });
    }

    const { to, caption, filename, mimeType, base64Data } = req.body;

    if (!to || !mimeType || !base64Data) {
      return res.status(400).json({
        error: "to, mimeType y base64Data son obligatorios"
      });
    }

    const media = new MessageMedia(
      mimeType,
      base64Data,
      filename || "archivo"
    );

    const chatId = formatPhone(to);

    const result = await client.sendMessage(chatId, media, {
      caption: caption || ""
    });

    res.json({
      ok: true,
      id: result.id?._serialized || null
    });
  } catch (error) {
    console.error("Error enviando archivo:", error);
    res.status(500).json({ error: "Error enviando archivo" });
  }
});

// =============================
// INICIAR CLIENTE Y SERVIDOR
// =============================
client.initialize();

app.listen(PORT, () => {
  console.log(`WhatsApp service corriendo en puerto ${PORT}`);
});