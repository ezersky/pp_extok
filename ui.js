/**
 * Tokens to SCSS — ui.js (iframe context, no direct `penpot` access)
 *
 * Universal generator: for EVERY token set (TokenSet), no matter what it’s called,
 * it generates the `_<slug>.scss` file. Token references to each other (“{token.name}”) are turned
 * into references to SCSS variables ($slug-in-another-file), rather than being expanded into resolved values —
 * this is what “preserving inheritance” means.
 * If a token references a token FROM ANOTHER set,
 * the file adds `@use "<that-set>" as *;`.
 *
 * Compound token types:
 *  - typography → SCSS map ($<set>-typography) + @mixin <set>-typography($name)
 *  - shadow     → a regular $variable with a list of layers (box-shadow supports multiple values separated by commas)
 * The remaining types are scalar $variables (with px where they are units of measurement).
 */

// ---------------------------------------------------------------------------
// Utilites
// ---------------------------------------------------------------------------

function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[.\/_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const PX_TYPES = new Set(["spacing", "borderRadius", "borderWidth", "sizing", "dimension"]);
const REF_RE = /\{([^{}]+)\}/g;

function findRefs(str) {
  const refs = [];
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(str))) refs.push(m[1]);
  return refs;
}

function substitute(str) {
  return str.replace(/\{([^{}]+)\}/g, (_, refName) => "$" + slug(refName));
}

function scanValueForRefs(value, refs) {
  if (typeof value === "string") {
    findRefs(value).forEach((r) => refs.push(r));
  } else if (Array.isArray(value)) {
    value.forEach((v) => scanValueForRefs(v, refs));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => scanValueForRefs(v, refs));
  }
}

// ---------------------------------------------------------------------------
// Resolution of references between sets + topological order within a set
// ---------------------------------------------------------------------------

function buildBySet(setsData) {
  const bySet = new Map();
  setsData.forEach((set) => {
    const m = new Map();
    set.tokens.forEach((t) => m.set(t.name, t));
    bySet.set(set.name, m);
  });
  return bySet;
}

function collectDeps(token, currentSetName, bySet) {
  const refs = [];
  scanValueForRefs(token.value, refs);
  const sameSetDeps = new Set();
  const crossSetDeps = new Set();
  refs.forEach((refName) => {
    if (bySet.get(currentSetName).has(refName)) {
      sameSetDeps.add(refName);
    } else {
      for (const [setName, tokens] of bySet) {
        if (setName !== currentSetName && tokens.has(refName)) {
          crossSetDeps.add(setName);
          break;
        }
      }
    }
  });
  return { sameSetDeps, crossSetDeps };
}

function topoSortTokens(tokens, sameSetDepsMap) {
  const byName = new Map(tokens.map((t) => [t.name, t]));
  const visited = new Set();
  const result = [];
  function visit(name, stack) {
    if (visited.has(name) || stack.has(name)) return;
    const t = byName.get(name);
    if (!t) return;
    stack.add(name);
    (sameSetDepsMap.get(name) || new Set()).forEach((dep) => visit(dep, stack));
    stack.delete(name);
    visited.add(name);
    result.push(t);
  }
  tokens.forEach((t) => visit(t.name, new Set()));
  return result;
}

// ---------------------------------------------------------------------------
// Promotion of “number” tokens (e.g., base-module) used as a px multiplier
// in spacing/borderRadius/etc — they also need px, otherwise `$base-module * 3` won’t give px
// ---------------------------------------------------------------------------

function computePromotedPxNumbers(setsData) {
  const promoted = new Set();
  const allByName = new Map();
  setsData.forEach((set) => set.tokens.forEach((t) => allByName.set(t.name, t)));
  setsData.forEach((set) => {
    set.tokens.forEach((t) => {
      if (PX_TYPES.has(t.type) && typeof t.value === "string") {
        findRefs(t.value).forEach((refName) => {
          const refToken = allByName.get(refName);
          if (refToken && refToken.type === "number") promoted.add(refName);
        });
      }
    });
  });
  return promoted;
}

// ---------------------------------------------------------------------------
// Formatting values by token type
// ---------------------------------------------------------------------------

