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
  labels: document.getElementById("labelsLayer"),
  nodes: document.getElementById("nodesLayer"),
  status: document.getElementById("statusCopy"),
  form: document.getElementById("personForm"),
  nameInput: document.getElementById("nameInput"),
  typeInput: document.getElementById("typeInput"),
  addButton: document.getElementById("addPersonButton"),
  formMessage: document.getElementById("formMessage"),
  adminBadge: document.getElementById("adminBadge"),
  adminHelper: document.getElementById("adminHelper"),
  memberList: document.getElementById("memberList"),
  copyShareLink: document.getElementById("copyShareLink"),
  copyAdminLink: document.getElementById("copyAdminLink"),
  mapEmptyState: document.getElementById("mapEmptyState")
};

const state = {
  people: INITIAL_PEOPLE.map((person) => ({ ...person })),
  defaultActivePersonId: DEFAULT_ACTIVE_ID,
  activePersonId: DEFAULT_ACTIVE_ID,
  hoveredId: null,
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
  const nextUrl = buildAppUrl(false);
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

function getResponsiveLayout() {
  const viewportWidth = window.innerWidth;
  const mapSize = Math.max(280, Math.min(viewportWidth - 32, 560));

  if (viewportWidth < 390) {
    return {
      viewportWidth,
      mapSize,
      nodeDiameter: 60,
      activeDiameter: 76,
      nodeNameSize: "0.7rem",
      activeNodeNameSize: "0.8rem",
      nodeTypeSize: "0.56rem",
      nodePadding: "9px",
      pillFontSize: "0.68rem",
      pillPaddingY: "6px",
      pillPaddingX: "8px"
    };
  }

  if (viewportWidth < 500) {
    return {
      viewportWidth,
      mapSize,
      nodeDiameter: 68,
      activeDiameter: 84,
      nodeNameSize: "0.76rem",
      activeNodeNameSize: "0.86rem",
      nodeTypeSize: "0.6rem",
      nodePadding: "10px",
      pillFontSize: "0.72rem",
      pillPaddingY: "6px",
      pillPaddingX: "9px"
    };
  }

  if (viewportWidth < 700) {
    return {
      viewportWidth,
      mapSize,
      nodeDiameter: 82,
      activeDiameter: 102,
      nodeNameSize: "0.82rem",
      activeNodeNameSize: "0.94rem",
      nodeTypeSize: "0.64rem",
      nodePadding: "11px",
      pillFontSize: "0.74rem",
      pillPaddingY: "7px",
      pillPaddingX: "10px"
    };
  }

  if (viewportWidth <= 900) {
    return {
      viewportWidth,
      mapSize,
      nodeDiameter: 96,
      activeDiameter: 116,
      nodeNameSize: "0.9rem",
      activeNodeNameSize: "1rem",
      nodeTypeSize: "0.68rem",
      nodePadding: "12px",
      pillFontSize: "0.78rem",
      pillPaddingY: "7px",
      pillPaddingX: "11px"
    };
  }

  return {
    viewportWidth,
    mapSize,
    nodeDiameter: 112,
    activeDiameter: 132,
    nodeNameSize: "0.94rem",
    activeNodeNameSize: "1.04rem",
    nodeTypeSize: "0.7rem",
    nodePadding: "14px",
    pillFontSize: "0.83rem",
    pillPaddingY: "8px",
    pillPaddingX: "12px"
  };
}

function applyResponsiveMapSizing() {
  const layout = getResponsiveLayout();

  layers.stage.style.width = `${layout.mapSize}px`;
  layers.stage.style.height = `${layout.mapSize}px`;
  document.documentElement.style.setProperty("--node-size", `${layout.nodeDiameter}px`);
  document.documentElement.style.setProperty("--active-node-size", `${layout.activeDiameter}px`);
  document.documentElement.style.setProperty("--node-name-size", layout.nodeNameSize);
  document.documentElement.style.setProperty("--active-node-name-size", layout.activeNodeNameSize);
  document.documentElement.style.setProperty("--node-type-size", layout.nodeTypeSize);
  document.documentElement.style.setProperty("--node-padding", layout.nodePadding);
  document.documentElement.style.setProperty("--pill-font-size", layout.pillFontSize);
  document.documentElement.style.setProperty("--pill-padding-y", layout.pillPaddingY);
  document.documentElement.style.setProperty("--pill-padding-x", layout.pillPaddingX);

  return layout;
}

function generateCircularPositions(nodes) {
  const layout = applyResponsiveMapSizing();
  const metrics = getStageMetrics();
  const center = { x: metrics.width / 2, y: metrics.height / 2 };
  let radius = layout.mapSize / 2 - layout.activeDiameter / 2 - 24;
  if (layout.viewportWidth < 500) {
    radius -= 8;
  }
  const minRadius = Math.max(72, layout.nodeDiameter);
  const maxRadius = Math.max(minRadius, layout.mapSize / 2 - layout.activeDiameter / 2 - 12);
  radius = Math.max(minRadius, Math.min(radius, maxRadius));
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

function setButtonBusy(isBusy) {
  layers.addButton.disabled = isBusy;
  layers.addButton.textContent = isBusy ? "Adding..." : "Add to circle";
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

  group.append(path);
  layers.svg.appendChild(group);

  const pill = document.createElement("div");
  pill.className = "connection-pill";
  layers.labels.appendChild(pill);

  const elementSet = { group, path, pill };
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
      elements.pill.remove();
      connectionElements.delete(id);
    }
  });
}

