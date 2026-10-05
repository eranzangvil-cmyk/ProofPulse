import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const STORAGE_KEY = "proofpulse-v2";
const isNative = Capacitor.isNativePlatform();

// Windows are hour ranges. Night wraps past midnight: 21:00-06:00 is 21 -> 30.
const WINDOWS = {
  morning: { min: 6, max: 12 },
  afternoon: { min: 12, max: 17 },
  evening: { min: 17, max: 21 },
  night: { min: 21, max: 30 }
};

const defaultPulses = [
  {
    id: crypto.randomUUID(),
    name: "Money pulse",
    sender: "Aster",
    primary: "New offer came through.",
    secondary: "You already said yes.",
    mode: "play-now",
    delaySeconds: 30,
    window: "morning",
    active: false,
    scheduledTime: null
  },
  {
    id: crypto.randomUUID(),
    name: "Future self",
    sender: "Aster",
    primary: "You are not behind.",
    secondary: "You are just in motion.",
    mode: "daily",
    delaySeconds: 30,
    window: "evening",
    active: false,
    scheduledTime: null
  }
];

let state = loadState();
const browserTimers = new Map(); // pulseId -> timeout ids (browser fallback only)

const homeScreen = document.getElementById("home-screen");
const editorScreen = document.getElementById("editor-screen");
const pulseList = document.getElementById("pulse-list");
const pulseForm = document.getElementById("pulse-form");
const editorTitle = document.getElementById("editor-title");
const pulseNameInput = document.getElementById("pulse-name");
const pulseSenderInput = document.getElementById("pulse-sender");
const pulsePrimaryInput = document.getElementById("pulse-primary");
const pulseSecondaryInput = document.getElementById("pulse-secondary");
const pulseModeInput = document.getElementById("pulse-mode");
const pulseDelayInput = document.getElementById("pulse-delay");
const pulseWindowInput = document.getElementById("pulse-window");
const delayField = document.getElementById("delay-field");
const windowField = document.getElementById("window-field");
const toastStack = document.getElementById("toast-stack");

let editingPulseId = null;

document.getElementById("new-pulse-button").addEventListener("click", () => openEditor(null));
document.getElementById("back-to-home").addEventListener("click", showHome);
document.getElementById("notify-toggle").addEventListener("click", requestNotificationPermission);
document.getElementById("preview-button").addEventListener("click", previewPulse);
pulseModeInput.addEventListener("change", syncModeFields);

pulseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  savePulseFromForm();
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = { pulses: defaultPulses };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw);
    if (!parsed.pulses || !Array.isArray(parsed.pulses)) {
      return { pulses: defaultPulses };
    }
    return parsed;
  } catch (error) {
    console.error("Failed to load state", error);
    return { pulses: defaultPulses };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHome() {
  pulseList.innerHTML = "";

  if (!state.pulses.length) {
    pulseList.innerHTML = `<div class="empty-state">No Pulses yet. Create one to start the feeling.</div>`;
    return;
  }

  state.pulses.forEach((pulse) => {
    const card = document.createElement("div");
    card.className = "pulse-card";

    const timing = pulse.mode === "play-now"
      ? `${pulse.delaySeconds}s after activation`
      : `daily · ${dailyTargetTime(pulse)}`;

    card.innerHTML = `
      <div class="pulse-card-header">
        <h3>${escapeHtml(pulse.name || "Untitled Pulse")}</h3>
        <button class="action-button ${pulse.active ? "primary" : ""}" data-action="toggle" data-id="${pulse.id}">
          ${pulse.active ? "Active" : "Paused"}
        </button>
      </div>

      <div class="pulse-badges">
        <span class="badge">${pulse.mode === "play-now" ? "Play now" : "Daily"}</span>
        <span class="badge">${timing}</span>
      </div>

      <div class="pulse-actions">
        <button class="action-button" data-action="edit" data-id="${pulse.id}">Edit</button>
        <button class="action-button" data-action="duplicate" data-id="${pulse.id}">Duplicate</button>
        <button class="action-button" data-action="delete" data-id="${pulse.id}">Delete</button>
      </div>
    `;

    card.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        handlePulseAction(button.dataset.action, button.dataset.id);
      });
    });

    pulseList.appendChild(card);
  });
}

