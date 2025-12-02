// src/processor.js
const fs = require("fs/promises");
const path = require("path");
const utils = require("./utils");
const fbService = require("./facebook_service");
const waService = require("./whatsapp_service");

/**
 * Verarbeitet eine einzelne Deal-Datei komplett.
 * @param {string} fullPath - Der volle Pfad zur JSON-Datei
 * @returns {Promise<boolean>} - true wenn gesendet, false wenn ignoriert/gelöscht
 */
async function processSingleDeal(fullPath) {
  const fileName = path.basename(fullPath);
  const productId = fileName.replace(".json", "");

  // 1. Double-Check: Wurde der schon gesendet?
  const sentDeals = await utils.getSentDeals();
  if (sentDeals.includes(productId)) return false;

  try {
    // 2. Lesen
    const content = await fs.readFile(fullPath, "utf8");
    const data = JSON.parse(content);

    // 3. Validieren (Rabatt > 50% etc.)
    const validation = utils.validateDealData(data);

    if (!validation.valid) {
      console.log(`[FILTER] 🗑️ ${fileName}: ${validation.reason}. Lösche Datei.`);
      // Schlechte Deals sofort löschen, damit sie nicht nerven
      await utils.deleteFile(fullPath);
      return false;
    }

    // 4. Alles OK -> Bild holen
    console.log(`[PROCESS] 🚀 Guter Deal (${validation.discount}%): ${productId}`);
    let imageUrl = data.image_url || (data.images?.[0] ?? null);
    const localImagePath = await utils.downloadImage(imageUrl, productId);

    // 5. Senden an alle Dienste
    await Promise.allSettled([
      fbService.sendPost(data, localImagePath),
      waService.sendMessage(data, localImagePath),
    ]);

    // 6. Als erledigt markieren
    await utils.addSentDeal(productId);
    console.log("[DONE] ✅ Deal erfolgreich verarbeitet.");
    
    return true; // Wichtig für den Watcher (wegen Drosselung)

  } catch (err) {
    console.error(`[ERROR] Fehler bei ${fileName}: ${err.message}`);
    return false;
  }
}

module.exports = { processSingleDeal };