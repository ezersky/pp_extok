/**
 * Tokens in SCSS — plugin.js (sandbox context)
 * Works only with `penpot.library.local.tokens`. It does not make any changes to the file —
 * it only reads all sets of tokens (Global/*, Theme/* and any others that are in the file)
 * and forwards them to the plugin interface (index.html/ui.js), where SCSS generation
 * and downloading take place. All generation/downloading is done in an iframe, as DOM/Blob APIs are available there,
 * which are not available in this sandbox context.
 */

penpot.ui.open("S3M Tokens → SCSS", "index.html", { width: 420, height: 640 });

function serializeTokenCatalog() {
  const catalog = penpot.library.local.tokens;
  return {
    sets: catalog.sets.map((set) => ({
      name: set.name,
      active: set.active,
      tokens: set.tokens.map((t) => ({
        name: t.name,
        type: t.type,
        value: t.value,
        resolvedValue: t.resolvedValue,
      })),
    })),
  };
}

penpot.ui.onMessage((message) => {
  if (message && message.type === "request-tokens") {
    try {
      const data = serializeTokenCatalog();
      penpot.ui.sendMessage({ type: "tokens-data", sets: data.sets });
    } catch (err) {
      penpot.ui.sendMessage({ type: "tokens-error", message: String(err && err.message || err) });
    }
  }
});
