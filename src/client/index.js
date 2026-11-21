import { get, set, newId } from "./db.js";
import { parseDocument } from "./frontmatter.js";
import {
  ensurePermission,
  fileExists,
  hashSource,
  pickDirectory,
  pickNoteFile,
  readHandle,
  supportsFiles,
  supportsFolders,
  writeHandle,
} from "./files.js";
import { createNoteSource, normalizeFileName, titleFromFile } from "./scaffold.js";
import {
  exportTemplate,
  installTemplate,
  listTemplates,
  removeTemplate,
  restoreTemplates,
} from "./templates.js";
import { createSync } from "./sync.js";

const KEYS = {
  folder: "settings.folder",
  recent: "recent",
  lastFile: "lastFile",
};

const MAX_RECENT = 20;

const sync = createSync();
const subscribers = new Set();

const state = {
  loading: true,
  graph: null,
  noFile: false,
  templates: [],
  connected: false,
  error: "",
  settings: { defaultLocation: "", hasFolder: false },
  recent: [],
};

let current = null;
let initialized = false;
let pollTimer = null;

function snapshot() {
  return {
    loading: state.loading,
    graph: state.graph,
    noFile: state.noFile,
    templates: state.templates,
    connected: state.connected,
    error: state.error,
    settings: state.settings,
    sync: sync.status(),
  };
}

function emit() {
  const value = snapshot();
  for (const subscriber of subscribers) {
    try {
      subscriber(value);
    } catch {
      // A broken subscriber should not stop the others.
    }
  }
}

function subscribe(callback) {
  subscribers.add(callback);
  callback(snapshot());
  return () => subscribers.delete(callback);
}

async function readSettings() {
  const folder = await get(KEYS.folder, null);
  return { defaultLocation: folder?.name || "", hasFolder: Boolean(folder) };
}

async function rememberNote(handle, title, id) {
  const existing =
    (id && state.recent.find((item) => item.id === id)) ||
    state.recent.find((item) => item.name === handle.name);

  const entry = {
    id: existing?.id || id || newId(),
    name: handle.name,
    title: title || existing?.title || handle.name,
    lastOpened: new Date().toISOString(),
    handle,
  };

  state.recent = [entry, ...state.recent.filter((item) => item.id !== entry.id)].slice(
    0,
    MAX_RECENT
  );
  await set(KEYS.recent, state.recent);
  await set(KEYS.lastFile, entry.id);
  return entry;
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", checkForChanges);
  }
}

async function checkForChanges() {
  if (!current) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  try {
    const source = await readHandle(current.handle);
    const hash = await hashSource(source);
    if (hash === current.hash) return;
    current.raw = source;
    current.hash = hash;
    state.graph = { ...parseDocument(source), raw: source, hash };
    emit();
  } catch {
    // Permission was revoked or the file moved; keep the last known content.
  }
}

function startPolling() {
  stopPolling();
  if (!current) return;
  pollTimer = setInterval(checkForChanges, 2000);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", checkForChanges);
  }
  state.connected = true;
}

async function adopt(handle, source, id) {
  const hash = await hashSource(source);
  current = { handle, name: handle.name, raw: source, hash, id: id || newId() };
  state.graph = { ...parseDocument(source), raw: source, hash };
  state.noFile = false;
  state.loading = false;
  state.error = "";

  const entry = await rememberNote(handle, state.graph.title, id);
  current.id = entry.id;

  sync.setDocument({
    name: handle.name,
    getContent: () => current?.raw ?? "",
    applyRemote: async (content) => {
      if (!current) return;
      await writeHandle(current.handle, content);
      current.raw = content;
      current.hash = await hashSource(content);
      state.graph = { ...parseDocument(content), raw: content, hash: current.hash };
      emit();
    },
    visible: () => document.visibilityState === "visible",
  });
  sync.start();

  startPolling();
  emit();
  return state.graph;
}

// ---------------------------------------------------------------------------
// Public client

async function init() {
  if (initialized) return;
  initialized = true;

  state.settings = await readSettings();
  state.recent = (await get(KEYS.recent, [])) || [];
  state.templates = await listTemplates();
  await sync.init();

  // Opening a file needs a user gesture, so only resume when permission was
  // already granted. Otherwise the hub lists it under Recent.
  const lastId = await get(KEYS.lastFile, null);
  const last = state.recent.find((item) => item.id === lastId) || state.recent[0];
  if (last?.handle) {
    try {
      const permission = await last.handle.queryPermission({ mode: "readwrite" });
      if (permission === "granted") {
        const source = await readHandle(last.handle);
        await adopt(last.handle, source, last.id);
        return;
      }
    } catch {
      // Fall through to the hub.
    }
  }

  state.loading = false;
  state.noFile = true;
  emit();
}

