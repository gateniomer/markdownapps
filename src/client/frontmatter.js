// Minimal frontmatter reader. Handles the scalar keys the host cares about
// (`title`, `description`, `template`) without pulling a YAML parser into the
// browser bundle.

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

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

export function parseFrontmatter(source) {
  const match = BLOCK.exec(source);
  const data = {};
  if (!match) return data;

  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    data[pair[1]] = unquote(pair[2]);
  }
  return data;
}

export function parseDocument(source) {
  const data = parseFrontmatter(source);
  return {
    title: data.title || "Untitled note",
    description: data.description || "",
    template: String(data.template || "map"),
    frontmatter: data,
  };
}
