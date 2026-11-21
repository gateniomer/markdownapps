// Template manifests live in the leading HTML comment of a *.markdownapps.svelte
// file. This is the only metadata the host reads, so a template stays a single
// portable file.

const ID_RE = /^[a-z][a-z0-9-]*$/;

const COMMENT = /^\uFEFF?\s*<!--([\s\S]*?)-->/;

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseList(value) {
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item))
    .filter(Boolean);
}

export function parseManifest(source) {
  const match = COMMENT.exec(source);
  if (!match) return {};

  const data = {};
  let listKey = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const item = /^-\s+(.+)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }

    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      listKey = null;
      continue;
    }

    const key = pair[1].toLowerCase();
    const value = pair[2].trim();

    if (!value) {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = parseList(value);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }

  return data;
}

export function normalizeManifest(raw, { fallbackId = "" } = {}) {
  const id = String(raw.id || fallbackId || "").trim().toLowerCase();
  if (!ID_RE.test(id)) {
    throw new Error(
      `Template id "${id || "missing"}" is invalid. Use lowercase letters, digits, and dashes, starting with a letter.`
    );
  }

  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions
    : raw.permissions
      ? [raw.permissions]
      : ["document:read", "document:write"];

  const version = Number.parseInt(raw.version, 10);
  const order = Number.parseInt(raw.order, 10);

  return {
    id,
    name: String(raw.name || id),
    description: String(raw.description || ""),
    version: Number.isNaN(version) ? 1 : version,
    order: Number.isNaN(order) ? undefined : order,
    permissions,
  };
}
