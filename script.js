import {
  VALID_MBTI_TYPES,
  getCompatibilityFromMatrix,
  loadCompatibilityMatrix
} from "./src/lib/compatibility.js";

const INITIAL_PEOPLE = [
  { id: "1", name: "Shav", type: "ENFJ" },
  { id: "2", name: "Ray", type: "ENFP" },
  { id: "3", name: "Viv", type: "ISTJ" },
  { id: "4", name: "Chelsea", type: "INFJ" },
  { id: "5", name: "Ange", type: "INTP" },
  { id: "6", name: "Daniel", type: "INFP" },
  { id: "7", name: "Nghi", type: "INFJ" },
  { id: "8", name: "Michelle", type: "INTP" },
  { id: "9", name: "Jess", type: "INFJ" },
  { id: "10", name: "Jason", type: "INTJ" }
];

const DEFAULT_ACTIVE_ID = INITIAL_PEOPLE[0].id;
const DURATION = 460;
const APP_CONFIG = window.PERSONALITY_CHEMISTRY_CONFIG || {};

const layers = {
  stage: document.getElementById("mapStage"),
  svg: document.getElementById("connectionsLayer"),
  nodes: document.getElementById("nodesLayer"),
  status: document.getElementById("statusCopy"),
  form: document.getElementById("personForm"),
  nameInput: document.getElementById("nameInput"),
  typeInput: document.getElementById("typeInput"),
  formMessage: document.getElementById("formMessage"),
  labelToggle: document.getElementById("labelToggle"),
  adminBadge: document.getElementById("adminBadge"),
  adminHelper: document.getElementById("adminHelper"),
  memberList: document.getElementById("memberList"),
  copyShareLink: document.getElementById("copyShareLink"),
  copyAdminLink: document.getElementById("copyAdminLink")
};

const state = {
  people: INITIAL_PEOPLE.map((person) => ({ ...person })),
  defaultActivePersonId: DEFAULT_ACTIVE_ID,
  activePersonId: DEFAULT_ACTIVE_ID,
  hoveredId: null,
  showLabels: true,
  positions: {},
  animationFrame: null,
  nextId: INITIAL_PEOPLE.length + 1,
  groupId: "",
  adminKey: "",
  isAdmin: true
};

const collaboration = {
  enabled: false,
  client: null,
  channel: null,
  table: APP_CONFIG.supabaseTable || "chemistry_groups",
  bootstrapped: false,
  lastSharedSignature: ""
};

const nodeElements = new Map();
const connectionElements = new Map();

function parseMBTI(type) {
  const cleaned = String(type || "").trim().toUpperCase();
  if (!VALID_MBTI_TYPES.has(cleaned)) {
    return null;
  }
  return cleaned.split("");
}

function createToken() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

function encodeBase64Url(value) {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return decodeURIComponent(escape(atob(`${normalized}${padding}`)));
}

function sanitizePeople(input) {
  if (!Array.isArray(input)) {
    return INITIAL_PEOPLE.map((person) => ({ ...person }));
  }

  const seenNames = new Set();
  const sanitized = input
    .map((person, index) => {
      const name = String(person?.name || "").trim();
      const type = String(person?.type || "").trim().toUpperCase();
      const id = String(person?.id || index + 1);

      if (!name || !parseMBTI(type)) {
        return null;
      }

      const lowered = name.toLowerCase();
      if (seenNames.has(lowered)) {
        return null;
      }
      seenNames.add(lowered);

      return { id, name, type };
    })
    .filter(Boolean);

  return sanitized.length ? sanitized : INITIAL_PEOPLE.map((person) => ({ ...person }));
}

function getSerializableState() {
  return {
    groupId: state.groupId,
    defaultActivePersonId: state.defaultActivePersonId,
    activePersonId: state.activePersonId,
    people: state.people
  };
}

function getSharedGroupState() {
  return {
    groupId: state.groupId,
    defaultActivePersonId: state.defaultActivePersonId,
    people: state.people
  };
}