async function handlePulseAction(action, id) {
  const pulse = state.pulses.find((item) => item.id === id);
  if (!pulse) return;

  if (action === "toggle") {
    if (pulse.active) {
      await deactivatePulse(pulse);
      showToast(`"${pulse.name}" paused.`);
    } else {
      await activatePulse(pulse);
      showToast(`"${pulse.name}" is live.`);
    }
    return;
  }

  if (action === "edit") {
    openEditor(id);
    return;
  }

  if (action === "duplicate") {
    const copy = structuredClone(pulse);
    copy.id = crypto.randomUUID();
    copy.name = `${copy.name} copy`;
    copy.active = false;
    state.pulses.unshift(copy);
    saveState();
    renderHome();
    showToast("Pulse duplicated.");
    return;
  }

  if (action === "delete") {
    await deactivatePulse(pulse);
    state.pulses = state.pulses.filter((item) => item.id !== id);
    saveState();
    renderHome();
    showToast("Pulse deleted.");
  }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function showHome() {
  editorScreen.classList.remove("active");
  homeScreen.classList.add("active");
  renderHome();
}

function openEditor(id) {
  editingPulseId = id;
  const pulse = id ? state.pulses.find((item) => item.id === id) : null;

  editorTitle.textContent = pulse ? "Edit Pulse" : "New Pulse";
  pulseNameInput.value = pulse?.name || "";
  pulseSenderInput.value = pulse?.sender || "";
  pulsePrimaryInput.value = pulse?.primary || "";
  pulseSecondaryInput.value = pulse?.secondary || "";
  pulseModeInput.value = pulse?.mode || "play-now";
  pulseDelayInput.value = pulse?.delaySeconds ?? 30;
  pulseWindowInput.value = pulse?.window || "";
  syncModeFields();

  homeScreen.classList.remove("active");
  editorScreen.classList.add("active");
}

function syncModeFields() {
  const isPlayNow = pulseModeInput.value === "play-now";
  delayField.hidden = !isPlayNow;
  windowField.hidden = isPlayNow;
}

async function savePulseFromForm() {
  const name = pulseNameInput.value.trim();
  if (!name) {
    showToast("Pulse needs a name.");
    return;
  }

  const delayRaw = Number(pulseDelayInput.value);
  const data = {
    name,
    sender: pulseSenderInput.value.trim() || "Aster",
    primary: pulsePrimaryInput.value.trim() || "...",
    secondary: pulseSecondaryInput.value.trim(),
    mode: pulseModeInput.value,
    // Number.isFinite so 0 stays 0 instead of falling back to a default.
    delaySeconds: Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 30,
    window: pulseWindowInput.value
  };

  if (editingPulseId) {
    const pulse = state.pulses.find((item) => item.id === editingPulseId);
    if (pulse) {
      const wasActive = pulse.active;
      if (wasActive) await deactivatePulse(pulse);
      Object.assign(pulse, data, { scheduledTime: null });
      if (wasActive) await activatePulse(pulse);
    }
  } else {
    state.pulses.unshift({
      id: crypto.randomUUID(),
      ...data,
      active: false,
      scheduledTime: null
    });
  }

  saveState();
  showToast(`"${name}" saved.`);
  showHome();
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function notificationId(pulseId) {
  // Stable 31-bit integer per Pulse, so cancel() hits exactly this Pulse.
  let hash = 0;
  for (let i = 0; i < pulseId.length; i++) {
    hash = (hash * 31 + pulseId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647 || 1;
}

function pulseBody(pulse) {
  return pulse.secondary ? `${pulse.primary}\n${pulse.secondary}` : pulse.primary;
}

function dailyTargetTime(pulse) {
  if (pulse.scheduledTime) return pulse.scheduledTime;

  const w = WINDOWS[pulse.window];
  const hour = w
    ? w.min + Math.random() * (w.max - w.min)
    : Math.random() * 24;

  const h = Math.floor(hour) % 24;
  const m = Math.floor(Math.random() * 60);
  pulse.scheduledTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return pulse.scheduledTime;
}

function nextDailyDate(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= new Date()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

async function activatePulse(pulse) {
  pulse.active = true;

  if (isNative) {
    await scheduleNative(pulse);
  } else {
    scheduleBrowser(pulse);
  }

  saveState();
  renderHome();
}

async function deactivatePulse(pulse) {
  pulse.active = false;

  if (isNative) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id: notificationId(pulse.id) }] });
    } catch (error) {
      console.error("Failed to cancel native notification", error);
    }
  } else {
    clearBrowserTimers(pulse.id);
  }

  saveState();
  renderHome();
}

