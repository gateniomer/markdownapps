// Browser file access. Everything here needs the File System Access API
// (Chromium today). Callers should check `supportsFiles()` before prompting.

export function supportsFiles() {
  return (
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function"
  );
}

export function supportsFolders() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickNoteFile() {
  const [handle] = await window.showOpenFilePicker({
    types: [
      {
        description: "Markdown",
        accept: { "text/markdown": [".md", ".markdown", ".mdown"] },
      },
    ],
    multiple: false,
  });
  return handle;
}

export async function pickDirectory() {
  return window.showDirectoryPicker({ mode: "readwrite" });
}

export async function ensurePermission(handle, mode = "readwrite") {
  if (!handle) return false;
  const options = { mode };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

export async function readHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}

export async function writeHandle(handle, content) {
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

export async function fileExists(handle) {
  try {
    await handle.getFile();
    return true;
  } catch (error) {
    // A permission prompt is not a missing file.
    return error?.name !== "NotFoundError";
  }
}

export async function hashSource(source) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(source);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }
  // Fallback for non-secure contexts: still a stable content fingerprint.
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function downloadFile(name, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