function getSharedStateSignature(snapshot = getSharedGroupState()) {
  return JSON.stringify(snapshot);
}

function getAdminStorageKey(groupId) {
  return `personality-chemistry-admin:${groupId}`;
}

function persistAdminKey() {
  try {
    window.localStorage.setItem(getAdminStorageKey(state.groupId), state.adminKey);
  } catch {
    return;
  }
}

function getStoredAdminKey(groupId) {
  try {
    return window.localStorage.getItem(getAdminStorageKey(groupId)) || "";
  } catch {
    return "";
  }
}

function buildAppUrl(includeAdminKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("data", encodeBase64Url(JSON.stringify(getSerializableState())));
  if (includeAdminKey) {
    url.searchParams.set("admin", state.adminKey);
  } else {
    url.searchParams.delete("admin");
  }
  return url.toString();
}

function syncUrlState() {
  const nextUrl = buildAppUrl(state.isAdmin);
  window.history.replaceState({}, "", nextUrl);
}

function loadStateFromUrl() {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get("data");
  const requestedAdminKey = url.searchParams.get("admin") || "";

  if (!encoded) {
    state.groupId = createToken();
    state.adminKey = createToken();
    state.isAdmin = true;
    persistAdminKey();
    syncUrlState();
    return;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(encoded));
    const people = sanitizePeople(parsed.people);
    const parsedActiveId = parsed.activePersonId || parsed.centerId;
    const parsedDefaultActiveId = parsed.defaultActivePersonId || parsed.defaultCenterId;
    const activeExists = people.some((person) => person.id === parsedActiveId);
    const defaultExists = people.some((person) => person.id === parsedDefaultActiveId);

    state.people = people;
    state.groupId = String(parsed.groupId || createToken());
    const storedAdminKey = getStoredAdminKey(state.groupId);
    state.defaultActivePersonId = defaultExists ? String(parsedDefaultActiveId) : people[0].id;
    state.activePersonId = activeExists ? String(parsedActiveId) : state.defaultActivePersonId;
    state.nextId =
      Math.max(
        0,
        ...people.map((person) => {
          const numeric = Number.parseInt(person.id, 10);
          return Number.isNaN(numeric) ? 0 : numeric;
        })
      ) + 1;

    state.adminKey = String(storedAdminKey || requestedAdminKey || createToken());
    state.isAdmin =
      (requestedAdminKey !== "" && requestedAdminKey === state.adminKey) ||
      (requestedAdminKey === "" && storedAdminKey !== "" && storedAdminKey === state.adminKey);
    if (state.isAdmin) {
      persistAdminKey();
    }
  } catch {
    state.people = INITIAL_PEOPLE.map((person) => ({ ...person }));
    state.defaultActivePersonId = DEFAULT_ACTIVE_ID;
    state.activePersonId = DEFAULT_ACTIVE_ID;
    state.groupId = createToken();
    state.adminKey = createToken();
    state.isAdmin = true;
    persistAdminKey();
  }

  syncUrlState();
}

function applySharedGroupState(snapshot, { animate = true } = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  const people = sanitizePeople(snapshot.people);
  const defaultExists = people.some((person) => person.id === snapshot.defaultActivePersonId);
  const activeStillExists = people.some((person) => person.id === state.activePersonId);

  state.people = people;
  state.defaultActivePersonId = defaultExists ? String(snapshot.defaultActivePersonId) : people[0].id;
  state.activePersonId = activeStillExists ? state.activePersonId : state.defaultActivePersonId;
  state.nextId =
    Math.max(
      0,
      ...people.map((person) => {
        const numeric = Number.parseInt(person.id, 10);
        return Number.isNaN(numeric) ? 0 : numeric;
      })
    ) + 1;

  collaboration.lastSharedSignature = getSharedStateSignature({
    groupId: state.groupId,
    defaultActivePersonId: state.defaultActivePersonId,
    people: state.people
  });

  syncNodeInventory();
  syncConnectionInventory();
  updateAdminUi();

  const nextPositions = generateCircularPositions(state.people);
  if (animate && Object.keys(state.positions).length) {
    animateToPositions(nextPositions);
  } else {
    renderFrame(nextPositions);
  }

  syncUrlState();
}

