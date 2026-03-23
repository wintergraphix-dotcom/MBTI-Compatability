import {
  VALID_MBTI_TYPES,
  getCompatibilityFromMatrix,
  loadCompatibilityMatrix
} from "./src/lib/compatibility.js";

const INITIAL_PEOPLE = [
  { name: "Shav", type: "ENFJ" },
  { name: "Devish", type: "ENFJ" },
  { name: "Ray", type: "ISFP" },
  { name: "Adneel", type: "ENTP" },
  { name: "Nav", type: "INTP" },
  { name: "nesh", type: "ENFP" }
];

const DURATION = 460;
const APP_CONFIG = window.PERSONALITY_CHEMISTRY_CONFIG || {};

const DEFAULT_GROUP_SLUG = APP_CONFIG.defaultGroupSlug || "shavs-crew";
const DEFAULT_GROUP_NAME = APP_CONFIG.defaultGroupName || "Shav's crew";

const layers = {
  stage: document.getElementById("mapStage"),
  svg: document.getElementById("connectionsLayer"),
  labels: document.getElementById("labelsLayer"),
  nodes: document.getElementById("nodesLayer"),
  status: document.getElementById("statusCopy"),
  groupNameDisplay: document.getElementById("groupNameDisplay"),
  form: document.getElementById("personForm"),
  nameInput: document.getElementById("nameInput"),
  typeInput: document.getElementById("typeInput"),
  mbtiModeInputs: document.querySelectorAll('input[name="mbtiMode"]'),
  knowMbtiOption: document.getElementById("knowMbtiOption"),
  guessMbtiOption: document.getElementById("guessMbtiOption"),
  mbtiDropdownField: document.getElementById("mbtiDropdownField"),
  quickTester: document.getElementById("quickTester"),
  axisIe: document.getElementById("axisIe"),
  axisSn: document.getElementById("axisSn"),
  axisTf: document.getElementById("axisTf"),
  axisJp: document.getElementById("axisJp"),
  quickTypeResult: document.getElementById("quickTypeResult"),
  useQuickTypeButton: document.getElementById("useQuickTypeButton"),
  addButton: document.getElementById("addPersonButton"),
  formMessage: document.getElementById("formMessage"),
  adminBadge: document.getElementById("adminBadge"),
  adminHelper: document.getElementById("adminHelper"),
  memberPanel: document.getElementById("memberPanel"),
  memberList: document.getElementById("memberList"),
  copyShareLink: document.getElementById("copyShareLink"),
  copyAdminLink: document.getElementById("copyAdminLink"),
  mapEmptyState: document.getElementById("mapEmptyState"),
  toggleCreateGroup: document.getElementById("toggleCreateGroup"),
  createGroupForm: document.getElementById("createGroupForm"),
  groupNameInput: document.getElementById("groupNameInput"),
  starterNameInput: document.getElementById("starterNameInput"),
  starterTypeInput: document.getElementById("starterTypeInput"),
  createGroupButton: document.getElementById("createGroupButton"),
  createGroupMessage: document.getElementById("createGroupMessage")
};

const state = {
  groupId: "",
  groupSlug: DEFAULT_GROUP_SLUG,
  groupName: DEFAULT_GROUP_NAME,
  defaultActivePersonId: "",
  activePersonId: "",
  adminToken: "",
  isAdmin: false,
  people: [],
  hoveredId: null,
  positions: {},
  animationFrame: null
};

const collaboration = {
  enabled: false,
  client: null,
  channel: null,
  groupsTable: APP_CONFIG.supabaseGroupsTable || "chemistry_public_groups",
  membersTable: APP_CONFIG.supabaseMembersTable || "chemistry_group_members"
};

const nodeElements = new Map();
const connectionElements = new Map();
const quickAxisMap = [
  { input: "axisIe", letters: ["I", "E"] },
  { input: "axisSn", letters: ["S", "N"] },
  { input: "axisTf", letters: ["T", "F"] },
  { input: "axisJp", letters: ["J", "P"] }
];

function getSvgDefs() {
  let defs = layers.svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    layers.svg.prepend(defs);
  }
  return defs;
}

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

