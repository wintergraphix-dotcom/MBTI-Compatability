#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const TYPE_ORDER = [
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

function normalizeType(type) {
  const cleaned = String(type || "").trim().toUpperCase();
  return TYPE_ORDER.includes(cleaned) ? cleaned : null;
}

function normalizePairKey(typeA, typeB) {
  const first = normalizeType(typeA);
  const second = normalizeType(typeB);
  if (!first || !second) {
    return "";
  }

  const firstIndex = TYPE_ORDER.indexOf(first);
  const secondIndex = TYPE_ORDER.indexOf(second);
  return firstIndex <= secondIndex ? `${first}-${second}` : `${second}-${first}`;
}

function readDelimitedMatrix(fileContents, delimiter) {
  const rows = fileContents
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));

  const header = rows[0].slice(1).map(normalizeType);
  const pairs = {};

  rows.slice(1).forEach((row) => {
    const rowType = normalizeType(row[0]);
    if (!rowType) {
      return;
    }

    row.slice(1).forEach((value, index) => {
      const columnType = header[index];
      if (!columnType || value === "") {
        return;
      }

      const score = Number(value);
      if (!Number.isFinite(score)) {
        return;
      }

      const key = normalizePairKey(rowType, columnType);
      if (key) {
        pairs[key] = { score };
      }
    });
  });

  return pairs;
}

function readJsonInput(fileContents) {
  const parsed = JSON.parse(fileContents);

  if (parsed && parsed.pairs) {
    return parsed.pairs;
  }

  if (parsed && parsed.types && parsed.scores) {
    const pairs = {};
    parsed.types.forEach((rowType, rowIndex) => {
      const normalizedRowType = normalizeType(rowType);
      if (!normalizedRowType) {
        return;
      }

      parsed.scores[rowIndex].forEach((score, offset) => {
        const columnType = parsed.types[rowIndex + offset];
        const key = normalizePairKey(normalizedRowType, columnType);
        if (key && Number.isFinite(score)) {
          pairs[key] = { score };
        }
      });
    });
    return pairs;
  }

  return {};
}

function main() {
  const inputPath = process.argv[2];
  const outputPath =
    process.argv[3] || path.join(process.cwd(), "src", "data", "mbtiCompatibility.generated.json");

  if (!inputPath) {
    console.error("Usage: node scripts/convertMbtiMatrix.js <input.(json|csv|tsv)> [output.json]");
    process.exit(1);
  }

  const absoluteInputPath = path.resolve(process.cwd(), inputPath);
  const raw = fs.readFileSync(absoluteInputPath, "utf8");
  const extension = path.extname(absoluteInputPath).toLowerCase();

  let pairs = {};

  if (extension === ".json") {
    pairs = readJsonInput(raw);
  } else if (extension === ".csv") {
    pairs = readDelimitedMatrix(raw, ",");
  } else if (extension === ".tsv") {
    pairs = readDelimitedMatrix(raw, "\t");
  } else {
    console.error("Unsupported input format. Use JSON, CSV, or TSV.");
    process.exit(1);
  }

  const output = {
    meta: {
      name: "MBTI Compatibility Matrix",
      version: "1.0",
      source: "Converted local source file",
      generatedAt: new Date().toISOString()
    },
    pairs
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(pairs).length} normalized pairs to ${outputPath}`);
}

main();