async function initializeCollaboration() {
  const supabaseUrl = APP_CONFIG.supabaseUrl;
  const supabaseAnonKey = APP_CONFIG.supabaseAnonKey;

  if (!supabaseUrl || !supabaseAnonKey) {
    return false;
  }

  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    collaboration.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    collaboration.enabled = true;
    return true;
  } catch (error) {
    console.warn("Supabase client failed to load. Falling back to local-only mode.", error);
    collaboration.enabled = false;
    return false;
  }
}

async function persistSharedState() {
  if (!collaboration.enabled || !collaboration.client || !state.groupId) {
    return;
  }

  const snapshot = getSharedGroupState();
  const signature = getSharedStateSignature(snapshot);
  collaboration.lastSharedSignature = signature;

  const { error } = await collaboration.client.from(collaboration.table).upsert(
    {
      group_id: state.groupId,
      state: snapshot,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: "group_id"
    }
  );

  if (error) {
    console.warn("Supabase sync write failed.", error);
    setMessage("Live sync is unavailable right now. Local changes still work.", true);
  }
}

async function loadSharedStateFromSupabase() {
  if (!collaboration.enabled || !collaboration.client || !state.groupId) {
    return;
  }

  const { data, error } = await collaboration.client
    .from(collaboration.table)
    .select("state")
    .eq("group_id", state.groupId)
    .maybeSingle();

  if (error) {
    console.warn("Supabase sync read failed.", error);
    return;
  }

  if (data?.state) {
    applySharedGroupState(data.state, { animate: false });
    collaboration.bootstrapped = true;
    return;
  }

  await persistSharedState();
  collaboration.bootstrapped = true;
}

function subscribeToSharedState() {
  if (!collaboration.enabled || !collaboration.client || !state.groupId) {
    return;
  }

  if (collaboration.channel) {
    collaboration.client.removeChannel(collaboration.channel);
    collaboration.channel = null;
  }

  collaboration.channel = collaboration.client
    .channel(`chemistry-group-${state.groupId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: collaboration.table,
        filter: `group_id=eq.${state.groupId}`
      },
      (payload) => {
        const incomingState = payload.new?.state || payload.old?.state;
        if (!incomingState) {
          return;
        }

        const signature = getSharedStateSignature(incomingState);
        if (signature === collaboration.lastSharedSignature) {
          return;
        }

        applySharedGroupState(incomingState);
      }
    )
    .subscribe();
}

function getStageMetrics() {
  const rect = layers.stage.getBoundingClientRect();
  return {
    width: rect.width || 1000,
    height: rect.height || 800
  };
}

function generateCircularPositions(nodes) {
  const metrics = getStageMetrics();
  const minSide = Math.min(metrics.width, metrics.height);
  const radius = (window.innerWidth < 700 ? 0.35 : 0.41) * minSide;
  const center = { x: metrics.width / 2, y: metrics.height / 2 };
  const startAngle = -Math.PI / 2;
  const angleStep = nodes.length ? (Math.PI * 2) / nodes.length : 0;
  const positions = {};

  layers.svg.setAttribute("viewBox", `0 0 ${metrics.width} ${metrics.height}`);

  nodes.forEach((node) => {
    const ringIndex = nodes.findIndex((ringNode) => ringNode.id === node.id);
    const angle = startAngle + ringIndex * angleStep;
    positions[node.id] = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle
    };
  });

  return positions;
}

function setMessage(message, isError = false) {
  layers.formMessage.textContent = message;
  layers.formMessage.style.color = isError ? "#FF4D4F" : "#72757e";
}

function getPersonById(id) {
  return state.people.find((person) => person.id === id) || null;
}

function easeOutBack(progress) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);
}

function blend(start, end, progress) {
  return start + (end - start) * progress;
}

function getConnectionPath(centerPoint, outerPoint) {
  const deltaX = outerPoint.x - centerPoint.x;
  const deltaY = outerPoint.y - centerPoint.y;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const controlOffset = Math.min(28, distance * 0.08);
  const normalX = (-deltaY / distance) * controlOffset;
  const normalY = (deltaX / distance) * controlOffset;
  const controlX = (centerPoint.x + outerPoint.x) / 2 + normalX;
  const controlY = (centerPoint.y + outerPoint.y) / 2 + normalY;

  return `M ${centerPoint.x} ${centerPoint.y} Q ${controlX} ${controlY} ${outerPoint.x} ${outerPoint.y}`;
}

function buildNode(person) {
  const button = document.createElement("button");
  button.className = "node";
  button.type = "button";
  button.dataset.id = person.id;
  button.setAttribute("aria-label", `${person.name}, ${person.type}`);
  button.innerHTML = `
    <div>
      <div class="node-name">${person.name}</div>
      <div class="node-type">${person.type}</div>
    </div>
  `;

  button.addEventListener("click", () => {
    if (state.activePersonId !== person.id) {
      setActivePerson(person.id);
    }
  });

  button.addEventListener("mouseenter", () => {
    state.hoveredId = person.id;
    updateVisualState();
  });

  button.addEventListener("mouseleave", () => {
    if (state.hoveredId === person.id) {
      state.hoveredId = null;
      updateVisualState();
    }
  });

  nodeElements.set(person.id, button);
  layers.nodes.appendChild(button);
}

function ensureConnection(id) {
  if (connectionElements.has(id)) {
    return connectionElements.get(id);
  }

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "connection-group");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const pathId = `connection-path-${id}`;
  path.setAttribute("id", pathId);
  path.setAttribute("class", "connection-line");

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("class", "connection-label");

  const textPath = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
  textPath.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#${pathId}`);
  textPath.setAttribute("startOffset", "50%");
  textPath.setAttribute("text-anchor", "middle");

  text.appendChild(textPath);
  group.append(path, text);
  layers.svg.appendChild(group);

  const elementSet = { group, path, textPath };
  connectionElements.set(id, elementSet);
  return elementSet;
}

