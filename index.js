// --- Stabil, CommonJS ---
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

// ===== Konfig aus .env =====
const SESSION_PATH = process.env.SESSION_PATH || "C:/Users/walgh/Desktop/wwebjs-sender/session-data";
const CLIENT_ID = process.env.CLIENT_ID || "sport-bot-1";

const SEND_ON_READY =
  String(process.env.SEND_ON_READY || "false").toLowerCase() === "true";
const RECIPIENT = process.env.RECIPIENT || ""; // 4917...
const GROUP_NAME ="Test" || ""; // "Meine Sport Community"
const IMAGE_PATH = process.env.IMAGE_PATH || "./media/foto.jpg";
const CAPTION = process.env.CAPTION || "";

// ===== Vorbereitungen =====
ensureDir(SESSION_PATH);
ensureDir(path.resolve("./logs"));
log(`🔒 Session-Ordner: ${SESSION_PATH}`);
log(`🪪 Client-ID: ${CLIENT_ID}`);

// ===== Client anlegen (KEIN logout/destroy im Code!) =====
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: SESSION_PATH, // fester Pfad -> Session bleibt
    clientId: CLIENT_ID,
  }),
  puppeteer: {
    headless: true, // für Debug: false
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-extensions",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=FirstPartySets", // hilft gegen first_party_sets.db-Sperren
    ],
  },
  // timeouts können je nach System angepasst werden
  takeoverOnConflict: true,
  takeoverTimeoutMs: 60_000,
});

let initialized = false;
let reconnectTimer = null;

// ===== Events =====
client.on("qr", (qr) => {
  console.clear();
  log("🔐 QR-Code – scanne in WhatsApp > Verknüpfte Geräte");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => log("✅ Authentifiziert (Cookies geladen)."));
client.on("auth_failure", (m) => log("❌ Auth-Fehler: " + m));
client.on("ready", async () => {
  log("✅ WhatsApp bereit.");
  if (!initialized) {
    initialized = true;
    // Optional: Einmaliger Testversand
    if (SEND_ON_READY) {
      try {
        await waitForChatsLoaded();
        await sendImageWithCaption();
      } catch (e) {
        log("❌ Testversand fehlgeschlagen: " + (e?.message || e));
      }
    }
  }
});

// Netzwerk-/Sitzungs-Themen: sauber automatisch neu initialisieren
client.on("disconnected", (reason) => {
  log("⚠️ Disconnected: " + reason);
  scheduleReconnect();
});

client.on("change_state", (state) => log("ℹ️ State: " + state));
client.on("loading_screen", (percent, msg) => {
  log(`⌛ Loading: ${percent}% - ${msg}`);
});

// ===== Start =====
initializeSafe();

// ===== Funktionen =====
async function initializeSafe() {
  try {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    log("🚀 Initialisiere Client…");
    await client.initialize();
  } catch (e) {
    log("❌ Initialize-Fehler: " + (e?.message || e));
    scheduleReconnect(10_000);
  }
}

function scheduleReconnect(delayMs = 5_000) {
  if (reconnectTimer) return;
  log(`🔁 Reconnect in ${delayMs / 1000}s geplant…`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initializeSafe();
  }, delayMs);
}

async function waitForChatsLoaded(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const chats = await client.getChats().catch(() => []);
    if (chats && chats.length > 0) {
      const groups = chats.filter((c) => c.isGroup);
      log(`📚 Chats: ${chats.length} (Gruppen: ${groups.length})`);
      return;
    }
    await sleep(500);
  }
  throw new Error("Chats wurden nicht rechtzeitig geladen.");
}

async function resolveDestination() {
  if (GROUP_NAME && GROUP_NAME.trim()) {
    const chats = await client.getChats();
    const needle = GROUP_NAME.trim().toLowerCase();
    const exact = chats.find(
      (c) => c.isGroup && c.name && c.name.trim().toLowerCase() === needle
    );
    if (exact) return exact.id._serialized; // z.B. 12345@g.us

    const similar = chats
      .filter(
        (c) => c.isGroup && c.name && c.name.toLowerCase().includes(needle)
      )
      .slice(0, 10)
      .map((c) => c.name);
    if (similar.length) {
      throw new Error(
        `Gruppe "${GROUP_NAME}" nicht exakt gefunden. Ähnlich: ${similar.join(
          " | "
        )}`
      );
    }
    throw new Error(`Gruppe "${GROUP_NAME}" nicht gefunden.`);
  }

  if (!RECIPIENT) {
    throw new Error("Weder GROUP_NAME noch RECIPIENT in .env gesetzt.");
  }
  const phone = RECIPIENT.replace(/\D/g, "");
  if (!phone)
    throw new Error(
      "RECIPIENT muss nur Ziffern enthalten (Ländervorwahl ohne +)."
    );
  return `${phone}@c.us`;
}

async function sendImageWithCaption() {
  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`Bild nicht gefunden: ${IMAGE_PATH}`);
  }
  const to = await resolveDestination();
  const media = await MessageMedia.fromFilePath(IMAGE_PATH);
  await client.sendMessage(to, media, { caption: CAPTION });
  log(`📤 Gesendet an ${to}`);
}

// ===== Utils =====
function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFile(path.resolve("./logs/wa.log"), line + "\n", () => {});
}

// WICHTIG: kein logout()/destroy() am Ende!
// Prozess mit Ctrl+C beenden. Das lässt die Session-Dateien intakt.
