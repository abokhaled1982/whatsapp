// utils/image_padding.js
// Padding-only helper für WhatsApp-Breite (Node.js + sharp)
// Fügt nur seitliches Padding hinzu — skaliert das Originalbild NICHT.

const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");

async function ensureWhatsappWidth(inputPath, opts = {}) {
  const {
    targetWidth = 1080,      // Mindestbreite in px
    minAspect = 1.0,         // Mindestseitenverhältnis width/height (z.B. 1.0 = quadratisch)
    background = { r: 255, g: 255, b: 255, alpha: 1 } // Hintergrundfarbe für Padding
  } = opts;

  if (!inputPath) throw new Error("inputPath required");

  // Existenz prüfen
  await fs.access(inputPath).catch(() => {
    throw new Error(`Input file not found: ${inputPath}`);
  });

  const img = sharp(inputPath);
  const meta = await img.metadata();

  if (!meta || !meta.width || !meta.height) {
    // Kann Metadaten nicht lesen -> Original zurückgeben
    return inputPath;
  }

  const width = meta.width;
  const height = meta.height;
  const aspect = width / height;

  // Berechne die minimale Breite die wir brauchen (entweder durch aspect oder targetWidth)
  const requiredWidthByAspect = Math.ceil(height * minAspect);
  const desiredWidth = Math.max(requiredWidthByAspect, targetWidth);

  // Wenn das Bild schon breit genug ist -> nichts tun
  if (width >= desiredWidth) {
    return inputPath;
  }

  // Padding-Betrag und symmetrische Aufteilung
  const padTotal = desiredWidth - width;
  const padLeft = Math.floor(padTotal / 2);
  const padRight = padTotal - padLeft;

  // Output-Pfad: originalname + _padded + gleiche Extension (außer GIF -> .jpeg)
  const ext = (path.extname(inputPath) || ".jpg").toLowerCase();
  const base = inputPath.slice(0, -ext.length);
  const outExt = ext === ".gif" ? ".jpeg" : ext; // GIF -> JPEG (sharp support anim. GIF limited)
  const outPath = `${base}_padded${outExt}`;

  // Debug-Log (optional)
  // console.log(`[IMAGE PADDING] ${inputPath} ${width}x${height} -> ${desiredWidth}x${height} (L:${padLeft}, R:${padRight})`);

  // Verwende extend, um nur Seiten zu füllen (kein Scaling, kein Composite)
  // Wenn Ausgangsbild Alpha hat und Output JPEG ist, wird Alpha mit background gefüllt.
  let pipeline = sharp(inputPath).extend({
    top: 0,
    bottom: 0,
    left: padLeft,
    right: padRight,
    background: background
  });

  // Wähle Ausgabeformat: falls outExt == .png -> png, .webp -> webp, sonst jpeg
  if (outExt === ".png") {
    pipeline = pipeline.png({ quality: 90 });
  } else if (outExt === ".webp") {
    pipeline = pipeline.webp({ quality: 90 });
  } else {
    // Default JPEG
    pipeline = pipeline.jpeg({ quality: 90 });
  }

  await pipeline.toFile(outPath);
  return outPath;
}

module.exports = { ensureWhatsappWidth };
