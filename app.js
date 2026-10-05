const STORAGE_KEY = "proofpulse-v1";

const defaultPulses = [
  {
    id: crypto.randomUUID(),
    name: "Money + Future Self",
    mode: "play-now",
    status: "active",
    beats: [
      { sender: "Aster", primary: "New offer came through.", secondary: "You already said yes.", delay: 2, window: "morning" },
      { sender: "Aster", primary: "You are not behind.", secondary: "You are just in motion.", delay: 7, window: "afternoon" },
      { sender: "Aster", primary: "Outside.", secondary: "The check cleared.", delay: 12, window: "evening" }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: "Romance",
    mode: "daily",
    status: "active",
    beats: [
      { sender: "Luca", primary: "Your phone buzzes.", secondary: "He already saved your number.", delay: 5, window: "evening" },
      { sender: "Luca", primary: "You turned heads.", secondary: "And he smiled first.", delay: 18, window: "night" }
    ]
  }
];

let state = loadState();
let editingPulseId = null;
let activeTimers = [];

const homeScreen = document.getElementById("home-screen");
const editorScreen = document.getElementById("editor-screen");
const pulseList = document.getElementById("pulse-list");
const pulseForm = document.getElementById("pulse-form");
const editorTitle = document.getElementById("editor-title");
const pulseNameInput = document.getElementById("pulse-name");
const pulseModeInput = document.getElementById("pulse-mode");
const pulseStatusInput = document.getElementById("pulse-status");
const beatsList = document.getElementById("beats-list");
const toastStack = document.getElementById("toast-stack");

document.getElementById("new-pulse-button").addEventListener("click", openNewPulse);
document.getElementById("back-to-home").addEventListener("click", showHome);
document.getElementById("add-beat-button").addEventListener("click", addBeatCard);
document.getElementById("notify-toggle").addEventListener("click", requestNotificationPermission);

pulseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  savePulseFromForm();
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pulses: defaultPulses }));
      return { pulses: defaultPulses };
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

