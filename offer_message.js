// offer_message.js (Finales Design mit Bugfix)

// ----------------------------------------------------
// I. Markdown- & Logik-Helfer
// ----------------------------------------------------

/**
 * Korrigierte Escaping-Funktion: Maskiert nur Sonderzeichen, die
 * in *Datenfeldern* als Formatierung missverstanden werden könnten.
 */
function mdEscape(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\*/g, "\\*") // Maskiere Sternchen
    .replace(/_/g, "\\_") // Maskiere Unterstrich
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function isNA(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "N/A";
}

function getNumberFromPercent(raw) {
  if (isNA(raw)) return null;
  const s = String(raw)
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return Math.abs(n);
}

/**
 * Liefert den passenden WhatsApp-Badge basierend auf Rabattstufen (Logik aus offer_message.py).
 */
function getBadge(discountPercent) {
  const pct = getNumberFromPercent(discountPercent) || 0.0;

  if (pct >= 50) {
    return "🚨 *PREISSTURZ DES JAHRES!* 🚨"; // Höchste Dringlichkeit
  } else if (pct >= 35) {
    return "🔥 *TOP-DEAL DES TAGES!*"; // Hohe Dringlichkeit
  } else if (pct >= 20) {
    return "✨ *Gutes Angebot entdeckt!*"; // Mittlere Dringlichkeit
  }
  return "💡 *Interessantes Angebot!*"; // Standard-Präfix
}

// ----------------------------------------------------
// II. Hauptfunktion: createOfferMessage
// ----------------------------------------------------

function createOfferMessage(data, localImagePath) {
  // Daten extrahieren und vorbereiten
  const title = data?.title || "Unbekanntes Produkt";
  const price = data?.price?.raw || data?.price || null;
  const originalPrice =
    data?.original_price?.raw || data?.original_price || null;
  const discount = data?.discount_percent || null;
  const market = data?.market || data?.seller || null;
  const brand = data?.brand || null;
  const couponMore = data?.coupon?.more;
  const couponCode = data?.coupon?.code;
  const status = data?.status || "Verfügbar";
  const url = data.affiliate_url; // AFFILIATE URL WIRD WIEDER VERWENDET!
  // HINWEIS: Die URL wird NICHT in den Body geschrieben, da sie in den CTA-Button kommt.

  // Hilfsfunktion: Prüft Wert, wendet mdEscape an und formatiert die Zeile
  const formatDetailLine = (label, value, emoji = "✅") => {
    if (isNA(value)) {
      return "";
    }
    // Wichtig: Nur der Wert wird escaped
    return `${emoji} *${label}:* ${mdEscape(value)}\n`;
  };

  // --- 1. Titel & Intro-Block (Dynamischer Badge) ---
  const badge = getBadge(discount);
  // Hier wird KEIN mdEscape auf den Titel angewendet, da er in der Template-Syntax
  // oft als Variable übergeben wird (z.B. {{1}}), oder weil wir hier das Fett-Design wollen.
  const intro = `*${title}*\n${badge}\n`;

  // --- 2. Preis- & Coupon-Block (Psychologischer Fokus) ---
  let priceBlock = "";

  // Preis-Highlights
  if (!isNA(price)) {
    priceBlock += `\n💶 *HIGHLIGHTS: JETZT NUR*\n`;
    // Preisdaten werden escaped, falls sie Sonderzeichen enthalten
    priceBlock += `*💥 DEAL-PREIS:* ${mdEscape(price)}\n`;
  }

  // Rabatt & Originalpreis
  if (!isNA(discount)) {
    priceBlock += `*⬇️ Deine Ersparnis:* _${mdEscape(discount)}_\n`;
  }
  if (!isNA(originalPrice)) {
    // Hier wird die Tilde ~ für Durchgestrichen NICHT escaped
    priceBlock += `   ~Regulärer Preis: ${mdEscape(originalPrice)}~\n`;
  }

  // Coupon-Details (Monospace für Code)
  if (!isNA(couponCode)) {
    // Monospace-Ticks ` werden hier um den Code selbst platziert
    priceBlock += `\n🏷️ *Wichtig:* \`${mdEscape(couponCode)}\` (Code)\n`;
  }
  if (!isNA(couponMore)) {
    priceBlock += `    *Aktion:* ${mdEscape(couponMore)}\n`;
  }

  // --- 3. Allgemeine Details (Sekundäre Infos) ---
  const detailLines = [
    formatDetailLine("Marke", brand, "👑"), // Krone für Marke/Qualität
    formatDetailLine("Händler", market, "🛍️"), // Einkaufstasche für Shop
    formatDetailLine("Status", status, "✅"), // Status anzeigen
  ].join("");

  // --- 4. CTA Hinweis (Der Link kommt in den Button) ---
  let ctaBlock = "";
  if (!isNA(url)) {
    // Der Text-CTA ist jetzt ein Zeilenumbruch + Link + visueller Hinweis
    ctaBlock = `\n\n🛒 *DIREKT ZUM ANGEBOT!* 🚀\n${url}`;
  }

  // --- Endgültige Nachricht zusammenstellen ---
  const message = [intro, priceBlock, ctaBlock]
    .map((s) => s.trim()) // trimmt jeden Block vor dem Join
    .filter(Boolean)
    .join("\n\n"); // Fügt die Blöcke mit zwei Leerzeilen zusammen

  return message.trim();
}

module.exports = {
  createOfferMessage,
};
