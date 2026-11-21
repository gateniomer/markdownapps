import { compileTemplate } from "./compiler.js";
import { get, set } from "./db.js";
import { downloadFile } from "./files.js";
import { normalizeManifest, parseManifest } from "./manifest.js";

// Bundled starters are discovered from the folder. Add a *.markdownapps.svelte file
// with a manifest comment and it appears in the hub; nothing else to register.
const SOURCES = import.meta.glob("../templates/*.markdownapps.svelte", {
  query: "?raw",
  import: "default",
  eager: true,
});

const VIEWS = import.meta.glob("../templates/*.markdownapps.svelte", {
  import: "default",
  eager: true,
});

const DISABLED_KEY = "templates.disabled";
const CUSTOM_KEY = "templates.custom";

const BUNDLED = Object.entries(SOURCES)
  .map(([path, source]) => {
    const file = path.split("/").pop().replace(/\.markdownapps\.svelte$/, "");
    const manifest = normalizeManifest(parseManifest(source), { fallbackId: file });
    return { ...manifest, source, component: VIEWS[path], starter: true };
  })
  .sort(byOrder);

function byOrder(a, b) {
  return (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id);
}

function sourceFor(id) {
  return SOURCES[`../templates/${id}.markdownapps.svelte`] ?? "";
}

async function customRecords() {
  const value = await get(CUSTOM_KEY, {});
  return value && typeof value === "object" ? value : {};
}

async function installedTemplates(records) {
  return Promise.all(
    Object.values(records)
      .sort(byOrder)
      .map(async (record) => {
        try {
          const View = await compileTemplate(record.source, { id: record.id });
          return toPublic({ ...record, component: View, starter: false });
        } catch (cause) {
          return toPublic({
            ...record,
            component: null,
            starter: false,
            error: cause.message,
          });
        }
      })
  );
}

function toPublic(template) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    permissions: template.permissions,
    order: template.order,
    starter: template.starter,
    installed: !template.starter,
    View: template.component ?? null,
    error: template.error ?? "",
  };
}

export async function disabledTemplates() {
  const value = await get(DISABLED_KEY, []);
  return new Set(Array.isArray(value) ? value : []);
}

export async function listTemplates() {
  const [disabled, records] = await Promise.all([disabledTemplates(), customRecords()]);
  const overridden = new Set(Object.keys(records));
  const bundled = BUNDLED.filter(
    (template) => !disabled.has(template.id) && !overridden.has(template.id)
  ).map(toPublic);
  const installed = await installedTemplates(records);
  return [...bundled, ...installed].sort(
    (a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id)
  );
}

export async function installTemplate(source, filename = "") {
  const text = String(source || "").trim();
  if (!text) throw new Error("That template file is empty.");

  const fallbackId = String(filename)
    .replace(/\.markdownapps\.svelte$/i, "")
    .replace(/\.svelte$/i, "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .toLowerCase();

  const manifest = normalizeManifest(parseManifest(text), { fallbackId });
  const records = await customRecords();

  // Compile before persisting so a broken file never lands in the hub.
  await compileTemplate(text, { id: manifest.id });

  // Importing the same id again replaces it: that is how an edited export is
  // brought back. Importing a bundled id installs an override of that starter.
  records[manifest.id] = { ...manifest, source: text, installedAt: Date.now() };
  await set(CUSTOM_KEY, records);
  return listTemplates();
}

export async function removeTemplate(id) {
  const records = await customRecords();
  if (records[id]) {
    delete records[id];
    await set(CUSTOM_KEY, records);
    return listTemplates();
  }

  const disabled = await disabledTemplates();
  if (!BUNDLED.some((template) => template.id === id)) {
    throw new Error(`Unknown template: ${id}`);
  }
  if (disabled.size >= BUNDLED.length - 1) {
    throw new Error("Keep at least one bundled template installed.");
  }
  disabled.add(id);
  await set(DISABLED_KEY, [...disabled]);
  return listTemplates();
}

export async function restoreTemplates() {
  await set(DISABLED_KEY, []);
  return listTemplates();
}

export async function exportTemplate(id) {
  const records = await customRecords();
  const source = records[id]?.source || sourceFor(id);
  if (!source) throw new Error(`No source is available for ${id}.`);
  downloadFile(`${id}.markdownapps.svelte`, source, "text/plain");
  return { id };
}