async function openNote() {
  if (!supportsFiles()) {
    throw new Error("Opening files directly needs Chrome or Edge. Use those browsers.");
  }
  const handle = await pickNoteFile();
  if (!(await ensurePermission(handle))) {
    throw new Error("Read and write permission is required to edit the note.");
  }
  const source = await readHandle(handle);
  return adopt(handle, source);
}

async function openRecent(id) {
  const item = state.recent.find((entry) => entry.id === id);
  if (!item) throw new Error("That file is no longer in the recent list.");

  if (!(await ensurePermission(item.handle))) {
    throw new Error("Permission to open that file was denied.");
  }
  const source = await readHandle(item.handle);
  return adopt(item.handle, source, item.id);
}

async function write(content, baseHash) {
  if (!current) throw new Error("No Markdown file is open.");
  if (typeof content !== "string") throw new Error("Missing content.");

  const latest = await readHandle(current.handle);
  const latestHash = await hashSource(latest);
  if (baseHash && baseHash !== latestHash) {
    throw new Error("The Markdown file changed. Reload before saving.");
  }

  await writeHandle(current.handle, content);
  const hash = await hashSource(content);
  current.raw = content;
  current.hash = hash;
  state.graph = { ...parseDocument(content), raw: content, hash };
  emit();
  sync.schedule("save");
  return { ok: true, hash };
}

async function createNote({ name, template }) {
  const fileName = normalizeFileName(name);
  const folder = await get(KEYS.folder, null);
  if (!folder) throw new Error("Choose a default folder in Settings first.");
  if (!(await ensurePermission(folder))) {
    throw new Error("Permission to write to the default folder is required.");
  }

  try {
    await folder.getFileHandle(fileName);
    throw new Error(`A file named ${fileName} already exists in that folder.`);
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }

  const templates = await listTemplates();
  const meta = templates.find((item) => item.id === template);
  if (!meta) throw new Error("Choose an installed template for the new note.");

  const source = createNoteSource(titleFromFile(fileName), meta.id, meta.description);
  const handle = await folder.getFileHandle(fileName, { create: true });
  await writeHandle(handle, source);
  await adopt(handle, source);
  return { fileName };
}

async function pickFolder() {
  if (!supportsFolders()) {
    throw new Error("Choosing folders needs Chrome or Edge. Use those browsers.");
  }
  const handle = await pickDirectory();
  if (!(await ensurePermission(handle))) {
    throw new Error("Folder permission was denied.");
  }
  await set(KEYS.folder, handle);
  state.settings = await readSettings();
  emit();
  return { canceled: false, name: handle.name };
}

async function updateSettings() {
  state.settings = await readSettings();
  emit();
  return { ...state.settings, cwd: "" };
}

async function hubState() {
  const recent = [];
  for (const item of state.recent) {
    let exists = true;
    try {
      exists = await fileExists(item.handle);
    } catch {
      exists = false;
    }
    recent.push({
      id: item.id,
      path: item.name,
      name: item.name,
      title: item.title,
      lastOpened: item.lastOpened,
      exists,
    });
  }

  return {
    mode: current ? "note" : "hub",
    file: current?.name || null,
    recent,
    settings: await readSettings(),
    templates: await listTemplates(),
  };
}

async function reloadTemplates() {
  state.templates = await listTemplates();
  emit();
  return state.templates;
}

async function removeTemplateById(id) {
  await removeTemplate(id);
  return reloadTemplates();
}

async function restoreStarterTemplates() {
  await restoreTemplates();
  return reloadTemplates();
}

async function focusSync() {
  return sync.syncNow("focus");
}

async function syncStatus() {
  return sync.status();
}

async function syncConnect() {
  return sync.connect();
}

async function syncNow() {
  return sync.syncNow("manual");
}

async function syncDisconnect() {
  return sync.disconnect();
}

function reportError(error) {
  state.error = error?.message || String(error);
  emit();
}

export const client = {
  init,
  subscribe,
  openNote,
  openRecent,
  write,
  createNote,
  pickFolder,
  updateSettings,
  hubState,
  reloadTemplates,
  removeTemplate: removeTemplateById,
  restoreTemplates: restoreStarterTemplates,
  installTemplate,
  exportTemplate,
  findTemplate: async (id) => (await listTemplates()).find((item) => item.id === id) || null,
  focusSync,
  syncStatus,
  syncConnect,
  syncNow,
  syncDisconnect,
  reportError,
  supportsFiles,
  supportsFolders,
  getDocument: () => current,
};

export default client;
