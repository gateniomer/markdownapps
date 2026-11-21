import { marked } from "marked";

const LIST_KEYS = new Set(["prereqs", "related", "tags"]);
const HEADING_RE = /^##\s+(.+?)\s*$/gm;

function clampLevel(value) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return 0;
  return Math.min(4, Math.max(0, number));
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function parseList(value) {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseMeta(source) {
  const meta = {};
  let currentList = null;

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    const item = rawLine.match(/^\s*-\s+(.+?)\s*$/);
    if (item && currentList) {
      meta[currentList].push(item[1]);
      continue;
    }

    const pair = rawLine.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!pair) {
      currentList = null;
      continue;
    }

    const key = pair[1].toLowerCase();
    const value = pair[2].trim();

    if (!value) {
      meta[key] = [];
      currentList = key;
    } else if (LIST_KEYS.has(key) || value.startsWith("[")) {
      meta[key] = parseList(value);
      currentList = null;
    } else {
      meta[key] = value.replace(/^["']|["']$/g, "");
      currentList = null;
    }
  }

  return meta;
}

export function parseTopics(source) {
  const matches = [...source.matchAll(HEADING_RE)];
  const usedIds = new Map();

  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const block = source.slice(start, end);
    const firstBreak = block.indexOf("\n");
    const title = match[1].trim();
    const baseId = slugify(title) || `topic-${index + 1}`;
    const seen = usedIds.get(baseId) || 0;
    usedIds.set(baseId, seen + 1);
    const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`;

    const metaBlock = block.match(/^```ya?ml[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m);
    const meta = metaBlock ? parseMeta(metaBlock[1]) : {};

    let body = firstBreak === -1 ? "" : block.slice(firstBreak + 1);
    if (metaBlock) body = body.replace(metaBlock[0], "");
    body = body.replace(/^\s+|\s+$/g, "");

    return {
      id,
      title,
      level: clampLevel(meta.level ?? 0),
      confidence: meta.confidence ?? "unknown",
      prereqs: Array.isArray(meta.prereqs) ? meta.prereqs : [],
      related: Array.isArray(meta.related) ? meta.related : [],
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      body,
      meta,
      html: marked.parse(body, { gfm: true, breaks: false }),
      metaBlock: metaBlock ? metaBlock[0] : null,
      metaText: metaBlock ? metaBlock[1] : "",
      start,
      end,
    };
  });
}