function renderMemberList() {
  layers.memberList.innerHTML = "";

  state.people.forEach((person) => {
    const card = document.createElement("div");
    card.className = "member-card";
    card.dataset.id = person.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Show ${person.name}'s chemistry`);
    card.innerHTML = `
      <div class="member-meta">
        <span class="member-name">${person.name}</span>
        <span class="member-type">${person.type}</span>
      </div>
      <div class="member-actions"></div>
    `;

    card.classList.toggle("is-active", person.id === state.activePersonId);
    card.classList.toggle(
      "is-dimmed",
      state.hoveredId !== null && person.id !== state.hoveredId && person.id !== state.activePersonId
    );
    card.addEventListener("click", () => {
      if (state.activePersonId !== person.id) {
        setActivePerson(person.id);
      }
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (state.activePersonId !== person.id) {
          setActivePerson(person.id);
        }
      }
    });

    const actions = card.querySelector(".member-actions");

    if (person.id === state.defaultActivePersonId && state.isAdmin) {
      const starter = document.createElement("span");
      starter.className = "member-pill";
      starter.textContent = "Starter";
      actions.appendChild(starter);
    }

    if (person.id === state.activePersonId) {
      const active = document.createElement("span");
      active.className = "member-pill";
      active.textContent = "Active";
      actions.appendChild(active);
    }

    if (state.isAdmin) {
      const removeButton = document.createElement("button");
      removeButton.className = "remove-button";
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${person.name}`);
      removeButton.disabled = state.people.length <= 1 || person.id === state.defaultActivePersonId;
      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        removePerson(person.id);
      });
      actions.appendChild(removeButton);
    }

    layers.memberList.appendChild(card);
  });
}

function updateAdminUi() {
  layers.adminBadge.textContent = state.isAdmin ? "Starter view" : "Shared view";
  layers.adminBadge.classList.toggle("is-viewer", !state.isAdmin);
  layers.adminHelper.textContent = state.isAdmin
    ? "Tap anyone below to steer the circle. You can also tidy the guest list if needed."
    : "Tap anyone below to see their chemistry with the rest of the group.";
  layers.copyAdminLink.style.display = state.isAdmin ? "" : "none";
  renderMemberList();
}

function getConnectionGeometry(fromPoint, toPoint, index) {
  const layout = getResponsiveLayout();
  const { nodeDiameter, activeDiameter, viewportWidth } = layout;
  const deltaX = toPoint.x - fromPoint.x;
  const deltaY = toPoint.y - fromPoint.y;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const startPoint = {
    x: fromPoint.x + unitX * (activeDiameter / 2),
    y: fromPoint.y + unitY * (activeDiameter / 2)
  };
  const endPoint = {
    x: toPoint.x - unitX * (nodeDiameter / 2),
    y: toPoint.y - unitY * (nodeDiameter / 2)
  };
  const trimmedDeltaX = endPoint.x - startPoint.x;
  const trimmedDeltaY = endPoint.y - startPoint.y;
  const trimmedDistance = Math.hypot(trimmedDeltaX, trimmedDeltaY) || 1;
  const controlOffset = Math.min(28, trimmedDistance * 0.08);
  const normalX = (-trimmedDeltaY / trimmedDistance) * controlOffset;
  const normalY = (trimmedDeltaX / trimmedDistance) * controlOffset;
  const controlX = (startPoint.x + endPoint.x) / 2 + normalX;
  const controlY = (startPoint.y + endPoint.y) / 2 + normalY;
  const labelLiftBase = viewportWidth < 500 ? 22 : 28;
  const labelLiftStep = viewportWidth < 500 ? 9 : 12;
  const labelLift = labelLiftBase + (index % 3) * labelLiftStep;
  const normalUnitX = controlOffset === 0 ? 0 : normalX / controlOffset;
  const normalUnitY = controlOffset === 0 ? 0 : normalY / controlOffset;
  const labelX =
    0.25 * startPoint.x + 0.5 * controlX + 0.25 * endPoint.x + normalUnitX * labelLift;
  const labelY =
    0.25 * startPoint.y + 0.5 * controlY + 0.25 * endPoint.y + normalUnitY * labelLift;
  const inset = viewportWidth < 500 ? 22 : 28;
  const clampedLabelX = Math.max(inset, Math.min(labelX, layout.mapSize - inset));
  const clampedLabelY = Math.max(inset, Math.min(labelY, layout.mapSize - inset));

  return {
    pathData: `M ${startPoint.x} ${startPoint.y} Q ${controlX} ${controlY} ${endPoint.x} ${endPoint.y}`,
    labelX: clampedLabelX,
    labelY: clampedLabelY
  };
}

function renderConnectionsFromActivePerson(activePersonId, positions) {
  const tooSmallForMap = state.people.length < 2;
  layers.mapEmptyState.classList.toggle("is-visible", tooSmallForMap);
  const isSmallViewport = window.innerWidth < 500;

  const activePerson = getPersonById(activePersonId);
  const activePosition = positions[activePersonId];

  connectionElements.forEach((elements) => {
    elements.group.style.display = "none";
    elements.pill.style.display = "none";
  });

  if (!activePerson || tooSmallForMap) {
    return;
  }

  state.people.forEach((person, index) => {
    if (person.id === activePersonId) {
      return;
    }

    const position = positions[person.id];
    const connection = ensureConnection(person.id);
    const compatibility = getCompatibilityFromMatrix(activePerson.type, person.type);
    const geometry = getConnectionGeometry(activePosition, position, index);

    connection.group.style.display = "";
    connection.path.setAttribute("d", geometry.pathData);
    connection.path.setAttribute("stroke", compatibility.color);
    connection.path.setAttribute(
      "stroke-width",
      String(compatibility.width + compatibility.score * 0.12)
    );
    connection.path.setAttribute("data-reason", compatibility.reason || "");
    connection.pill.style.display = "";
    connection.pill.textContent = `${compatibility.label} · ${compatibility.score}/9`;
    connection.pill.dataset.compact = String(isSmallViewport);
    connection.pill.style.left = `${geometry.labelX}px`;
    connection.pill.style.top = `${geometry.labelY}px`;
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
    elements.pill.classList.toggle("is-dimmed", shouldDim);
    elements.path.style.strokeWidth = `${
      isHovered
        ? compatibility.width + compatibility.score * 0.12 + 2
        : compatibility.width + compatibility.score * 0.12
    }`;
    elements.path.style.filter = isHovered ? "drop-shadow(0 0 8px rgba(17,24,39,0.18))" : "none";
    elements.pill.style.boxShadow = isHovered
      ? "0 14px 28px rgba(15, 23, 42, 0.12)"
      : "0 10px 24px rgba(15, 23, 42, 0.08)";
  });

  if (!activePerson) {
    layers.status.textContent = "Add at least 2 people to see the chemistry circle.";
    return;
  }

  layers.status.textContent = `Now viewing ${activePerson.name}'s chemistry with the group`;
  if (state.activePersonId === state.defaultActivePersonId) {
    layers.status.textContent = `${activePerson.name}'s chemistry with the group`;
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

  setButtonBusy(true);

  if (!trimmedName) {
    setButtonBusy(false);
    setMessage("Add a name first.", true);
    return false;
  }

  if (!parseMBTI(normalizedType)) {
    setButtonBusy(false);
    setMessage("Choose an MBTI type from the list.", true);
    return false;
  }

  const duplicate = state.people.some(
    (person) => person.name.toLowerCase() === trimmedName.toLowerCase()
  );

  if (duplicate) {
    setButtonBusy(false);
    setMessage("That name is already in the circle.", true);
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
  setButtonBusy(false);
  setMessage(`${person.name} joined the circle.`);
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
  setMessage(`${person.name} was removed from the circle.`);
}

async function copyLink(includeAdminKey) {
  const link = buildAppUrl(includeAdminKey);

  try {
    await navigator.clipboard.writeText(link);
    setMessage(includeAdminKey ? "Admin link copied." : "Share link copied.");
  } catch {
    setMessage("Copying is unavailable here, so use the address bar instead.", true);
  }
}

function initialize() {
  loadStateFromUrl();
  applyResponsiveMapSizing();
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
  applyResponsiveMapSizing();
  renderFrame(generateCircularPositions(state.people));
}

layers.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const created = addPerson(layers.nameInput.value, layers.typeInput.value);
  if (created) {
    layers.form.reset();
    layers.typeInput.value = "";
    layers.nameInput.focus();
  }
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