async function hashToken(token) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(token);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizePeople(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenNames = new Set();
  return input
    .map((person) => {
      const id = String(person?.id || "");
      const name = String(person?.name || "").trim();
      const type = String(person?.type || "").trim().toUpperCase();
      const isStarter = Boolean(person?.isStarter || person?.is_starter);

      if (!id || !name || !parseMBTI(type)) {
        return null;
      }

      const lowered = name.toLowerCase();
      if (seenNames.has(lowered)) {
        return null;
      }
      seenNames.add(lowered);

      return { id, name, type, isStarter };
    })
    .filter(Boolean);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getRequestedSlug() {
  const url = new URL(window.location.href);
  if (url.protocol === "file:") {
    return url.searchParams.get("group") || DEFAULT_GROUP_SLUG;
  }

  const match = url.pathname.match(/^\/g\/([^/]+)\/?$/);
  if (match) {
    return decodeURIComponent(match[1]);
  }

  return DEFAULT_GROUP_SLUG;
}

function getRequestedAdminToken() {
  return new URL(window.location.href).searchParams.get("admin") || "";
}

function getAdminStorageKey(slug) {
  return `personality-chemistry-admin:${slug}`;
}

function persistAdminToken(slug, token) {
  try {
    window.localStorage.setItem(getAdminStorageKey(slug), token);
  } catch {
    return;
  }
}

function getStoredAdminToken(slug) {
  try {
    return window.localStorage.getItem(getAdminStorageKey(slug)) || "";
  } catch {
    return "";
  }
}

function getGroupPath(slug) {
  if (slug === DEFAULT_GROUP_SLUG) {
    return "/";
  }
  return `/g/${encodeURIComponent(slug)}`;
}

function buildAppUrl(includeAdminToken = false, slug = state.groupSlug, adminTokenOverride = "") {
  const url = new URL(window.location.href);

  if (url.protocol === "file:") {
    url.searchParams.set("group", slug);
  } else {
    url.pathname = getGroupPath(slug);
  }

  url.searchParams.delete("data");

  const adminToken = adminTokenOverride || state.adminToken;

  if (includeAdminToken && adminToken) {
    url.searchParams.set("admin", adminToken);
  } else {
    url.searchParams.delete("admin");
  }

  return url.toString();
}

function syncUrlState() {
  const nextUrl = buildAppUrl(false);
  window.history.replaceState({}, "", nextUrl);
}

function getStageMetrics() {
  const rect = layers.stage.getBoundingClientRect();
  return {
    width: rect.width || 560,
    height: rect.height || 560
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

  nodes.forEach((node, ringIndex) => {
    const angle = startAngle + ringIndex * angleStep;
    positions[node.id] = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle
    };
  });

  return positions;
}

function setMessage(message, isError = false, target = layers.formMessage) {
  target.textContent = message;
  target.style.color = isError ? "#FF4D4F" : "#72757e";
}

function setButtonBusy(isBusy) {
  layers.addButton.disabled = isBusy;
  layers.addButton.textContent = isBusy ? "Adding..." : "Add to circle";
}

function setCreateGroupBusy(isBusy) {
  layers.createGroupButton.disabled = isBusy;
  layers.createGroupButton.textContent = isBusy ? "Creating..." : "Create group";
}

function updateFormState() {
  const hasName = layers.nameInput.value.trim().length > 0;
  const hasType = layers.typeInput.value.trim().length > 0;
  layers.addButton.disabled = !(hasName && hasType);
}

function getSelectedMbtiMode() {
  const selected = Array.from(layers.mbtiModeInputs).find((input) => input.checked);
  return selected ? selected.value : "known";
}

function calculateQuickType() {
  return quickAxisMap
    .map(({ input, letters }) => {
      const value = Number(layers[input].value || 0);
      return value >= 0 ? letters[1] : letters[0];
    })
    .join("");
}

function updateQuickTypePreview() {
  const estimatedType = calculateQuickType();
  layers.quickTypeResult.textContent = estimatedType;
  return estimatedType;
}

function syncMbtiModeUi() {
  const mode = getSelectedMbtiMode();
  const isKnown = mode === "known";

  layers.knowMbtiOption.classList.toggle("is-selected", isKnown);
  layers.guessMbtiOption.classList.toggle("is-selected", !isKnown);
  layers.mbtiDropdownField.classList.toggle("is-hidden", !isKnown);
  layers.quickTester.classList.toggle("is-hidden", isKnown);

  if (!isKnown && !layers.typeInput.value) {
    layers.typeInput.value = updateQuickTypePreview();
  }

  updateFormState();
}

function updateCreateGroupState() {
  const hasGroupName = layers.groupNameInput.value.trim().length > 0;
  const hasStarterName = layers.starterNameInput.value.trim().length > 0;
  const hasStarterType = layers.starterTypeInput.value.trim().length > 0;
  layers.createGroupButton.disabled = !(hasGroupName && hasStarterName && hasStarterType);
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
  path.setAttribute("class", "connection-line");

  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", `connection-gradient-${id}`);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  const stopA = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stopA.setAttribute("offset", "0%");
  const stopB = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stopB.setAttribute("offset", "55%");
  const stopC = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stopC.setAttribute("offset", "100%");
  gradient.append(stopA, stopB, stopC);
  getSvgDefs().appendChild(gradient);

  group.append(path);
  layers.svg.appendChild(group);

  const pill = document.createElement("div");
  pill.className = "connection-pill";
  layers.labels.appendChild(pill);

  const elementSet = { group, path, pill, gradient, stops: [stopA, stopB, stopC] };
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
      elements.gradient.remove();
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

    if (person.isStarter && state.isAdmin) {
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
      removeButton.disabled = state.people.length <= 1 || person.isStarter;
      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void removePerson(person.id);
      });
      actions.appendChild(removeButton);
    }

    layers.memberList.appendChild(card);
  });
}