export function parseTopicDocument(source) {
  return {
    topics: parseTopics(source).map(({ metaBlock, metaText, start, end, ...topic }) => topic),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function setTopicMeta(source, id, key, value) {
  const topics = parseTopics(source);
  const topic = topics.find((candidate) => candidate.id === id);
  if (!topic) throw new Error(`Topic not found: ${id}`);

  const block = source.slice(topic.start, topic.end);
  const cleanKey = key.replace(/[^a-z0-9_-]/gi, "");
  if (!cleanKey) throw new Error("Invalid metadata key");

  if (topic.metaBlock) {
    const line = new RegExp(`^${escapeRegExp(cleanKey)}:\\s*.*$`, "mi");
    const nextMeta = line.test(topic.metaText)
      ? topic.metaText.replace(line, `${cleanKey}: ${value}`)
      : `${topic.metaText.replace(/\s+$/g, "")}\n${cleanKey}: ${value}`;
    const nextBlock = block.replace(topic.metaBlock, `\`\`\`yaml\n${nextMeta}\n\`\`\``);
    return source.slice(0, topic.start) + nextBlock + source.slice(topic.end);
  }

  const headingBreak = block.indexOf("\n");
  const insertAt = headingBreak === -1 ? block.length : headingBreak + 1;
  const nextBlock =
    block.slice(0, insertAt) +
    `\n\`\`\`yaml\n${cleanKey}: ${value}\n\`\`\`\n` +
    block.slice(insertAt);

  return source.slice(0, topic.start) + nextBlock + source.slice(topic.end);
}

function formatList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join(", ");
  }
  return String(value ?? "").trim();
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function addSection(source, { title, meta = {}, body = "" }) {
  const clean = cleanTitle(title);
  if (!clean) throw new Error("Section title is required");

  const lines = [];
  for (const [key, value] of Object.entries(meta)) {
    const formatted = formatList(value);
    if (formatted) lines.push(`${key}: ${formatted}`);
  }

  const block = `## ${clean}\n\n\`\`\`yaml\n${lines.join("\n")}\n\`\`\`\n\n${String(body).trim()}\n`;
  const next = `${source.replace(/\s+$/g, "")}\n\n${block}`;
  const topics = parseTopics(next);

  return { source: next, id: topics[topics.length - 1].id };
}

export function removeSection(source, id) {
  const topic = parseTopics(source).find((candidate) => candidate.id === id);
  if (!topic) throw new Error(`Section not found: ${id}`);

  const before = source.slice(0, topic.start).replace(/\s+$/g, "");
  const after = source.slice(topic.end).replace(/^\s+/g, "");
  const next = after ? `${before}\n\n${after}` : `${before}\n`;
  return next.replace(/\s+$/g, "") + "\n";
}

export function addTopic(source, data) {
  const title = cleanTitle(data.title);
  if (!title) throw new Error("Topic title is required");

  const level = clampLevel(data.level ?? 0);
  const confidence = String(data.confidence || "unknown").trim() || "unknown";
  const meta = [`level: ${level}`, `confidence: ${confidence}`];

  for (const key of ["prereqs", "related", "tags"]) {
    const list = formatList(data[key]);
    if (list) meta.push(`${key}: ${list}`);
  }

  const body = String(data.body || "").trim();
  const block = `## ${title}\n\n\`\`\`yaml\n${meta.join("\n")}\n\`\`\`\n\n${body ? `${body}\n` : ""}`;
  const next = `${source.replace(/\s+$/g, "")}\n\n${block}`;
  const topics = parseTopics(next);

  return { source: next, id: topics[topics.length - 1].id };
}

export function updateTopic(source, id, data) {
  let next = source;

  for (const key of ["level", "confidence", "prereqs", "related", "tags"]) {
    if (data[key] === undefined) continue;
    const value =
      key === "level"
        ? String(clampLevel(data.level))
        : key === "confidence"
          ? String(data.confidence || "unknown").trim() || "unknown"
          : formatList(data[key]);
    next = setTopicMeta(next, id, key, value);
  }

  const topics = parseTopics(next);
  const index = topics.findIndex((candidate) => candidate.id === id);
  const topic = topics[index];
  if (!topic) throw new Error(`Topic not found: ${id}`);

  const title = data.title === undefined ? topic.title : cleanTitle(data.title);
  if (!title) throw new Error("Topic title is required");

  const body = data.body === undefined ? topic.body : String(data.body).trim();
  const block = next.slice(topic.start, topic.end);
  const metaIndex = topic.metaBlock ? block.indexOf(topic.metaBlock) : -1;
  const firstBreak = block.indexOf("\n");
  const bodyStart =
    metaIndex >= 0
      ? metaIndex + topic.metaBlock.length
      : firstBreak === -1
        ? block.length
        : firstBreak + 1;

  let prefix = block.slice(0, bodyStart).replace(/\s+$/g, "");
  if (title !== topic.title) {
    prefix = prefix.replace(/^##\s+.*$/m, `## ${title}`);
  }

  const nextBlock = `${prefix}\n\n${body}\n\n`;
  next = next.slice(0, topic.start) + nextBlock + next.slice(topic.end);
  const updatedTopics = parseTopics(next);

  return { source: next, id: updatedTopics[index]?.id || id };
}

export function addTopicComment(source, id, text, author = "you") {
  const topics = parseTopics(source);
  const topic = topics.find((candidate) => candidate.id === id);
  if (!topic) throw new Error(`Topic not found: ${id}`);

  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("Comment cannot be empty");

  const date = new Date().toISOString().slice(0, 10);
  const quoted = cleanText
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");

  const block = source.slice(topic.start, topic.end).replace(/\s+$/g, "");
  const comment = `\n\n> **Comment** · ${author} · ${date}\n${quoted}\n\n`;
  const nextBlock = block + comment;

  return source.slice(0, topic.start) + nextBlock + source.slice(topic.end);
}
