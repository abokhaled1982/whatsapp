require("dotenv").config();
const watcher = require("./src/watcher");

// Einfacher Startpunkt. 
// Keine Logik hier, alles liegt im Watcher/Processor.
(async () => {
  try {
    await watcher.startSystem();
  } catch (error) {
    console.error("❌ Fataler Systemfehler in Main:", error);
    process.exit(1);
  }
})();