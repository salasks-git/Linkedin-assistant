import { copyFile, mkdir, writeFile } from "node:fs/promises";

const apiBase = (process.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const outputDir = new URL("../public/", import.meta.url);
await mkdir(outputDir, { recursive: true });
for (const file of ["app.js", "admin.html", "admin.js", "admin.css"]) {
  await copyFile(new URL(`../${file}`, import.meta.url), new URL(file, outputDir));
}
await writeFile(
  new URL("config.js", outputDir),
  `window.LINKEDIN_API_BASE = ${JSON.stringify(apiBase)};\n`,
);