async function scheduleNative(pulse) {
  const base = {
    id: notificationId(pulse.id),
    title: pulse.sender,
    body: pulseBody(pulse)
  };

  const notification = pulse.mode === "play-now"
    ? {
        ...base,
        schedule: {
          at: new Date(Date.now() + pulse.delaySeconds * 1000),
          allowWhileIdle: true
        }
      }
    : (() => {
        const [hour, minute] = dailyTargetTime(pulse).split(":").map(Number);
        return {
          ...base,
          schedule: { on: { hour, minute }, every: "day", allowWhileIdle: true }
        };
      })();

  await LocalNotifications.schedule({ notifications: [notification] });
}

function scheduleBrowser(pulse) {
  clearBrowserTimers(pulse.id);

  if (pulse.mode === "play-now") {
    const id = setTimeout(() => showPulse(pulse), pulse.delaySeconds * 1000);
    browserTimers.set(pulse.id, [id]);
    return;
  }

  const arm = () => {
    const target = nextDailyDate(dailyTargetTime(pulse));
    const id = setTimeout(() => {
      showPulse(pulse);
      if (pulse.active) arm(); // daily actually means daily
    }, target.getTime() - Date.now());
    browserTimers.set(pulse.id, [id]);
  };
  arm();
}

function clearBrowserTimers(pulseId) {
  (browserTimers.get(pulseId) || []).forEach(clearTimeout);
  browserTimers.delete(pulseId);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function showPulse(pulse) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(pulse.sender, {
      body: pulseBody(pulse),
      tag: `proofpulse-${pulse.id}` // unique per Pulse so they stack
    });
  }
  showToast(`${pulse.sender}: ${pulse.primary}`);
}

async function previewPulse() {
  const draft = {
    id: "preview",
    sender: pulseSenderInput.value.trim() || "Aster",
    primary: pulsePrimaryInput.value.trim() || "...",
    secondary: pulseSecondaryInput.value.trim()
  };

  if (isNative) {
    await LocalNotifications.schedule({
      notifications: [{
        id: notificationId("preview"),
        title: draft.sender,
        body: pulseBody(draft),
        schedule: { at: new Date(Date.now() + 3000) }
      }]
    });
    showToast("Preview arrives in 3 seconds. Lock your phone.");
    return;
  }

  showPulse(draft);
}

async function requestNotificationPermission() {
  if (isNative) {
    const result = await LocalNotifications.requestPermissions();
    showToast(result.display === "granted" ? "Notifications enabled." : "Notifications not enabled.");
    return;
  }

  if (!("Notification" in window)) {
    showToast("This browser does not support notifications.");
    return;
  }

  if (Notification.permission === "granted") {
    showToast("Notifications already enabled.");
    return;
  }

  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    showToast(permission === "granted" ? "Notifications enabled." : "Notifications not enabled.");
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastStack.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

renderHome();
// Re-arm every active Pulse. On native this re-schedules the same IDs, which
// is harmless; in the browser timers died with the page and need rebuilding.
state.pulses.filter((p) => p.active).forEach((p) => {
  if (isNative) {
    scheduleNative(p).catch((e) => console.error("Failed to re-arm pulse", e));
  } else {
    scheduleBrowser(p);
  }
});