function renderHome() {
  pulseList.innerHTML = "";

  if (!state.pulses.length) {
    pulseList.innerHTML = `
      <div class="empty-state">
        No Pulses yet. Create one to start the feeling.
      </div>
    `;
    return;
  }

  state.pulses.forEach((pulse) => {
    const card = document.createElement("div");
    card.className = "pulse-card";

    card.innerHTML = `
      <div class="pulse-card-header">
        <h3>${escapeHtml(pulse.name || "Untitled Pulse")}</h3>
        <span class="badge">${pulse.status}</span>
      </div>

      <div class="pulse-badges">
        <span class="badge">${pulse.mode === "play-now" ? "Play now" : "Daily"}</span>
        <span class="badge">${pulse.beats.length} beats</span>
      </div>

      <div class="pulse-actions">
        <button class="action-button primary" data-action="activate" data-id="${pulse.id}">
          ${pulse.status === "active" ? "Activate" : "Resume"}
        </button>
        <button class="action-button" data-action="edit" data-id="${pulse.id}">
          Edit
        </button>
        <button class="action-button" data-action="duplicate" data-id="${pulse.id}">
          Duplicate
        </button>
        <button class="action-button" data-action="delete" data-id="${pulse.id}">
          Delete
        </button>
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

function handlePulseAction(action, id) {
  const pulse = state.pulses.find((item) => item.id === id);
  if (!pulse) return;

  if (action === "activate") {
    pulse.status = "active";
    saveState();
    renderHome();
    showToast(`"${pulse.name}" is live.`);
    schedulePulse(pulse);
    return;
  }

  if (action === "edit") {
    openEditorForPulse(id);
    return;
  }

  if (action === "duplicate") {
    const copy = structuredClone(pulse);
    copy.id = crypto.randomUUID();
    copy.name = `${copy.name} copy`;
    state.pulses.unshift(copy);
    saveState();
    renderHome();
    showToast("Pulse duplicated.");
    return;
  }

  if (action === "delete") {
    state.pulses = state.pulses.filter((item) => item.id !== id);
    saveState();
    renderHome();
    showToast("Pulse deleted.");
    return;
  }
}

function showHome() {
  editorScreen.classList.remove("active");
  homeScreen.classList.add("active");
  renderHome();
}

function openNewPulse() {
  editingPulseId = null;
  editorTitle.textContent = "New Pulse";
  pulseForm.reset();
  pulseModeInput.value = "play-now";
  pulseStatusInput.value = "active";
  beatsList.innerHTML = "";
  addBeatCard();

  homeScreen.classList.remove("active");
  editorScreen.classList.add("active");
}

function openEditorForPulse(id) {
  const pulse = state.pulses.find((item) => item.id === id);
  if (!pulse) return;

  editingPulseId = id;
  editorTitle.textContent = "Edit Pulse";

  pulseNameInput.value = pulse.name;
  pulseModeInput.value = pulse.mode;
  pulseStatusInput.value = pulse.status;

  beatsList.innerHTML = "";
  pulse.beats.forEach(() => addBeatCard());

  const beatCards = [...document.querySelectorAll(".beat-card")];
  beatCards.forEach((card, index) => {
    const beat = pulse.beats[index];
    if (!beat) return;

    card.querySelector(".beat-sender").value = beat.sender || "";
    card.querySelector(".beat-primary").value = beat.primary || "";
    card.querySelector(".beat-secondary").value = beat.secondary || "";
    card.querySelector(".beat-delay").value = beat.delay || 5;
    card.querySelector(".beat-window").value = beat.window || "";
  });

  homeScreen.classList.remove("active");
  editorScreen.classList.add("active");
}

function addBeatCard() {
  const template = document.getElementById("beat-template");
  const node = template.content.firstElementChild.cloneNode(true);

  const cards = beatsList.querySelectorAll(".beat-card").length + 1;
  node.querySelector(".beat-number").textContent = `Beat ${cards}`;

  node.querySelector(".delete-beat").addEventListener("click", () => {
    if (beatsList.querySelectorAll(".beat-card").length === 1) {
      showToast("A pulse needs at least one beat.");
      return;
    }

    node.remove();
    refreshBeatNumbers();
  });

  beatsList.appendChild(node);
}

function refreshBeatNumbers() {
  const cards = [...beatsList.querySelectorAll(".beat-card")];
  cards.forEach((card, index) => {
    card.querySelector(".beat-number").textContent = `Beat ${index + 1}`;
  });
}

function savePulseFromForm() {
  const name = pulseNameInput.value.trim();
  if (!name) {
    showToast("Pulse needs a name.");
    return;
  }

  const beatCards = [...document.querySelectorAll(".beat-card")];
  const beats = beatCards.map((card) => ({
    sender: card.querySelector(".beat-sender").value || "Aster",
    primary: card.querySelector(".beat-primary").value || "...",
    secondary: card.querySelector(".beat-secondary").value || "",
    delay: Number(card.querySelector(".beat-delay").value) || 5,
    window: card.querySelector(".beat-window").value || ""
  }));

  if (editingPulseId) {
    const pulse = state.pulses.find((item) => item.id === editingPulseId);
    if (pulse) {
      pulse.name = name;
      pulse.mode = pulseModeInput.value;
      pulse.status = pulseStatusInput.value;
      pulse.beats = beats;
    }
  } else {
    state.pulses.unshift({
      id: crypto.randomUUID(),
      name,
      mode: pulseModeInput.value,
      status: pulseStatusInput.value,
      beats
    });
  }

  saveState();
  showToast(`"${name}" saved.`);
  showHome();
}

function schedulePulse(pulse) {
  clearAllTimers();

  if (pulse.mode === "play-now") {
    let totalDelay = 0;
    pulse.beats.forEach((beat) => {
      const timerId = setTimeout(() => {
        showBeat(beat);
      }, (totalDelay + beat.delay) * 1000);

      activeTimers.push(timerId);
      totalDelay += beat.delay;
    });
  } else {
    pulse.beats.forEach((beat) => {
      const timerId = scheduleBeatDaily(beat);
      if (timerId) activeTimers.push(timerId);
    });
  }
}

function scheduleBeatDaily(beat) {
  const windows = {
    morning: { min: 6, max: 12 },
    afternoon: { min: 12, max: 17 },
    evening: { min: 17, max: 21 },
    night: { min: 21, max: 6 }
  };

  const chosen = windows[beat.window] || windows.afternoon;
  const now = new Date();
  const target = new Date();

  const hour = chosen.min + Math.random() * (chosen.max - chosen.min);
  target.setHours(Math.floor(hour), Math.floor(Math.random() * 60), 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const msUntil = target.getTime() - now.getTime();
  if (msUntil <= 0) return null;

  return setTimeout(() => {
    showBeat(beat);
  }, msUntil);
}

function showBeat(beat) {
  const options = {
    body: beat.secondary,
    tag: "proofpulse-beat"
  };

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(beat.sender, options);
  }

  showToast(`${beat.sender}: ${beat.primary}`);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastStack.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("This browser does not support notifications.");
    return;
  }

  if (Notification.permission === "granted") {
    showToast("Notifications already enabled.");
    return;
  }

  if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        showToast("Notifications enabled.");
      } else {
        showToast("Notifications not enabled.");
      }
    });
  }
}

function clearAllTimers() {
  activeTimers.forEach((timerId) => clearTimeout(timerId));
  activeTimers = [];
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return String(text).replace(/[&<>\"']/g, (m) => map[m]);
}

// init
renderHome();
if (state.pulses.length > 0 && state.pulses[0].status === "active") {
  schedulePulse(state.pulses[0]);
}
