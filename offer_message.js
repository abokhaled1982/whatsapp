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

// ----------------------------------------------------
// II. Hauptfunktion: createOfferMessage
// ----------------------------------------------------

function createOfferMessage(data, localImagePath) {
  // Daten extrahieren und vorbereiten
  const title = data?.title || "Unbekanntes Produkt";
  const price = data?.price?.raw || data?.price || null;
  const originalPrice = data?.original_price?.raw || data?.original_price || null;
  const discount = data?.discount_percent || null;
  const market = data?.market || data?.seller || null;
  const brand = data?.brand || null;
  const couponMore = data?.rabatt_text;
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

  // Hier wird KEIN mdEscape auf den Titel angewendet, da er in der Template-Syntax
  // oft als Variable übergeben wird (z.B. {{1}}), oder weil wir hier das Fett-Design wollen.
  const intro = `*${title}\n`;

  // --- 2. Preis- & Coupon-Block (Psychologischer Fokus) ---
  let priceBlock = "";

  if (!isNA(couponMore)) {
    // Wenn die Aktion existiert, wird sie als eigene Zeile/Block priorisiert

    priceBlock += `${couponMore}\n`;
  }
  if (!isNA(price) || !isNA(originalPrice) || !isNA(discount)) {
    let parts = [];

    // 1. Deal-Preis (immer mit Icon und Fettschrift)
    if (!isNA(price)) {
      parts.push(`💶*${mdEscape(price)}*`);
    }

    // 2. Originalpreis (durchgestrichen)
    if (!isNA(originalPrice)) {
      // WICHTIG: Tilde ~ wird nicht escaped
      parts.push(`~${mdEscape(originalPrice)}~`);
    }

    // 3. Rabatt
    if (!isNA(discount)) {
      parts.push(`${mdEscape(discount)}`);
    }

    // Fassen Sie die Teile mit zwei Leerzeichen zusammen, um den Abstand zu erhöhen
    priceBlock += parts.join("  ");
  }

  // Coupon-Details (Monospace für Code)
  if (!isNA(couponCode)) {
    // Monospace-Ticks ` werden hier um den Code selbst platziert
    priceBlock += `\n🏷️ *Wichtig:* \`${mdEscape(couponCode)}\` (Code)\n`;
  }

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