function formatScalarValue(token, promotedPxNumbers) {
  const { type, value, resolvedValue } = token;

  if (typeof value === "string" && /\{[^{}]+\}/.test(value)) {
    return substitute(value); // сохраняем ссылку как SCSS-выражение
  }
  if (type === "fontFamilies" && Array.isArray(value)) {
    return value.map((f) => `"${f}"`).join(", ");
  }
  // IMPORTANT: for colors, use the raw value, not resolvedValue — Penpot loses the alpha channel
  // in resolvedValue for rgba() literals (e.g., "rgba(38,38,38,0.28)" -> "#262626").
  if (type === "color") {
    return typeof value === "string" ? value : `${resolvedValue}`;
  }

  const v = resolvedValue !== undefined && resolvedValue !== null ? resolvedValue : value;

  if (PX_TYPES.has(type) || (type === "number" && promotedPxNumbers.has(token.name))) {
    return v === 0 || v === "0" ? "0" : `${v}px`;
  }
  if (type === "fontSizes") return `${v}px`;
  if (type === "letterSpacing") return v === 0 || v === "0" ? "0" : `${v}px`;
  if (type === "rotation") return `${v}deg`;
  return `${v}`;
}

function formatShadowValue(token) {
  const layers = Array.isArray(token.value) ? token.value : [token.value];
  return layers
    .map((layer) => {
      const inset = layer.inset ? "inset " : "";
      const color =
        typeof layer.color === "string" && /\{[^{}]+\}/.test(layer.color)
          ? substitute(layer.color)
          : layer.color;
      return `${inset}${layer.offsetX}px ${layer.offsetY}px ${layer.blur}px ${layer.spread}px ${color}`;
    })
    .join(", ");
}

const TYPOGRAPHY_KEY_MAP = [
  ["fontFamily", "font-family"],
  ["fontSize", "font-size"],
  ["fontWeight", "font-weight"],
  ["lineHeight", "line-height"],
  ["letterSpacing", "letter-spacing"],
  ["textCase", "text-transform"],
  ["textDecoration", "text-decoration"],
];

function formatTypographyEntry(token) {
  const value = token.value || {};
  const entries = [];
  for (const [key, cssKey] of TYPOGRAPHY_KEY_MAP) {
    let raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) raw = raw[0];
    if (typeof raw !== "string") continue;
    const formatted = /\{[^{}]+\}/.test(raw) ? substitute(raw) : `"${raw}"`;
    entries.push(`    ${cssKey}: ${formatted}`);
  }
  return entries.join(",\n");
}

// ---------------------------------------------------------------------------
// Generating one file per set of tokens
// ---------------------------------------------------------------------------

function generateSetFile(set, bySet, promotedPxNumbers) {
  const crossSetDeps = new Set();
  const sameSetDepsMap = new Map();

  set.tokens.forEach((t) => {
    const { sameSetDeps, crossSetDeps: csd } = collectDeps(t, set.name, bySet);
    sameSetDepsMap.set(t.name, sameSetDeps);
    csd.forEach((s) => crossSetDeps.add(s));
  });

  const ordered = topoSortTokens(set.tokens, sameSetDepsMap);
  const setSlug = slug(set.name);

  const lines = [];
  lines.push("// ============================================================================");
  lines.push(`// Сгенерировано плагином "S3M Tokens → SCSS" — набор токенов: ${set.name}`);
  lines.push("// Ссылки между токенами сохранены как SCSS-переменные (наследование не разворачивается");
  lines.push("// в resolved-значения). Файл не редактировать вручную — пересоберите его плагином.");
  lines.push("// ============================================================================");

  if (crossSetDeps.size) {
    [...crossSetDeps].forEach((depSetName) => lines.push(`@use "${slug(depSetName)}" as *;`));
    lines.push("");
  }

  const typographyTokens = [];
  const seenVarNames = new Set();

  ordered.forEach((t) => {
    if (t.type === "typography") {
      typographyTokens.push(t);
      return;
    }
    const varName = "$" + slug(t.name);
    if (seenVarNames.has(varName)) {
      console.warn(`[S3M Tokens → SCSS] Коллизия имён: несколько токенов в наборе "${set.name}" дают одинаковую SCSS-переменную ${varName}`);
    }
    seenVarNames.add(varName);

    const valueExpr = t.type === "shadow" ? formatShadowValue(t) : formatScalarValue(t, promotedPxNumbers);
    lines.push(`${varName}: ${valueExpr};`);
  });

  if (typographyTokens.length) {
    lines.push("");
    lines.push(`$${setSlug}-typography: (`);
    typographyTokens.forEach((t, i) => {
      const body = formatTypographyEntry(t);
      const comma = i < typographyTokens.length - 1 ? "," : "";
      lines.push(`  "${t.name}": (\n${body}\n  )${comma}`);
    });
    lines.push(");");
    lines.push("");
    lines.push(`@mixin ${setSlug}-typography($name) {`);
    lines.push(`  $t: map-get($${setSlug}-typography, $name);`);
    lines.push("  font-family: map-get($t, font-family);");
    lines.push("  font-size: map-get($t, font-size);");
    lines.push("  font-weight: map-get($t, font-weight);");
    lines.push("  line-height: map-get($t, line-height);");
    lines.push("  letter-spacing: map-get($t, letter-spacing);");
    lines.push("}");
  }

  return { filename: `_${setSlug}.scss`, content: lines.join("\n") + "\n" };
}

