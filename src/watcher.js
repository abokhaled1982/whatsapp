// src/watcher.js
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const utils = require("./utils");
const processor = require("./processor");
const fbService = require("./facebook_service");
const waService = require("./whatsapp_service");

// --- KONFIGURATION ---
const HOME_DIR = os.homedir();
const WATCH_FOLDER = path.join(HOME_DIR, "Desktop", "scraper", "data", "out");
const CHECK_INTERVAL_SECONDS = 30; // Wie oft prüfen wir, wenn nichts los ist?

// Wartezeit Grenzen (in Sekunden)
const MIN_WAIT_SECONDS = 300; // 5 Minuten
const MAX_WAIT_SECONDS = 600; // 10 Minuten

// --- HILFSFUNKTIONEN ---

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gibt eine Zufallszahl zwischen MIN und MAX zurück
 */
function getRandomWaitSeconds() {
  return Math.floor(Math.random() * (MAX_WAIT_SECONDS - MIN_WAIT_SECONDS + 1)) + MIN_WAIT_SECONDS;
}

/**
 * Formatiert Sekunden in "Xm Ys" für die Konsole
 */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`; // z.B. "7m 12s"
}

/**
 * Führt das Warten aus und zeigt Countdown/Info an
 */
async function performSafetyWait() {
  const waitTime = getRandomWaitSeconds();
  const formatted = formatDuration(waitTime);
  
  console.log(`[SAFETY] 🛡️  Sicherheits-Pause: Warte ${formatted} bis zum nächsten Deal...`);
  
  // Wir warten hier die volle Zeit
  await sleep(waitTime * 1000);
  
  console.log("[SAFETY] 🟢 Pause beendet. Weiter geht's.");
}

async function getCandidates() {
  try {
    const sentDeals = await utils.getSentDeals();
    const allFiles = await fs.readdir(WATCH_FOLDER);
    return allFiles
      .filter((f) => f.endsWith(".json"))
      .filter((f) => !sentDeals.includes(f.replace(".json", "")))
      .map((f) => path.join(WATCH_FOLDER, f));
  } catch (e) {
    console.error(`[FS] Fehler beim Lesen: ${e.message}`);
    return [];
  }
}

// --- PHASEN ---

// Phase 1: Init
async function runInitPhase() {
  console.log("1️⃣  [INIT] Prüfe Ordner und Dienste...");
  await utils.ensureFoldersExist(WATCH_FOLDER);
  
  try {
    await Promise.all([fbService.init(), waService.init()]);
    console.log("✅ [INIT] Services bereit.");
  } catch (e) {
    console.error("❌ [INIT] Service-Start fehlgeschlagen:", e);
    process.exit(1);
  }
}

// Phase 2: Batch (Alte Dateien abarbeiten)
async function runBatchPhase() {
  console.log("2️⃣  [BATCH] Prüfe Rückstand...");
  
  // Wir holen die Liste immer frisch, falls sich was ändert
  let candidates = await getCandidates();

  if (candidates.length === 0) {
    console.log("✅ [BATCH] Kein Rückstand vorhanden.");
    return;
  }

  console.log(`📦 Found: ${candidates.length} Deals im Rückstand. Arbeite ab...`);
  
  // Wir iterieren manuell, damit wir warten können
  for (let i = 0; i < candidates.length; i++) {
    const file = candidates[i];
    
    // Verarbeiten
    const wasSent = await processor.processSingleDeal(file);
    
    // WENN gesendet wurde, DANN warten wir.
    // Auch beim letzten Element im Batch warten wir, damit wir nicht 
    // direkt danach im Live-Loop sofort wieder feuern.
    if (wasSent) {
      await performSafetyWait();
    }
  }
  console.log("✅ [BATCH] Rückstand erledigt.");
}

// Phase 3: Watch Loop (Auf neue warten)
async function runWatchLoop() {
  console.log("\n3️⃣  [WATCHER] 👁️  Live-Modus aktiv...");

  while (true) {
    try {
      const candidates = await getCandidates();

      if (candidates.length > 0) {
        console.log(`[LIVE] 🎯 ${candidates.length} neue Datei(en) entdeckt.`);
        
        for (const file of candidates) {
          const wasSent = await processor.processSingleDeal(file);

          if (wasSent) {
            await performSafetyWait();
          }
        }
      }
    } catch (err) {
      console.error(`[LOOP-ERROR] ${err.message}`);
    }

    // Kurzer Sleep, um CPU zu sparen, wenn KEINE Dateien da sind
    // Das ist NICHT die Drosselung nach dem Senden, sondern nur "Leerlauf"
    await sleep(CHECK_INTERVAL_SECONDS * 1000);
  }
}

// --- START ---
async function startSystem() {
  console.log("========================================");
  console.log("   🚀 DEAL BOT SYSTEM (STABLE WAIT)     ");
  console.log("========================================");

  await runInitPhase();
  await runBatchPhase();
  await runWatchLoop();
}

module.exports = { startSystem, WATCH_FOLDER };