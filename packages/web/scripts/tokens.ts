// Writes src/tokens.css from the design tokens (packages/client/src/tokens.ts).
// `--check` fails instead when the file is out of date (run by `pnpm test`).
import { readFileSync, writeFileSync } from "node:fs";
import { tokensCss } from "@mdb/client";

const file = new URL("../src/tokens.css", import.meta.url);
const css = tokensCss();
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    /* missing: out of date */
  }
  if (current !== css) {
    console.error("src/tokens.css is out of date: run `pnpm --filter @mdb/web tokens`.");
    process.exit(1);
  }
  console.log("src/tokens.css is up to date.");
} else {
  writeFileSync(file, css);
  console.log("Wrote src/tokens.css.");
}
