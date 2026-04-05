import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);

if (args.length < 3 || !args.includes('--out')) {
  console.error(
    'Usage: /usr/local/bin/node scripts/merge-twitter-corpus.mjs <input1.json> <input2.json> [...inputN.json] --out <merged.json>'
  );
  process.exit(1);
}

const outIndex = args.indexOf('--out');
const inputArgs = args.slice(0, outIndex);
const outArg = args[outIndex + 1];

if (!outArg || inputArgs.length === 0) {
  console.error('At least one input corpus and one --out path are required.');
  process.exit(1);
}

const outputPath = path.resolve(outArg);
const inputs = inputArgs.map((item) => path.resolve(item));
const seen = new Map();
const perInput = [];

for (const inputPath of inputs) {
  const rows = readCorpus(inputPath);
  let added = 0;
  let duplicates = 0;

  for (const row of rows) {
    const key = deriveKey(row);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, normalizeRow(row));
      added += 1;
      continue;
    }

    duplicates += 1;
    seen.set(key, choosePreferredRow(existing, row));
  }

  perInput.push({
    input: inputPath,
    rows: rows.length,
    added,
    duplicates,
  });
}

const merged = [...seen.values()].sort((a, b) => parseDate(b.created_at) - parseDate(a.created_at));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));

const summary = {
  output: outputPath,
  inputs,
  input_count: inputs.length,
  merged_count: merged.length,
  newest: merged[0]?.created_at,
  oldest: merged[merged.length - 1]?.created_at,
  per_input: perInput,
};

fs.writeFileSync(`${outputPath}.summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

function readCorpus(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input corpus not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Input corpus must be a JSON array: ${filePath}`);
  }
  return parsed;
}

function deriveKey(row) {
  const id = String(row?.id || '').trim();
  if (id) return `id:${id}`;
  const url = String(row?.url || row?.source_url || '').trim();
  if (url) return `url:${url}`;
  const author = String(row?.author || '').trim().toLowerCase();
  const createdAt = String(row?.created_at || row?.published_at || '').trim();
  const text = String(row?.text || row?.content || '').trim();
  if (!author && !createdAt && !text) return null;
  const hash = crypto.createHash('sha1').update(`${author}\n${createdAt}\n${text}`).digest('hex');
  return `hash:${hash}`;
}

function normalizeRow(row) {
  return {
    ...row,
    id: row?.id,
    author: row?.author,
    text: row?.text ?? row?.content,
    created_at: row?.created_at ?? row?.published_at,
    url: row?.url ?? row?.source_url,
  };
}

function choosePreferredRow(left, right) {
  const a = normalizeRow(left);
  const b = normalizeRow(right);
  const scoreA = rowScore(a);
  const scoreB = rowScore(b);
  return scoreB > scoreA ? b : a;
}

function rowScore(row) {
  let score = 0;
  if (row.text) score += String(row.text).length;
  if (row.likes != null) score += 5;
  if (row.views != null) score += 5;
  if (row.url) score += 3;
  if (row.created_at) score += 3;
  return score;
}

function parseDate(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}
