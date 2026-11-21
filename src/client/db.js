// Small IndexedDB key/value store. File System Access handles are
// structured-cloneable, so they can live here alongside plain JSON.

const DB_NAME = "markdownapps";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise = null;
const memory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let request;
        try {
          request = fn(store);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = () => resolve(request?.result);
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      })
  );
}

export async function get(key, fallback = undefined) {
  try {
    const value = await run("readonly", (store) => store.get(key));
    return value === undefined ? fallback : value;
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

export async function set(key, value) {
  memory.set(key, value);
  try {
    await run("readwrite", (store) => store.put(value, key));
  } catch {
    // Memory still holds it for this session.
  }
  return value;
}

export async function remove(key) {
  memory.delete(key);
  try {
    await run("readwrite", (store) => store.delete(key));
  } catch {
    // Nothing else to do.
  }
}

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
