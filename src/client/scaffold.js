export function titleFromFile(file) {
  const base = String(file || "")
    .replace(/^.*[/\\]/, "")
    .replace(/\.[^.]+$/, "");
  const title = base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return title || "New map";
}

export function createNoteSource(title = "New note", template = "map", description = "") {
  const today = new Date().toISOString().slice(0, 10);
  const noteDescription = description || "A new markdownapps note.";

  return `---
title: ${title}
description: ${noteDescription}
template: ${template}
---

# ${title}

## First topic

\`\`\`yaml
level: 0
confidence: unknown
prereqs:
related:
tags:
\`\`\`

Write a short note here.

> **Comment** · you · ${today}
> Replace this comment with a question or a note for the agent.
`;
}

export function normalizeFileName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error("Enter a file name.");
  if (/[\\/]/.test(trimmed)) throw new Error("Use a file name, not a path.");
  if (trimmed === "." || trimmed === "..") throw new Error("Enter a valid file name.");
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}
