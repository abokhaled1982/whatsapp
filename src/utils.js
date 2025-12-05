// src/utils.js
const fs = require("fs/promises");
const { createWriteStream, existsSync } = require("fs");
const path = require("path");
const axios = require("axios");

// Konstanten
const SENT_FILE_PATH = path.join(__dirname, "../sent.json");
const IMAGE_DOWNLOAD_FOLDER = path.join(__dirname, "../images");

const DOWNLOAD_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
};

// --- HELPER ---

async function ensureFoldersExist(watchFolder) {
  try {
    await fs.mkdir(IMAGE_DOWNLOAD_FOLDER, { recursive: true });
    // Prüfen ob der Out-Folder existiert, sonst Warnung
    try {
      await fs.access(watchFolder);
    } catch {
      console.warn(`[INIT] ⚠️ Achtung: Watch-Folder existiert noch nicht: ${watchFolder}`);
      await fs.mkdir(watchFolder, { recursive: true });
    }
  } catch (error) {
    console.error(`[INIT] ❌ Ordner-Fehler: ${error.message}`);
    throw error;
  }
}

async function getSentDeals() {
  try {
    const data = await fs.readFile(SENT_FILE_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function addSentDeal(productId) {
  const sentDeals = await getSentDeals();
  if (!sentDeals.includes(productId)) {
    sentDeals.push(productId);
    await fs.writeFile(SENT_FILE_PATH, JSON.stringify(sentDeals, null, 2));
  }
}

async function deleteFile(filePath) {
  try {
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
      return true;
    }
  } catch (err) {
    console.error(`[DELETE] Konnte Datei nicht löschen: ${filePath}`);
  }
  return false;
}

/**
 * Prüft Deal-Logik (Rabatt > 50%, Daten intakt).
 * Gibt { valid: boolean, reason: string, discount: number } zurück.
 */
function validateDealData(data) {
  if (!data.title || !data.affiliate_url) {
    return { valid: false, reason: "Daten unvollständig (Titel/URL fehlt)", discount: 0 };
  }

  let discountValue = 0;
  if (data.discount_percent && data.discount_percent !== "N/A") {
    const cleanString = String(data.discount_percent)
      .replace("-", "")
      .replace("%", "")
      .replace(",", ".");
    discountValue = parseFloat(cleanString);
  }

  if (discountValue <= 10) {
    return { valid: false, reason: `Rabatt zu niedrig (${discountValue}%)`, discount: discountValue };
  }

  return { valid: true, reason: "OK", discount: discountValue };
}

async function downloadImage(url, productId) {
  if (!url || String(url).trim().toUpperCase() === "N/A" || !url.startsWith("http")) {
    return null;
  }
  
  const extensionMatch = url.match(/\.(png|jpg|jpeg|webp|gif)/i);
  const extension = extensionMatch ? extensionMatch[0] : ".jpg";
  const localFilePath = path.join(IMAGE_DOWNLOAD_FOLDER, `${productId}${extension}`);

  if (existsSync(localFilePath)) return localFilePath;

  try {
    const writer = createWriteStream(localFilePath);
    const response = await axios({
      url, method: "GET", responseType: "stream", timeout: 15000, headers: DOWNLOAD_HEADERS
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(localFilePath));
      writer.on("error", reject);
    });
  } catch (error) {
    console.error(`[IMG] Download fehlgeschlagen für ${productId}: ${error.message}`);
    return null;
  }
}

module.exports = {
  ensureFoldersExist,
  getSentDeals,
  addSentDeal,
  deleteFile,
  validateDealData,
  downloadImage
};