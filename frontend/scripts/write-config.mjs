import { copyFile, mkdir, writeFile } from "node:fs/promises";

// Keep production usable if a host misses the build-time variable. Explicit
// VITE_API_BASE_URL values still take precedence for previews and other setups.
const defaultApiBase = "https://linkedin-assistant-api-8plp.onrender.com";
const apiBase = (process.env.VITE_API_BASE_URL || defaultApiBase).replace(/\/$/, "");
const outputDir = new URL("../public/", import.meta.url);
await mkdir(outputDir, { recursive: true });
for (const file of ["app.js", "admin.html", "admin.js", "admin.css"]) {
  await copyFile(new URL(`../${file}`, import.meta.url), new URL(file, outputDir));
}
await writeFile(
  new URL("config.js", outputDir),
  `window.LINKEDIN_API_BASE = ${JSON.stringify(apiBase)};\n`,
);
