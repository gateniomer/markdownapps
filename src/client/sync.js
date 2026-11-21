import { get, set, remove } from "./db.js";
import { downloadFile, hashSource } from "./files.js";

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const RPC_URL = "https://api.dropboxapi.com/2";
const CONTENT_URL = "https://content.dropboxapi.com/2";
const DEFAULT_ROOT = "/markdownapps";
const POLL_MS = 20_000;
const DEBOUNCE_MS = 1_200;
const SCOPES = [
  "files.content.read",
  "files.content.write",
  "files.metadata.read",
  "account_info.read",
];

const KEYS = {
  tokens: "sync.tokens",
  account: "sync.account",
  entries: "sync.entries",
  root: "sync.root",
  pkce: "sync.pkce",
};

export function dropboxAppKey() {
  const fromEnv = import.meta.env?.VITE_DROPBOX_APP_KEY;
  if (fromEnv) return String(fromEnv).trim();
  try {
    return String(localStorage.getItem("markdownapps.dropboxAppKey") || "").trim();
  } catch {
    return "";
  }
}

export function setDropboxAppKey(key) {
  try {
    const value = String(key || "").trim();
    if (value) localStorage.setItem("markdownapps.dropboxAppKey", value);
    else localStorage.removeItem("markdownapps.dropboxAppKey");
  } catch {
    // Storage may be blocked; the env key still applies.
  }
}