function syncNodeInventory() {
  state.people.forEach((person) => {
    if (!nodeElements.has(person.id)) {
      buildNode(person);
    }
  });

  nodeElements.forEach((element, id) => {
    if (!state.people.some((person) => person.id === id)) {
      element.remove();
      nodeElements.delete(id);
    }
  });
}

function syncConnectionInventory() {
  connectionElements.forEach((elements, id) => {
    if (!state.people.some((person) => person.id === id)) {
      elements.group.remove();
      connectionElements.delete(id);
    }
  });
}

function renderMemberList() {
  layers.memberList.innerHTML = "";

  state.people.forEach((person) => {
    const row = document.createElement("div");
    row.className = "member-row";

    const meta = document.createElement("div");
    meta.className = "member-meta";
    meta.innerHTML = `
      <span class="member-name">${person.name}</span>
      <span class="member-type">${person.type}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "member-actions";

    if (person.id === state.defaultActivePersonId) {
      const starter = document.createElement("span");
      starter.className = "member-pill";
      starter.textContent = "Starter";
      actions.appendChild(starter);
    }

    if (state.isAdmin) {
      const removeButton = document.createElement("button");
      removeButton.className = "remove-button";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.disabled = state.people.length <= 1 || person.id === state.defaultActivePersonId;
      removeButton.addEventListener("click", () => {
        removePerson(person.id);
      });
      actions.appendChild(removeButton);
    }

    row.append(meta, actions);
    layers.memberList.appendChild(row);
  });
}

function updateAdminUi() {
  layers.adminBadge.textContent = state.isAdmin ? "Group starter mode" : "Shared participant mode";
  layers.adminBadge.classList.toggle("is-viewer", !state.isAdmin);
  layers.adminHelper.textContent = state.isAdmin
    ? "You can remove people and share either the participant link or the protected admin link."
    : "You can add yourself from this shared link. Removing people is reserved for the group starter.";
  layers.copyAdminLink.style.display = state.isAdmin ? "" : "none";
  renderMemberList();
}

function renderConnectionsFromActivePerson(activePersonId, positions) {
  const activePerson = getPersonById(activePersonId);
  const activePosition = positions[activePersonId];

  connectionElements.forEach((elements) => {
    elements.group.style.display = "none";
  });

  state.people.forEach((person) => {
    if (person.id === activePersonId) {
      return;
    }

    const position = positions[person.id];
    const connection = ensureConnection(person.id);
    const compatibility = getCompatibilityFromMatrix(activePerson.type, person.type);

    connection.group.style.display = "";
    connection.group.classList.toggle("labels-hidden", !state.showLabels);
    connection.path.setAttribute("d", getConnectionPath(activePosition, position));
    connection.path.setAttribute("stroke", compatibility.color);
    connection.path.setAttribute(
      "stroke-width",
      String(compatibility.width + compatibility.score * 0.12)
    );
    connection.path.setAttribute("data-reason", compatibility.reason || "");
    connection.textPath.textContent = `${compatibility.label} • ${compatibility.score}/9`;
  });
}

function renderFrame(positions) {
  state.positions = positions;

  state.people.forEach((person) => {
    const node = nodeElements.get(person.id);
    const position = positions[person.id];

    node.classList.toggle("is-active", person.id === state.activePersonId);
    node.style.transform = `translate(${position.x}px, ${position.y}px)`;
    node.querySelector(".node-name").textContent = person.name;
    node.querySelector(".node-type").textContent = person.type;
    node.setAttribute("aria-label", `${person.name}, ${person.type}`);
  });

  renderConnectionsFromActivePerson(state.activePersonId, positions);
  updateVisualState();
  renderMemberList();
}

function updateVisualState() {
  const activePerson = getPersonById(state.activePersonId);

  state.people.forEach((person) => {
    const node = nodeElements.get(person.id);
    const isActive = person.id === state.activePersonId;
    const isHovered = person.id === state.hoveredId;
    const shouldDim =
      state.hoveredId !== null &&
      !isActive &&
      !isHovered;

    node.classList.toggle("is-hovered", isHovered);
    node.classList.toggle("is-dimmed", shouldDim);
  });

  connectionElements.forEach((elements, id) => {
    const person = getPersonById(id);
    if (!person || id === state.activePersonId) {
      return;
    }

    const compatibility = getCompatibilityFromMatrix(activePerson.type, person.type);
    const isHovered = id === state.hoveredId || state.hoveredId === state.activePersonId;
    const shouldDim =
      state.hoveredId !== null &&
      state.hoveredId !== id &&
      state.hoveredId !== state.activePersonId;

    elements.group.classList.toggle("is-dimmed", shouldDim);
    elements.group.classList.toggle("labels-hidden", !state.showLabels);
    elements.path.style.strokeWidth = `${
      isHovered
        ? compatibility.width + compatibility.score * 0.12 + 2
        : compatibility.width + compatibility.score * 0.12
    }`;
    elements.path.style.filter = isHovered ? "drop-shadow(0 0 8px rgba(17,24,39,0.18))" : "none";
  });

  layers.status.textContent = `Current chemistry: ${activePerson.name}`;
  if (state.activePersonId === state.defaultActivePersonId) {
    layers.status.textContent = `Your chemistry: ${activePerson.name}`;
  }
}

function animateToPositions(nextPositions) {
  const currentPositions = Object.keys(state.positions).length
    ? state.positions
    : generateCircularPositions(state.people);

  const stageMetrics = getStageMetrics();
  const centerFallback = { x: stageMetrics.width / 2, y: stageMetrics.height / 2 };
  const fromPositions = {};

  state.people.forEach((person) => {
    fromPositions[person.id] = currentPositions[person.id] || centerFallback;
  });

  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
  }

  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    const rawProgress = Math.min(elapsed / DURATION, 1);
    const progress = easeOutBack(rawProgress);
    const frame = {};

    state.people.forEach((person) => {
      const from = fromPositions[person.id];
      const to = nextPositions[person.id];
      frame[person.id] = {
        x: blend(from.x, to.x, progress),
        y: blend(from.y, to.y, progress)
      };
    });

    renderFrame(frame);

    if (rawProgress < 1) {
      state.animationFrame = requestAnimationFrame(tick);
      return;
    }

    state.animationFrame = null;
    renderFrame(nextPositions);
  }

  renderFrame(fromPositions);
  state.animationFrame = requestAnimationFrame(tick);
}

function setActivePerson(nodeId) {
  if (!getPersonById(nodeId) || state.activePersonId === nodeId) {
    return;
  }

  state.hoveredId = null;
  state.activePersonId = nodeId;
  renderFrame(state.positions);
  syncUrlState();
}

function addPerson(name, type) {
  const trimmedName = String(name || "").trim();
  const normalizedType = String(type || "").trim().toUpperCase();

  if (!trimmedName) {
    setMessage("Please enter a name before adding someone.", true);
    return false;
  }

  if (!parseMBTI(normalizedType)) {
    setMessage("Choose a valid MBTI type from the list.", true);
    return false;
  }

  const duplicate = state.people.some(
    (person) => person.name.toLowerCase() === trimmedName.toLowerCase()
  );

  if (duplicate) {
    setMessage("That name is already in the map. Try a different one.", true);
    return false;
  }

  const person = {
    id: String(state.nextId++),
    name: trimmedName,
    type: normalizedType
  };

  state.people.push(person);
  syncNodeInventory();

  const stageMetrics = getStageMetrics();
  state.positions[person.id] = {
    x: stageMetrics.width / 2,
    y: stageMetrics.height / 2 + 32
  };

  state.hoveredId = null;
  animateToPositions(generateCircularPositions(state.people));
  syncUrlState();
  void persistSharedState();
  setMessage(`${person.name} joined the map as ${person.type}.`);
  return true;
}

function removePerson(id) {
  if (!state.isAdmin) {
    setMessage("Only the group starter can remove people.", true);
    return;
  }

  if (id === state.defaultActivePersonId) {
    setMessage("The group starter cannot be removed from the map.", true);
    return;
  }

  const person = getPersonById(id);
  if (!person) {
    return;
  }

  state.people = state.people.filter((entry) => entry.id !== id);
  delete state.positions[id];
  syncNodeInventory();
  syncConnectionInventory();

  if (state.activePersonId === id) {
    state.activePersonId = state.defaultActivePersonId;
  }

  state.hoveredId = null;
  animateToPositions(generateCircularPositions(state.people));
  syncUrlState();
  void persistSharedState();
  setMessage(`${person.name} was removed from the group.`);
}

async function copyLink(includeAdminKey) {
  const link = buildAppUrl(includeAdminKey);

  try {
    await navigator.clipboard.writeText(link);
    setMessage(includeAdminKey ? "Admin link copied." : "Share link copied.");
  } catch {
    setMessage("Clipboard access is unavailable here. Copy the URL from the address bar instead.", true);
  }
}

function initialize() {
  loadStateFromUrl();
  syncNodeInventory();
  syncConnectionInventory();
  updateAdminUi();
  renderFrame(generateCircularPositions(state.people));
}

function handleResize() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
  renderFrame(generateCircularPositions(state.people));
}

layers.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const created = addPerson(layers.nameInput.value, layers.typeInput.value);
  if (created) {
    layers.form.reset();
    layers.typeInput.value = "";
    layers.labelToggle.checked = state.showLabels;
  }
});

layers.labelToggle.addEventListener("change", () => {
  state.showLabels = layers.labelToggle.checked;
  updateVisualState();
  syncUrlState();
});

layers.copyShareLink.addEventListener("click", () => {
  copyLink(false);
});

layers.copyAdminLink.addEventListener("click", () => {
  copyLink(true);
});

window.addEventListener("resize", handleResize);

await loadCompatibilityMatrix();
initialize();
if (await initializeCollaboration()) {
  await loadSharedStateFromSupabase();
  subscribeToSharedState();
}
