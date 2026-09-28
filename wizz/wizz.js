let widgetId = null;
let sawElementMessage = false;

const statusEl = document.getElementById("connection-status");
const embeddedEl = document.getElementById("embedded-check");
const vibrationEl = document.getElementById("vibration-check");
const matrixEl = document.getElementById("matrix-check");
const logEl = document.getElementById("log");
const cardEl = document.getElementById("wizz-card");
const buttonEl = document.getElementById("wizz-button");

function log(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setInitialState() {
  const embedded = window.parent !== window;
  embeddedEl.textContent = embedded ? "oui" : "non";
  vibrationEl.textContent = "vibrate" in navigator ? "disponible" : "non disponible";
  statusEl.textContent = embedded
    ? "Page chargée dans un conteneur. En attente d'Element…"
    : "Page ouverte directement dans le navigateur.";
  log("Wizz Test chargé.");
}

function replyToElement(event, request, response) {
  const targetOrigin = event.origin && event.origin !== "null" ? event.origin : "*";
  window.parent.postMessage({ ...request, response }, targetOrigin);
}

window.addEventListener("message", event => {
  const request = event.data;

  if (
    !request ||
    request.api !== "toWidget" ||
    !request.requestId ||
    !request.widgetId ||
    !request.action
  ) {
    return;
  }

  if (widgetId && widgetId !== request.widgetId) {
    return;
  }

  widgetId = widgetId || request.widgetId;
  sawElementMessage = true;
  matrixEl.textContent = "reçu ✓";
  statusEl.textContent = "Element Classic parle au widget ✓";
  log(`Element → widget : ${request.action}`);

  let response = {};

  // Compatibilité minimale avec le handshake historique utilisé
  // par Element Classic / le sticker picker existant.
  if (request.action === "capabilities") {
    response = { capabilities: [] };
  } else if (request.action === "visibility") {
    response = {};
  } else {
    response = { error: { message: "Action not supported by Wizz Test" } };
  }

  replyToElement(event, request, response);
});

function playBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      log("AudioContext indisponible.");
      return;
    }

    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(660, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.11);

    gain.gain.setValueAtTime(0.055, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.18);

    oscillator.addEventListener("ended", () => ctx.close());
    log("Bip lancé.");
  } catch (error) {
    log(`Audio refusé : ${error.message}`);
  }
}

function triggerLocalWizz() {
  cardEl.classList.remove("shake");
  void cardEl.offsetWidth;
  cardEl.classList.add("shake");

  if ("vibrate" in navigator) {
    const accepted = navigator.vibrate([90, 45, 90, 45, 140]);
    log(`Vibration demandée : ${accepted ? "acceptée" : "refusée"}.`);
  } else {
    log("Vibration API absente.");
  }

  playBeep();
}

buttonEl.addEventListener("click", triggerLocalWizz);

setInitialState();

setTimeout(() => {
  if (!sawElementMessage && window.parent !== window) {
    statusEl.textContent = "Widget intégré, mais aucun message Element reçu pour l'instant.";
    log("Aucun handshake Element observé après 3 secondes.");
  }
}, 3000);