function redirectUri() {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`;
}

function base64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function isNotFound(error) {
  return String(error?.message || "").includes("not_found");
}

function normalizeRoot(value) {
  const root = `/${String(value || "").replace(/^\/+|\/+$/g, "")}`;
  return root === "/" ? DEFAULT_ROOT : root;
}

function fileNameOf(document) {
  return document?.name || "note.md";
}

function conflictName(name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return name.replace(/\.md$/i, "") + ` (conflict remote ${stamp}).md`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function createSync() {
  let tokens = null;
  let account = null;
  let root = DEFAULT_ROOT;
  let entries = {};
  let document = null;
  let started = false;
  let syncing = false;
  let queued = false;
  let debounceTimer = null;
  let pollTimer = null;
  let phase = "idle";
  let lastError = "";
  let lastMessage = "";
  let lastSyncAt = null;
  let conflictPath = "";
  let loading = false;

  const configured = () => Boolean(dropboxAppKey());
  const connected = () => Boolean(tokens?.refresh_token || tokens?.access_token);

  function setStatus(patch = {}) {
    if (patch.phase) phase = patch.phase;
    if (patch.lastError !== undefined) lastError = patch.lastError;
    if (patch.lastMessage !== undefined) lastMessage = patch.lastMessage;
    if (patch.lastSyncAt !== undefined) lastSyncAt = patch.lastSyncAt;
    if (patch.conflictPath !== undefined) conflictPath = patch.conflictPath;
  }

  async function load() {
    tokens = await get(KEYS.tokens, null);
    account = await get(KEYS.account, null);
    root = normalizeRoot(await get(KEYS.root, DEFAULT_ROOT));
    entries = (await get(KEYS.entries, {})) || {};
  }

  async function saveEntries() {
    await set(KEYS.entries, entries);
  }

  async function accessToken() {
    if (!tokens) throw new Error("Dropbox is not connected.");
    if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60_000) {
      return tokens.access_token;
    }
    if (!tokens.refresh_token) throw new Error("Dropbox session expired. Reconnect.");

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: dropboxAppKey(),
      }),
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error_description || "Could not refresh Dropbox access");
    tokens = {
      ...tokens,
      access_token: result.access_token,
      expires_at: Date.now() + (result.expires_in || 14_400) * 1000,
    };
    await set(KEYS.tokens, tokens);
    return tokens.access_token;
  }

  async function rpc(route, body) {
    const token = await accessToken();
    const response = await fetch(`${RPC_URL}${route}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? null),
    });
    const result = await readJson(response);
    if (!response.ok) {
      const message =
        result.error_summary || result.error_description || `Dropbox ${route} failed`;
      const error = new Error(message);
      error.payload = result;
      throw error;
    }
    return result;
  }

  async function ensureParent(remotePath) {
    const parent = remotePath.slice(0, remotePath.lastIndexOf("/"));
    if (!parent || parent === "/") return;
    let current = "";
    for (const segment of parent.split("/").filter(Boolean)) {
      current += `/${segment}`;
      try {
        await rpc("/files/create_folder_v2", { path: current, autorename: false });
      } catch (error) {
        if (!String(error.payload?.error_summary || "").includes("conflict")) throw error;
      }
    }
  }

  async function stat(remotePath) {
    try {
      const meta = await rpc("/files/get_metadata", { path: remotePath });
      return {
        exists: true,
        rev: meta.rev,
        modifiedAt: meta.server_modified,
        size: meta.size,
      };
    } catch (error) {
      if (isNotFound(error)) return { exists: false };
      throw error;
    }
  }

  async function download(remotePath) {
    const token = await accessToken();
    const response = await fetch(`${CONTENT_URL}/files/download`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "dropbox-api-arg": JSON.stringify({ path: remotePath }),
      },
    });
    if (!response.ok) {
      const result = await readJson(response);
      throw new Error(result.error_summary || "Dropbox download failed");
    }
    const meta = JSON.parse(response.headers.get("dropbox-api-result") || "{}");
    return {
      content: await response.text(),
      rev: meta.rev,
      modifiedAt: meta.server_modified,
      size: meta.size,
    };
  }

  async function upload(remotePath, content, { baseRev = null, overwrite = false } = {}) {
    await ensureParent(remotePath);
    const token = await accessToken();
    const mode = overwrite
      ? { ".tag": "overwrite" }
      : baseRev
        ? { ".tag": "update", update: baseRev }
        : { ".tag": "add" };

    const response = await fetch(`${CONTENT_URL}/files/upload`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "dropbox-api-arg": JSON.stringify({
          path: remotePath,
          mode,
          autorename: false,
          mute: true,
        }),
      },
      body: content,
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error_summary || "Dropbox upload failed");
    }
    return {
      rev: result.rev,
      modifiedAt: result.server_modified,
      size: result.size,
    };
  }

  async function completeAuth(code, state) {
    let pending = null;
    try {
      pending = JSON.parse(localStorage.getItem(KEYS.pkce) || "null");
    } catch {
      pending = null;
    }
    if (!pending || pending.state !== state) {
      throw new Error("This Dropbox sign-in link is no longer valid. Try again.");
    }
    try {
      localStorage.removeItem(KEYS.pkce);
    } catch {
      // Ignore storage errors.
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: dropboxAppKey(),
        redirect_uri: redirectUri(),
        code_verifier: pending.verifier,
      }),
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error_description || "Dropbox did not accept the sign-in");
    }
    if (!result.refresh_token) {
      throw new Error("Dropbox did not return a refresh token. Enable offline access.");
    }

    tokens = {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Date.now() + (result.expires_in || 14_400) * 1000,
    };
    await set(KEYS.tokens, tokens);

    try {
      const info = await rpc("/users/get_current_account", null);
      account = { name: info?.name?.display_name || "", email: info?.email || "" };
      await set(KEYS.account, account);
    } catch {
      account = null;
    }

    setStatus({ phase: "idle", lastError: "", lastMessage: "Dropbox connected." });
    return status();
  }

  function status() {
    const name = fileNameOf(document);
    const entry = entries[name] || null;
    return {
      configured: configured(),
      connected: connected(),
      provider: "dropbox",
      providerName: "Dropbox",
      account,
      redirectUri: redirectUri(),
      remoteRoot: root,
      remotePath: document ? remotePathFor(name) : null,
      entry,
      phase,
      syncing,
      lastError,
      lastMessage,
      lastSyncAt,
      conflictPath: conflictPath || null,
      pollIntervalMs: POLL_MS,
    };
  }

  function remotePathFor(name) {
    return `${normalizeRoot(root)}/${name}`;
  }

  function currentName() {
    return fileNameOf(document);
  }

  function currentEntry() {
    return entries[currentName()] || null;
  }

  function entryFrom(remote, remotePath, hash) {
    return {
      remotePath,
      rev: remote.rev || "",
      hash,
      remoteModifiedAt: remote.modifiedAt || null,
      syncedAt: Date.now(),
    };
  }

  async function syncNow(reason = "manual") {
    if (!document) return status();
    if (!configured()) {
      setStatus({ phase: "unconfigured", lastError: "Dropbox sync is not configured." });
      return status();
    }
    if (!connected()) {
      setStatus({ phase: "disconnected", lastError: "" });
      return status();
    }
    if (syncing) {
      queued = true;
      return status();
    }

    syncing = true;
    try {
      const name = currentName();
      const local = document.getContent();
      const localHash = await hashSource(local);
      const remotePath = remotePathFor(name);
      let entry = entries[name] || null;

      if (entry && entry.remotePath !== remotePath) {
        delete entries[name];
        await saveEntries();
        entry = null;
      }

      const remote = await stat(remotePath);

      if (!remote.exists) {
        if (entry) {
          delete entries[name];
          await saveEntries();
          setStatus({
            phase: "idle",
            lastError: "",
            lastMessage:
              "The remote copy is gone; your local file was kept and will upload again.",
            lastSyncAt: Date.now(),
            conflictPath: "",
          });
          return status();
        }
        setStatus({ phase: "pushing", lastMessage: "Uploading to Dropbox…" });
        const uploaded = await upload(remotePath, local, { baseRev: null, overwrite: false });
        entries[name] = entryFrom(uploaded, remotePath, localHash);
        await saveEntries();
        setStatus({
          phase: "idle",
          lastError: "",
          lastMessage: "Uploaded to Dropbox.",
          lastSyncAt: Date.now(),
          conflictPath: "",
        });
        return status();
      }

      if (!entry) {
        setStatus({ phase: "pulling", lastMessage: "Comparing local and remote copies…" });
        const downloaded = await download(remotePath);
        const remoteHash = await hashSource(downloaded.content);

        if (remoteHash === localHash) {
          entries[name] = entryFrom({ ...downloaded, rev: downloaded.rev || remote.rev }, remotePath, localHash);
          await saveEntries();
          setStatus({ phase: "idle", lastError: "", lastMessage: "Already in sync.", lastSyncAt: Date.now(), conflictPath: "" });
          return status();
        }

        const saved = conflictName(name);
        downloadFile(saved, downloaded.content, "text/markdown");
        const uploaded = await upload(remotePath, local, { baseRev: remote.rev, overwrite: false });
        entries[name] = entryFrom(uploaded, remotePath, localHash);
        await saveEntries();
        setStatus({
          phase: "conflict",
          lastError: "",
          lastMessage: "Both copies existed. Kept the local file and downloaded the remote copy as a conflict file.",
          lastSyncAt: Date.now(),
          conflictPath: saved,
        });
        return status();
      }

      const localChanged = localHash !== entry.hash;
      const remoteChanged = remote.rev !== entry.rev;

      if (!localChanged && !remoteChanged) {
        setStatus({ phase: "idle", lastError: "", lastMessage: "Up to date.", lastSyncAt: Date.now(), conflictPath: "" });
        return status();
      }

      if (remoteChanged && !localChanged) {
        setStatus({ phase: "pulling", lastMessage: "Pulling changes from Dropbox…" });
        const downloaded = await download(remotePath);
        const remoteHash = await hashSource(downloaded.content);
        if (remoteHash !== localHash) await document.applyRemote(downloaded.content);
        entries[name] = entryFrom({ ...downloaded, rev: downloaded.rev || remote.rev }, remotePath, remoteHash);
        await saveEntries();
        setStatus({ phase: "idle", lastError: "", lastMessage: "Pulled changes from Dropbox.", lastSyncAt: Date.now(), conflictPath: "" });
        return status();
      }

      if (localChanged && !remoteChanged) {
        setStatus({ phase: "pushing", lastMessage: "Pushing changes to Dropbox…" });
        const uploaded = await upload(remotePath, local, { baseRev: entry.rev, overwrite: false });
        entries[name] = entryFrom(uploaded, remotePath, localHash);
        await saveEntries();
        setStatus({ phase: "idle", lastError: "", lastMessage: "Pushed changes to Dropbox.", lastSyncAt: Date.now(), conflictPath: "" });
        return status();
      }

      setStatus({ phase: "conflict", lastMessage: "Both copies changed. Saving a conflict copy…" });
      const downloaded = await download(remotePath);
      const remoteHash = await hashSource(downloaded.content);
      if (remoteHash === localHash) {
        entries[name] = entryFrom({ ...downloaded, rev: downloaded.rev || remote.rev }, remotePath, localHash);
        await saveEntries();
        setStatus({ phase: "idle", lastError: "", lastMessage: "Both copies match now.", lastSyncAt: Date.now(), conflictPath: "" });
        return status();
      }

      const saved = conflictName(name);
      downloadFile(saved, downloaded.content, "text/markdown");
      const uploaded = await upload(remotePath, local, { baseRev: entry.rev, overwrite: true });
      entries[name] = entryFrom(uploaded, remotePath, localHash);
      await saveEntries();
      setStatus({
        phase: "conflict",
        lastError: "",
        lastMessage: "Both copies changed. Kept local and downloaded the remote copy as a conflict file.",
        lastSyncAt: Date.now(),
        conflictPath: saved,
      });
      return status();
    } catch (error) {
      setStatus({ phase: "error", lastError: error.message || "Sync failed" });
      return status();
    } finally {
      syncing = false;
      if (queued) {
        queued = false;
        schedule("queued");
      }
    }
  }

  function schedule(reason = "change") {
    if (!started || !document) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void syncNow(reason);
    }, DEBOUNCE_MS);
  }

  function start() {
    started = true;
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document && document.visible()) void syncNow("poll");
    }, POLL_MS);
    schedule("start");
  }

  function stop() {
    started = false;
    clearTimeout(debounceTimer);
    clearInterval(pollTimer);
    debounceTimer = null;
    pollTimer = null;
  }

  async function init() {
    if (loading) return status();
    loading = true;
    try {
      await load();
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      if (code && state) {
        history.replaceState({}, "", redirectUri());
        await completeAuth(code, state);
        if (window.opener) setTimeout(() => window.close(), 300);
      }
    } catch (error) {
      setStatus({ phase: "error", lastError: error.message || "Sync setup failed" });
    } finally {
      loading = false;
    }
    return status();
  }

  async function connect() {
    if (!configured()) {
      throw new Error(
        "Dropbox sync is not configured. Set VITE_DROPBOX_APP_KEY or localStorage markdownapps.dropboxAppKey."
      );
    }
    const verifier = randomString();
    const state = randomString(16);
    const challenge = await challengeFor(verifier);
    localStorage.setItem(KEYS.pkce, JSON.stringify({ state, verifier, createdAt: Date.now() }));

    const params = new URLSearchParams({
      client_id: dropboxAppKey(),
      response_type: "code",
      redirect_uri: redirectUri(),
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
      scope: SCOPES.join(" "),
      state,
    });
    return { url: `${AUTHORIZE_URL}?${params}`, state, redirectUri: redirectUri() };
  }

  async function disconnect() {
    if (tokens?.refresh_token || tokens?.access_token) {
      try {
        await rpc("/auth/token/revoke", null);
      } catch {
        // Best effort; always clear the local session.
      }
    }
    tokens = null;
    account = null;
    entries = {};
    await Promise.all([remove(KEYS.tokens), remove(KEYS.account), remove(KEYS.entries)]);
    setStatus({ phase: "idle", lastError: "", lastMessage: "Dropbox disconnected.", conflictPath: "" });
    return status();
  }

  function setDocument(next) {
    document = next;
    if (next) {
      phase = "idle";
      lastError = "";
      conflictPath = "";
    }
  }

  return {
    init,
    status,
    connect,
    disconnect,
    syncNow,
    schedule,
    start,
    stop,
    setDocument,
    isConfigured: configured,
  };
}
