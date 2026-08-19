import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = path.resolve("artifacts/dojrp/dist/public");
const indexFile = path.join(outDir, "index.html");

copyFileSync(indexFile, path.join(outDir, "404.html"));
writeFileSync(path.join(outDir, ".nojekyll"), "");
console.log("Prepared GitHub Pages fallback files in", outDir);