function generateIndexFile(setsData) {
  const lines = [
    "// Автосгенерированный индекс — форвардит все наборы токенов в исходном порядке приоритета Penpot",
    "// (Global-подобные наборы обычно идут раньше Theme-наборов, которые на них ссылаются)",
    "",
  ];
  setsData.forEach((set) => lines.push(`@forward "${slug(set.name)}";`));
  return { filename: "_index.scss", content: lines.join("\n") + "\n" };
}

function generateAll(setsData) {
  const bySet = buildBySet(setsData);
  const promotedPxNumbers = computePromotedPxNumbers(setsData);
  const files = setsData.map((set) => generateSetFile(set, bySet, promotedPxNumbers));
  files.push(generateIndexFile(setsData));
  return files;
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (STORED, no compression) — no external dependencies.
// ---------------------------------------------------------------------------

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function buildZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dataBytes.length, true);
    local.setUint32(22, dataBytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    localParts.push(new Uint8Array(local.buffer), nameBytes, dataBytes);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dataBytes.length, true);
    central.setUint32(24, dataBytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralParts.push(new Uint8Array(central.buffer), nameBytes);

    offset += local.buffer.byteLength + nameBytes.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const centralOffset = offset;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);
  end.setUint16(20, 0, true);

  const allParts = [...localParts, ...centralParts, new Uint8Array(end.buffer)];
  const total = allParts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  allParts.forEach((p) => {
    result.set(p, pos);
    pos += p.length;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Connection with the user interface: messages ↔ sandbox, file list renderer, loading
// ---------------------------------------------------------------------------
// Protected so that the pure logic of this file (generateAll, buildZip, etc.) can be
// used and tested in a regular Node.js context without DOM (see the test/ folder)
if (typeof document !== "undefined") {

let generatedFiles = [];

const statusEl = document.getElementById("status");
const filesEl = document.getElementById("files");
const zipBtn = document.getElementById("zip-btn");
const generateBtn = document.getElementById("generate-btn");

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

function triggerDownload(filename, blobParts, mime) {
  const blob = new Blob(blobParts, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderFiles(files) {
  filesEl.innerHTML = "";
  files.forEach((f) => {
    const li = document.createElement("li");

    const meta = document.createElement("div");
    meta.className = "meta";
    const nameEl = document.createElement("div");
    nameEl.className = "filename";
    nameEl.textContent = f.filename;
    const countEl = document.createElement("div");
    countEl.className = "count";
    countEl.textContent = `${f.content.split("\n").length} строк`;
    meta.append(nameEl, countEl);

    const btn = document.createElement("button");
    btn.textContent = "Скачать";
    btn.addEventListener("click", () => triggerDownload(f.filename, [f.content], "text/x-scss"));

    li.append(meta, btn);
    filesEl.appendChild(li);
  });
  zipBtn.style.display = files.length ? "block" : "none";
}

generateBtn.addEventListener("click", () => {
  setStatus("Запрашиваю токены из файла…");
  generateBtn.disabled = true;
  window.parent.postMessage({ type: "request-tokens" }, "*");
});

zipBtn.addEventListener("click", () => {
  const zipBytes = buildZip(generatedFiles.map((f) => ({ name: f.filename, content: f.content })));
  triggerDownload("s3m-tokens-scss.zip", [zipBytes], "application/zip");
});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "tokens-error") {
    setStatus("Ошибка при чтении токенов: " + msg.message, true);
    generateBtn.disabled = false;
    return;
  }
  if (msg.type !== "tokens-data") return;

  try {
    generatedFiles = generateAll(msg.sets);
    renderFiles(generatedFiles);
    setStatus(`Готово: ${generatedFiles.length} файлов из ${msg.sets.length} наборов токенов.`);
  } catch (err) {
    setStatus("Ошибка генерации: " + (err && err.message ? err.message : err), true);
    console.error(err);
  } finally {
    generateBtn.disabled = false;
  }
});

} // end DOM guard

if (typeof module !== "undefined") {
  module.exports = { generateAll, buildZip, slug, generateSetFile, generateIndexFile };
}
