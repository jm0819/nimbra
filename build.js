// Bundles src/ into one self-contained HTML file.
// JSX -> JS (Babel), WAT -> wasm (wabt), React inlined so nothing needs a network except fonts.
const fs = require("fs");
const path = require("path");
const Babel = require("@babel/standalone");
const wabtInit = require("wabt");

const src = p => fs.readFileSync(path.join(__dirname, "src", p), "utf8");
const mod = p => fs.readFileSync(path.join(__dirname, "node_modules", p), "utf8");
const safe = js => js.replace(/<\/script/gi, "<\\/script");

(async () => {
  const wabt = await wabtInit();
  const wasm = wabt.parseWat("monthly.wat", src("monthly.wat")).toBinary({}).buffer;
  const wasmB64 = Buffer.from(wasm).toString("base64");

  const app = Babel.transform(src("app.jsx"), { presets: ["react"] }).code.replace("__WASM_BASE64__", wasmB64);
  const react = mod("react/umd/react.production.min.js");
  const reactDom = mod("react-dom/umd/react-dom.production.min.js");

  const head = `<title>Nimbra</title>
<meta name="description" content="Nimbra autumn 2026 lineup: a fictional device brand, built as a single-file front-end sample.">
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#080B19">
<meta property="og:title" content="Nimbra · Autumn 2026">
<meta property="og:description" content="A scroll-driven product site for a fictional device brand, built as one HTML file with React, CSS 3D, WebGL and WebAssembly.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23080B19'/%3E%3Ccircle cx='12' cy='12' r='4.2' fill='%239FB3FF'/%3E%3Cellipse cx='12' cy='12' rx='9.4' ry='4' fill='none' stroke='%239FB3FF' stroke-width='1.6' transform='rotate(-28 12 12)'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap">
<style>
${src("styles.css")}
</style>`;
  const body = `<div id="root"><div class="boot">Loading Nimbra…</div></div>
<script>${safe(react)}</script>
<script>${safe(reactDom)}</script>
<script>
${safe(app)}
</script>`;

  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  // Artifact version: the host adds doctype/head/body.
  fs.writeFileSync(path.join(__dirname, "dist", "nimbra-artifact.html"), head + "\n" + body + "\n");
  // Standalone export: a complete document you can save and open anywhere.
  fs.writeFileSync(path.join(__dirname, "dist", "index.html"),
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
  console.log("wasm bytes:", wasm.length, "| artifact KB:", (fs.statSync(path.join(__dirname, "dist", "nimbra-artifact.html")).size / 1024).toFixed(1));
})().catch(e => { console.error(e); process.exit(1); });
