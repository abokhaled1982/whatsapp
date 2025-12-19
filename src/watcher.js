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
const CHECK_INTERVAL_SECONDS = 30; 

// Wartezeit Grenzen (in Sekunden)
const MIN_WAIT_SECONDS = 250; // 5 Minuten
const MAX_WAIT_SECONDS = 500; // 10 Minuten

// --- HILFSFUNKTIONEN ---

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getRandomWaitSeconds() {
  return Math.floor(Math.random() * (MAX_WAIT_SECONDS - MIN_WAIT_SECONDS + 1)) + MIN_WAIT_SECONDS;
}

/**
 * Zeigt den großen Status-Block nach jedem Deal an
 */
async function printStatusBlock(current, total, context = "BATCH") {
  const sentList = await utils.getSentDeals();
  const totalHistory = sentList.length;
  const remaining = total - current;
  const percent = Math.round((current / total) * 100);

  console.log("\n==================================================");
  console.log(`✅  STATUS-REPORT (${context})`);
  console.log("==================================================");
  console.log(`📉  Fortschritt:    ${current} von ${total} erledigt (${percent}%)`);
  console.log(`🔮  Noch offen:     ${remaining} Deals in der Warteschlange`);
  console.log(`🌍  Gesamt (Ewig):  ${totalHistory} Deals jemals gesendet`);
  console.log("==================================================\n");
}

/**
 * NEU: Live Countdown in einer Zeile
 */
async function performSafetyWait() {
  const waitSeconds = getRandomWaitSeconds();
  const startTime = new Date(); // Zeitpunkt "Jetzt" (letztes Senden)
  const lastSentTimeStr = startTime.toLocaleTimeString("de-DE"); // z.B. 14:30:15
  
  let remaining = waitSeconds;

  // Cursor verstecken (macht es sauberer)
  process.stdout.write("\x1B[?25l");

  while (remaining > 0) {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    
    // Formatierung 00:00
    const mStr = String(m).padStart(2, '0');
    const sStr = String(s).padStart(2, '0');

    // \r springt an den Anfang der Zeile zurück und überschreibt
    process.stdout.write(`\r⏳ Letzter Deal: ${lastSentTimeStr} Uhr | Nächster Start in: [ ${mStr}:${sStr} ] `);

    await sleep(1000); // 1 Sekunde warten
    remaining--;
  }

  // Cursor wieder anzeigen und neue Zeile
  process.stdout.write("\x1B[?25h");
  console.log("\n\n[SAFETY] 🟢 Pause beendet. Suche nach neuen Deals...");
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
  console.log("\n2️⃣  [BATCH] Prüfe Rückstand...");
  
  // Liste holen
  let candidates = await getCandidates();

  if (candidates.length === 0) {
    console.log("✅ [BATCH] Kein Rückstand vorhanden.");
    return;
  }

  const total = candidates.length;
  console.log(`📦 [START] Starte Abarbeitung von ${total} Deals.`);
  
  for (let i = 0; i < total; i++) {
    const file = candidates[i];
    const currentNum = i + 1;

    // Verarbeiten
    const wasSent = await processor.processSingleDeal(file);
    
    // WENN ERFOLGREICH -> REPORT ANZEIGEN
    if (wasSent) {
      await printStatusBlock(currentNum, total, "BATCH");
      
      // Wenn nicht der letzte, dann warten
      if (currentNum < total) {
         await performSafetyWait();
      } else {
         console.log("🏁 [BATCH] Letzter Deal fertig!");
      }
    } else {
      console.log(`[SKIP] Datei ${path.basename(file)} übersprungen/gelöscht.`);
    }
  }
  console.log("✅ [BATCH] Rückstand komplett erledigt.");
}

// Phase 3: Watch Loop (Live neue Dateien)
async function runWatchLoop() {
  console.log("\n3️⃣  [WATCHER] 👁️  Live-Modus aktiv...");

  while (true) {
    try {
      const candidates = await getCandidates();

      if (candidates.length > 0) {
        const totalNew = candidates.length;
        console.log(`\n[LIVE] 🎯 ${totalNew} neue Datei(en) entdeckt!`);
        
        for (let i = 0; i < totalNew; i++) {
          const file = candidates[i];
          const currentNum = i + 1;

          const wasSent = await processor.processSingleDeal(file);

          if (wasSent) {
            // Auch im Live-Modus den Report zeigen
            await printStatusBlock(currentNum, totalNew, "LIVE-INPUT");
            await performSafetyWait();
          }
        }
      }

    } catch (err) {
      console.error(`[LOOP-ERROR] ${err.message}`);
    }

    await sleep(CHECK_INTERVAL_SECONDS * 1000);
  }
}

// --- START ---
async function startSystem() {
  console.log("========================================");
  console.log("   🚀 DEAL BOT SYSTEM (LIVE TIMER)      ");
  console.log("========================================");

  await runInitPhase();
  await runBatchPhase();
  await runWatchLoop();
}

module.exports = { startSystem, WATCH_FOLDER };