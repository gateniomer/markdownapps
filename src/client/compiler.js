// Compiles a template's Svelte source in the page and evaluates it against the
// host's own modules. The compiled module is rewritten into a plain function
// body, so an imported template needs no bundler and no network access.
//
// Both `svelte/compiler` (~226 KB gzip) and the template module registry load
// lazily: they are only paid for when a template is installed or rendered.

const MODULE_NAMES = [
  "svelte",
  "svelte/animate",
  "svelte/easing",
  "svelte/legacy",
  "svelte/motion",
  "svelte/reactivity",
  "svelte/store",
  "svelte/transition",
  "markdownapps/schema/topics",
];

const AVAILABLE = MODULE_NAMES.map((name) => `"${name}"`).join(", ");
const KNOWN = new Set(MODULE_NAMES);

const cache = new Map();

let runtimePromise = null;

function hostRuntime() {
  runtimePromise ??= import("./compiler-runtime.js").then((module) => module.modules);
  return runtimePromise;
}

function hash(value) {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) + result + value.charCodeAt(index)) | 0;
  }
  return (result >>> 0).toString(36);
}

function unsupported(specifier) {
  return new Error(
    `Template imports "${specifier}", which is not available to installed templates. ` +
      `Available modules: ${AVAILABLE}.`
  );
}

function bindImport(clause, specifier) {
  const source = `__modules[${JSON.stringify(specifier)}]`;
  const value = clause.trim();

  if (value.startsWith("*")) {
    const name = value.replace(/^\*\s*as\s+/, "").trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error(`Unsupported namespace import: "${value}"`);
    }
    return `const ${name} = ${source};`;
  }

  if (value.startsWith("{")) {
    return `const ${namedBindings(value)} = ${source};`;
  }

  // default, optionally followed by named or namespace bindings
  const comma = value.indexOf(",");
  const head = (comma === -1 ? value : value.slice(0, comma)).trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(head)) {
    throw new Error(`Unsupported default import: "${value}"`);
  }

  const parts = [`const ${head} = ${source}.default;`];
  const rest = comma === -1 ? "" : value.slice(comma + 1).trim();
  if (rest.startsWith("{")) parts.push(`const ${namedBindings(rest)} = ${source};`);
  else if (rest.startsWith("*")) {
    const name = rest.replace(/^\*\s*as\s+/, "").trim();
    parts.push(`const ${name} = ${source};`);
  } else if (rest) {
    throw new Error(`Unsupported import clause: "${value}"`);
  }
  return parts.join(" ");
}

function namedBindings(value) {
  const inner = value.trim().replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!inner) return "{}";
  const parts = inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      if (!match) throw new Error(`Unsupported import binding: "${part}"`);
      return match[2] ? `${match[1]}: ${match[2]}` : match[1];
    });
  return `{ ${parts.join(", ")} }`;
}

function rewrite(code) {
  let output = code;

  output = output.replace(
    /^[ \t]*import\s*["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (match, specifier) => {
      if (specifier === "svelte/internal/disclose-version") return "";
      if (specifier === "svelte/internal/client") return "";
      throw unsupported(specifier);
    }
  );

  output = output.replace(
    /^[ \t]*import\s+([\s\S]*?)\s+from\s*["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (match, clause, specifier) => {
      if (specifier === "svelte/internal/client") {
        if (!/^\*\s+as\s+\$/.test(clause.trim())) {
          throw new Error("Unsupported internal runtime import.");
        }
        return "";
      }
      if (specifier === "svelte/internal/disclose-version") return "";
      if (!KNOWN.has(specifier)) throw unsupported(specifier);
      return bindImport(clause, specifier);
    }
  );

  output = output.replace(/^[ \t]*export\s+default\s+/m, "const __default = ");

  if (/^[ \t]*(?:import|export)\b/m.test(output)) {
    throw new Error(
      "Template uses an import or export form the in-browser compiler cannot rewrite. " +
        "Keep template imports to static named, default, or namespace imports."
    );
  }
  if (output.includes("import.meta") || /(^|[^.\w$])import\s*\(/.test(output)) {
    throw new Error("Template uses a dynamic import, which installed templates do not support.");
  }

  return `${output}\nreturn __default;\n`;
}

function injectStyles(id, css) {
  if (!css || typeof document === "undefined") return;
  const selector = `style[data-markdownapps-template="${id}"]`;
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("style");
    element.dataset.markdownappsTemplate = id;
    document.head.append(element);
  }
  if (element.textContent !== css) element.textContent = css;
}

export async function compileTemplate(source, { id = "template" } = {}) {
  const key = `${id}:${hash(source)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const [{ compile }, modules] = await Promise.all([
    import("svelte/compiler"),
    hostRuntime(),
  ]);

  let compiled;
  try {
    compiled = compile(source, {
      filename: `${id}.svelte`,
      generate: "client",
      dev: false,
    });
  } catch (cause) {
    throw new Error(cause.message || `Could not compile ${id}.`);
  }

  const body = rewrite(compiled.js.code);
  injectStyles(id, compiled.css?.code || "");
  let component;
  try {
    const factory = new Function("$", "__modules", `"use strict";\n${body}`);
    component = factory(modules["svelte/internal/client"], modules);
  } catch (cause) {
    throw new Error(`Could not evaluate ${id}: ${cause.message}`);
  }

  if (typeof component !== "function") {
    throw new Error(`${id} did not compile to a component.`);
  }

  cache.set(key, component);
  return component;
}