function updateAdminUi() {
  layers.groupNameDisplay.textContent = state.groupName;
  layers.adminBadge.textContent = state.isAdmin ? "Starter view" : "Shared view";
  layers.adminBadge.classList.toggle("is-viewer", !state.isAdmin);
  layers.adminHelper.textContent = state.isAdmin
    ? "Tap anyone below to steer the circle. You can also tidy the guest list if needed."
    : "Everyone can tap around the map. Only the starter gets the private admin view.";
  layers.memberPanel.classList.toggle("is-hidden", !state.isAdmin);
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
    startX: startPoint.x,
    startY: startPoint.y,
    endX: endPoint.x,
    endY: endPoint.y,
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
    if (compatibility.gradient) {
      connection.gradient.setAttribute("x1", String(geometry.startX));
      connection.gradient.setAttribute("y1", String(geometry.startY));
      connection.gradient.setAttribute("x2", String(geometry.endX));
      connection.gradient.setAttribute("y2", String(geometry.endY));
      connection.stops.forEach((stop, stopIndex) => {
        stop.setAttribute("stop-color", compatibility.gradient[stopIndex] || compatibility.color);
      });
      connection.path.setAttribute("stroke", `url(#${connection.gradient.id})`);
    } else {
      connection.path.setAttribute("stroke", compatibility.color);
    }
    connection.path.setAttribute(
      "stroke-width",
      String(compatibility.width + compatibility.score * 0.12)
    );
    connection.pill.style.display = isSmallViewport ? "none" : "";
    connection.pill.textContent = `${compatibility.label} · ${compatibility.score}/9`;
    connection.pill.style.left = `${geometry.labelX}px`;
    connection.pill.style.top = `${geometry.labelY}px`;
  });
}

