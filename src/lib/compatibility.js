const DATA_URL = new URL("../data/mbtiCompatibility.json", import.meta.url);

export const TYPE_ORDER = [
  "INTJ",
  "INTP",
  "ENTJ",
  "ENTP",
  "INFJ",
  "INFP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISFJ",
  "ESTJ",
  "ESFJ",
  "ISTP",
  "ISFP",
  "ESTP",
  "ESFP"
];

export const VALID_MBTI_TYPES = new Set(TYPE_ORDER);

const warnedPairs = new Set();
let compatibilityData = null;
let compatibilityPromise = null;

function isDevEnvironment() {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.protocol === "file:"
  );
}

function warnOnce(message) {
  if (!isDevEnvironment() || warnedPairs.has(message)) {
    return;
  }

  warnedPairs.add(message);
  console.warn(message);
}

function getCompatibilityLevel(score) {
  if (score <= 2) {
    return { label: "Disaster", color: "#FF4D4F", width: 3.25 };
  }
  if (score <= 4) {
    return { label: "Strained", color: "#FF7A45", width: 4.25 };
  }
  if (score <= 6) {
    return { label: "Neutral", color: "#F5A623", width: 5.25 };
  }
  if (score <= 8) {
    return { label: "Strong", color: "#73D13D", width: 6.25 };
  }
  return {
    label: "Elite",
    color: "#2F9E2F",
    width: 7.25,
    gradient: ["#1F7A1F", "#2F9E2F", "#6FCD46"]
  };
}

function sanitizeType(type) {
  const cleaned = String(type || "").trim().toUpperCase();
  return VALID_MBTI_TYPES.has(cleaned) ? cleaned : null;
}

function getPairIndices(typeA, typeB) {
  const firstType = sanitizeType(typeA);
  const secondType = sanitizeType(typeB);

  if (!firstType || !secondType) {
    return null;
  }

  const firstIndex = TYPE_ORDER.indexOf(firstType);
  const secondIndex = TYPE_ORDER.indexOf(secondType);

  if (firstIndex === -1 || secondIndex === -1) {
    return null;
  }

  return firstIndex <= secondIndex
    ? { firstType, secondType, minIndex: firstIndex, maxIndex: secondIndex }
    : {
        firstType: secondType,
        secondType: firstType,
        minIndex: secondIndex,
        maxIndex: firstIndex
      };
}

export function normalizePairKey(typeA, typeB) {
  const indices = getPairIndices(typeA, typeB);
  if (!indices) {
    return "";
  }
  return `${indices.firstType}-${indices.secondType}`;
}

function getFallbackCompatibility(reason = "No dataset entry found for this pair.") {
  const level = getCompatibilityLevel(5);
  return {
    score: 5,
    label: "Unknown",
    color: level.color,
    width: level.width,
    reason
  };
}

function normalizeEntry(entry, fallbackReason) {
  if (typeof entry === "number") {
    const clampedScore = Math.max(0, Math.min(9, entry));
    const level = getCompatibilityLevel(clampedScore);
    return {
      score: clampedScore,
      label: level.label,
      color: level.color,
      width: level.width
    };
  }

  if (entry && typeof entry === "object" && typeof entry.score === "number") {
    const clampedScore = Math.max(0, Math.min(9, entry.score));
    const level = getCompatibilityLevel(clampedScore);
    return {
      score: clampedScore,
      label: entry.label || level.label,
      color: entry.color || level.color,
      width: entry.width || level.width,
      reason: entry.reason
    };
  }

  return getFallbackCompatibility(fallbackReason);
}

function getEntryFromTriangularMatrix(data, typeA, typeB) {
  const indices = getPairIndices(typeA, typeB);
  if (!indices || !Array.isArray(data?.scores)) {
    return null;
  }

  const row = data.scores[indices.minIndex];
  if (!Array.isArray(row)) {
    return null;
  }

  return row[indices.maxIndex - indices.minIndex];
}

function getEntryFromPairs(data, typeA, typeB) {
  if (!data?.pairs || typeof data.pairs !== "object") {
    return null;
  }

  const key = normalizePairKey(typeA, typeB);
  return key ? data.pairs[key] : null;
}

export async function loadCompatibilityMatrix() {
  if (compatibilityPromise) {
    return compatibilityPromise;
  }

  compatibilityPromise = fetch(DATA_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load compatibility matrix: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      compatibilityData = data;
      return data;
    })
    .catch((error) => {
      compatibilityData = null;
      warnOnce(
        `Compatibility matrix unavailable at ${DATA_URL.href}. Falling back to neutral scores. ${error.message}`
      );
      return null;
    });

  return compatibilityPromise;
}

export function getCompatibilityFromMatrix(typeA, typeB) {
  const normalizedKey = normalizePairKey(typeA, typeB);
  if (!normalizedKey) {
    return getFallbackCompatibility("Invalid MBTI type.");
  }

  let entry = null;

  if (compatibilityData) {
    entry = getEntryFromPairs(compatibilityData, typeA, typeB);
    if (entry === null || entry === undefined) {
      entry = getEntryFromTriangularMatrix(compatibilityData, typeA, typeB);
    }
  }

  if (entry === null || entry === undefined) {
    warnOnce(`Missing compatibility seed for ${normalizedKey}. Using neutral fallback.`);
    return getFallbackCompatibility(`Missing compatibility seed for ${normalizedKey}.`);
  }

  return normalizeEntry(entry, `Missing compatibility seed for ${normalizedKey}.`);
}
