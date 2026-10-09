// Capacitor builds the native side of each plugin listed in this package, while
// the JS side is bundled from packages/web. Both must name the same versions.
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const android = read("../package.json").dependencies;
const web = read("../../web/package.json").dependencies;

const capacitor = (name) => name.startsWith("@capacitor/") || name.includes("capacitor-");
const problems = [];
for (const [name, version] of Object.entries(web)) {
  if (!capacitor(name)) continue;
  if (!(name in android)) problems.push(`${name} is used by the web app but missing here`);
  else if (android[name] !== version) problems.push(`${name}: web ${version}, android ${android[name]}`);
}
for (const name of Object.keys(android)) {
  if (capacitor(name) && name !== "@capacitor/android" && !(name in web)) {
    problems.push(`${name} is listed here but not used by the web app`);
  }
}
if (problems.length) {
  console.error("Capacitor plugins differ between packages/web and packages/android:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("Capacitor plugins match packages/web.");