function renderFrame(positions) {
  state.positions = positions;

  state.people.forEach((person) => {
    const node = nodeElements.get(person.id);
    const position = positions[person.id];
    if (!node || !position) {
      return;
    }

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
    if (!node) {
      return;
    }

    const isActive = person.id === state.activePersonId;
    const isHovered = person.id === state.hoveredId;
    const shouldDim = state.hoveredId !== null && !isActive && !isHovered;

    node.classList.toggle("is-hovered", isHovered);
    node.classList.toggle("is-dimmed", shouldDim);
  });

  connectionElements.forEach((elements, id) => {
    const person = getPersonById(id);
    if (!person || !activePerson || id === state.activePersonId) {
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

  if (state.activePersonId === state.defaultActivePersonId) {
    layers.status.textContent = `${activePerson.name}'s chemistry with ${state.groupName}`;
    return;
  }

  layers.status.textContent = `Now viewing ${activePerson.name}'s chemistry with ${state.groupName}`;
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
}

function applySnapshot(group, members, { animate = true, adminToken = "", isAdmin = false } = {}) {
  const people = sanitizePeople(members);
  const defaultActiveExists = people.some((person) => person.id === group.default_active_person_id);
  const previousActiveStillExists = people.some((person) => person.id === state.activePersonId);

  state.groupId = String(group.id);
  state.groupSlug = String(group.slug);
  state.groupName = String(group.name);
  state.people = people;
  state.defaultActivePersonId = defaultActiveExists
    ? String(group.default_active_person_id)
    : people[0]?.id || "";
  state.activePersonId = previousActiveStillExists
    ? state.activePersonId
    : state.defaultActivePersonId;
  state.adminToken = adminToken;
  state.isAdmin = isAdmin;

  if (state.isAdmin && state.adminToken) {
    persistAdminToken(state.groupSlug, state.adminToken);
  }

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

async function fetchGroupBySlug(slug) {
  const { data, error } = await collaboration.client
    .from(collaboration.groupsTable)
    .select("id, slug, name, admin_key_hash, default_active_person_id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.warn("Group read failed.", error);
    return null;
  }

  return data;
}

async function fetchGroupMembers(groupId) {
  const { data, error } = await collaboration.client
    .from(collaboration.membersTable)
    .select("id, name, type, is_starter, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("Group members read failed.", error);
    return [];
  }

  return data || [];
}

function getMembersSignature(members) {
  return members
    .map((member) => `${String(member.name).toLowerCase()}::${String(member.type).toUpperCase()}`)
    .sort()
    .join("|");
}

async function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let index = 2;

  while (true) {
    const existing = await fetchGroupBySlug(slug);
    if (!existing) {
      return slug;
    }
    slug = `${baseSlug}-${index}`;
    index += 1;
  }
}

async function createGroupRecord({ name, slug, adminToken, seedPeople }) {
  const adminKeyHash = await hashToken(adminToken);
  const { data: groupRow, error: groupError } = await collaboration.client
    .from(collaboration.groupsTable)
    .insert({
      slug,
      name,
      admin_key_hash: adminKeyHash
    })
    .select("id, slug, name, admin_key_hash, default_active_person_id")
    .single();

  if (groupError) {
    throw groupError;
  }

  const membersPayload = seedPeople.map((person, index) => ({
    group_id: groupRow.id,
    name: person.name,
    type: person.type,
    is_starter: index === 0
  }));

  const { data: members, error: membersError } = await collaboration.client
    .from(collaboration.membersTable)
    .insert(membersPayload)
    .select("id, name, type, is_starter, created_at");

  if (membersError) {
    throw membersError;
  }

  const starter = members[0];
  const { data: updatedGroup, error: updateError } = await collaboration.client
    .from(collaboration.groupsTable)
    .update({
      default_active_person_id: starter.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", groupRow.id)
    .select("id, slug, name, admin_key_hash, default_active_person_id")
    .single();

  if (updateError) {
    throw updateError;
  }

  return {
    group: updatedGroup,
    members
  };
}

async function syncDefaultGroupSeed(group) {
  const existingMembers = await fetchGroupMembers(group.id);
  const existingSignature = getMembersSignature(existingMembers);
  const desiredSignature = [...INITIAL_PEOPLE]
    .map((person) => `${person.name.toLowerCase()}::${person.type}`)
    .sort()
    .join("|");
  const starterMember = existingMembers.find((member) => member.is_starter);
  const shavMember = existingMembers.find((member) => member.name.toLowerCase() === "shav");
  const needsSync =
    existingSignature !== desiredSignature ||
    !shavMember ||
    !starterMember ||
    starterMember.name.toLowerCase() !== "shav";

  if (!needsSync) {
    if (group.default_active_person_id !== shavMember.id) {
      await collaboration.client
        .from(collaboration.groupsTable)
        .update({
          default_active_person_id: shavMember.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", group.id);
    }
    return;
  }

  const existingIds = existingMembers.map((member) => member.id);
  if (existingIds.length) {
    const { error: deleteError } = await collaboration.client
      .from(collaboration.membersTable)
      .delete()
      .in("id", existingIds);

    if (deleteError) {
      throw deleteError;
    }
  }

  const { data: insertedMembers, error: insertError } = await collaboration.client
    .from(collaboration.membersTable)
    .insert(
      INITIAL_PEOPLE.map((person, index) => ({
        group_id: group.id,
        name: person.name,
        type: person.type,
        is_starter: index === 0
      }))
    )
    .select("id, name, type, is_starter, created_at");

  if (insertError) {
    throw insertError;
  }

  const shavSeed = insertedMembers.find((member) => member.name.toLowerCase() === "shav");
  if (!shavSeed) {
    return;
  }

  const { error: updateGroupError } = await collaboration.client
    .from(collaboration.groupsTable)
    .update({
      default_active_person_id: shavSeed.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", group.id);

  if (updateGroupError) {
    throw updateGroupError;
  }
}

async function ensureDefaultGroupExists() {
  const existing = await fetchGroupBySlug(DEFAULT_GROUP_SLUG);
  if (existing) {
    await syncDefaultGroupSeed(existing);
    return existing;
  }

  const adminToken = createToken();
  const { group } = await createGroupRecord({
    name: DEFAULT_GROUP_NAME,
    slug: DEFAULT_GROUP_SLUG,
    adminToken,
    seedPeople: INITIAL_PEOPLE
  });

  persistAdminToken(DEFAULT_GROUP_SLUG, adminToken);
  return group;
}

async function loadGroupSnapshot(slug, requestedAdminToken = "") {
  if (!collaboration.enabled || !collaboration.client) {
    return false;
  }

  if (slug === DEFAULT_GROUP_SLUG) {
    await ensureDefaultGroupExists();
  }

  const group = await fetchGroupBySlug(slug);
  if (!group) {
    setMessage("That group couldn't be found. Starting with Shav's crew instead.", true);
    if (slug !== DEFAULT_GROUP_SLUG) {
      await ensureDefaultGroupExists();
      const fallbackGroup = await fetchGroupBySlug(DEFAULT_GROUP_SLUG);
      const fallbackMembers = fallbackGroup ? await fetchGroupMembers(fallbackGroup.id) : [];
      const storedFallbackToken = getStoredAdminToken(DEFAULT_GROUP_SLUG);
      const fallbackHash = storedFallbackToken ? await hashToken(storedFallbackToken) : "";
      if (fallbackGroup) {
        applySnapshot(fallbackGroup, fallbackMembers, {
          animate: false,
          adminToken:
            fallbackHash && fallbackHash === fallbackGroup.admin_key_hash ? storedFallbackToken : "",
          isAdmin: fallbackHash && fallbackHash === fallbackGroup.admin_key_hash
        });
        return true;
      }
    }
    return false;
  }

  const members = await fetchGroupMembers(group.id);
  const storedAdminToken = getStoredAdminToken(group.slug);
  const candidateToken = requestedAdminToken || storedAdminToken;
  let isAdmin = false;
  let validAdminToken = "";

  if (candidateToken) {
    const candidateHash = await hashToken(candidateToken);
    isAdmin = candidateHash === group.admin_key_hash;
    validAdminToken = isAdmin ? candidateToken : "";
  }

  applySnapshot(group, members, {
    animate: false,
    adminToken: validAdminToken,
    isAdmin
  });

  return true;
}

async function refreshCurrentGroup({ animate = true } = {}) {
  if (!collaboration.enabled || !collaboration.client || !state.groupSlug) {
    return;
  }

  const group = await fetchGroupBySlug(state.groupSlug);
  if (!group) {
    return;
  }

  const members = await fetchGroupMembers(group.id);
  const storedAdminToken = state.adminToken || getStoredAdminToken(group.slug);
  let isAdmin = false;
  let validAdminToken = "";

  if (storedAdminToken) {
    const tokenHash = await hashToken(storedAdminToken);
    isAdmin = tokenHash === group.admin_key_hash;
    validAdminToken = isAdmin ? storedAdminToken : "";
  }

  applySnapshot(group, members, {
    animate,
    adminToken: validAdminToken,
    isAdmin
  });
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
        table: collaboration.groupsTable,
        filter: `id=eq.${state.groupId}`
      },
      () => {
        void refreshCurrentGroup();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: collaboration.membersTable,
        filter: `group_id=eq.${state.groupId}`
      },
      () => {
        void refreshCurrentGroup();
      }
    )
    .subscribe();
}

async function addPerson(name, type) {
  const trimmedName = String(name || "").trim();
  const normalizedType = String(type || "").trim().toUpperCase();

  setButtonBusy(true);

  if (!trimmedName) {
    setButtonBusy(false);
    updateFormState();
    setMessage("Add a name first.", true);
    return false;
  }

  if (!parseMBTI(normalizedType)) {
    setButtonBusy(false);
    updateFormState();
    setMessage("Choose an MBTI type from the list.", true);
    return false;
  }

  const duplicate = state.people.some(
    (person) => person.name.toLowerCase() === trimmedName.toLowerCase()
  );

  if (duplicate) {
    setButtonBusy(false);
    updateFormState();
    setMessage("That name is already in this group.", true);
    return false;
  }

  if (!collaboration.enabled || !state.groupId) {
    setButtonBusy(false);
    updateFormState();
    setMessage("Live group saving isn't ready right now.", true);
    return false;
  }

  const { error } = await collaboration.client.from(collaboration.membersTable).insert({
    group_id: state.groupId,
    name: trimmedName,
    type: normalizedType
  });

  if (error) {
    console.warn("Add member failed.", error);
    setButtonBusy(false);
    updateFormState();
    setMessage("Couldn't add that person right now. Try again in a moment.", true);
    return false;
  }

  await refreshCurrentGroup();
  setButtonBusy(false);
  updateFormState();
  setMessage(`${trimmedName} joined ${state.groupName}.`);
  return true;
}

async function removePerson(id) {
  if (!state.isAdmin) {
    setMessage("Only the group starter can remove people.", true);
    return;
  }

  const person = getPersonById(id);
  if (!person) {
    return;
  }

  if (person.isStarter) {
    setMessage("The starter stays in the circle.", true);
    return;
  }

  const { error } = await collaboration.client
    .from(collaboration.membersTable)
    .delete()
    .eq("id", id);

  if (error) {
    console.warn("Remove member failed.", error);
    setMessage("Couldn't remove that person right now. Try again in a moment.", true);
    return;
  }

  await refreshCurrentGroup();
  setMessage(`${person.name} was removed from ${state.groupName}.`);
}

async function copyLink(includeAdminToken) {
  const link = buildAppUrl(includeAdminToken);

  try {
    await navigator.clipboard.writeText(link);
    setMessage(includeAdminToken ? "Admin link copied." : "Share link copied.");
  } catch {
    setMessage("Copying is unavailable here, so use the address bar instead.", true);
  }
}

async function createOwnGroup(groupName, starterName, starterType) {
  const trimmedGroupName = String(groupName || "").trim();
  const trimmedStarterName = String(starterName || "").trim();
  const normalizedStarterType = String(starterType || "").trim().toUpperCase();

  setCreateGroupBusy(true);

  if (!trimmedGroupName || !trimmedStarterName || !parseMBTI(normalizedStarterType)) {
    setCreateGroupBusy(false);
    updateCreateGroupState();
    setMessage("Fill out the three fields to start your group.", true, layers.createGroupMessage);
    return;
  }

  if (!collaboration.enabled || !collaboration.client) {
    setCreateGroupBusy(false);
    updateCreateGroupState();
    setMessage("Group creation isn't available right now.", true, layers.createGroupMessage);
    return;
  }

  const baseSlug = slugify(trimmedGroupName) || `group-${Date.now()}`;
  const slug = await ensureUniqueSlug(baseSlug);
  const adminToken = createToken();

  try {
    await createGroupRecord({
      name: trimmedGroupName,
      slug,
      adminToken,
      seedPeople: [{ name: trimmedStarterName, type: normalizedStarterType }]
    });
    persistAdminToken(slug, adminToken);
    setMessage("Your new group is ready. Opening your admin view…", false, layers.createGroupMessage);
    window.location.assign(buildAppUrl(true, slug, adminToken).replace(/\?$/, ""));
  } catch (error) {
    console.warn("Create group failed.", error);
    setCreateGroupBusy(false);
    updateCreateGroupState();
    setMessage("Couldn't create your group just yet. Try again in a moment.", true, layers.createGroupMessage);
  }
}

function initializeLocalFallback() {
  const fallbackPeople = INITIAL_PEOPLE.map((person, index) => ({
    id: String(index + 1),
    name: person.name,
    type: person.type,
    isStarter: index === 0
  }));

  state.groupId = "local-default";
  state.groupSlug = DEFAULT_GROUP_SLUG;
  state.groupName = DEFAULT_GROUP_NAME;
  state.people = fallbackPeople;
  state.defaultActivePersonId = fallbackPeople[0].id;
  state.activePersonId = fallbackPeople[0].id;
  state.isAdmin = true;

  syncNodeInventory();
  syncConnectionInventory();
  updateAdminUi();
  renderFrame(generateCircularPositions(state.people));
  syncUrlState();
}

function handleResize() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
  applyResponsiveMapSizing();
  renderFrame(generateCircularPositions(state.people));
}

async function initialize() {
  await loadCompatibilityMatrix();

  if (!(await initializeCollaboration())) {
    initializeLocalFallback();
    updateFormState();
    updateCreateGroupState();
    return;
  }

  const loaded = await loadGroupSnapshot(getRequestedSlug(), getRequestedAdminToken());
  if (!loaded) {
    initializeLocalFallback();
  }
  subscribeToSharedState();
  updateFormState();
  updateCreateGroupState();
}

layers.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const created = await addPerson(layers.nameInput.value, layers.typeInput.value);
  if (created) {
    layers.form.reset();
    layers.typeInput.value = "";
    const defaultMode = layers.mbtiModeInputs[0];
    if (defaultMode) {
      defaultMode.checked = true;
    }
    [layers.axisIe, layers.axisSn, layers.axisTf, layers.axisJp].forEach((input) => {
      input.value = "0";
    });
    updateQuickTypePreview();
    syncMbtiModeUi();
    layers.nameInput.focus();
    updateFormState();
  }
});

layers.nameInput.addEventListener("input", updateFormState);
layers.typeInput.addEventListener("change", updateFormState);
layers.mbtiModeInputs.forEach((input) => {
  input.addEventListener("change", syncMbtiModeUi);
});

[layers.axisIe, layers.axisSn, layers.axisTf, layers.axisJp].forEach((input) => {
  input.addEventListener("input", () => {
    const estimatedType = updateQuickTypePreview();
    if (getSelectedMbtiMode() === "guided") {
      layers.typeInput.value = estimatedType;
      updateFormState();
    }
  });
});

layers.useQuickTypeButton.addEventListener("click", () => {
  layers.typeInput.value = updateQuickTypePreview();
  setMessage(`Using ${layers.typeInput.value} as the best-guess type.`);
  updateFormState();
});

layers.copyShareLink.addEventListener("click", () => {
  void copyLink(false);
});

layers.copyAdminLink.addEventListener("click", () => {
  void copyLink(true);
});

layers.toggleCreateGroup.addEventListener("click", () => {
  layers.createGroupForm.classList.toggle("is-hidden");
  if (!layers.createGroupForm.classList.contains("is-hidden")) {
    layers.groupNameInput.focus();
  }
});

layers.groupNameInput.addEventListener("input", updateCreateGroupState);
layers.starterNameInput.addEventListener("input", updateCreateGroupState);
layers.starterTypeInput.addEventListener("change", updateCreateGroupState);

layers.createGroupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createOwnGroup(
    layers.groupNameInput.value,
    layers.starterNameInput.value,
    layers.starterTypeInput.value
  );
});

window.addEventListener("resize", handleResize);

await initialize();
updateQuickTypePreview();
syncMbtiModeUi();
