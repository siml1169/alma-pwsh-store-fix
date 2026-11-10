#!/usr/bin/env node
/**
 * Applies the pwsh Store-alias detection fix to a locally installed Alma bundle.
 * Writes a .bak-pwsh backup next to the file before touching it.
 *
 *   node apply-patch.mjs            # patch
 *   node apply-patch.mjs --revert   # restore from backup
 *   node apply-patch.mjs --check    # dry run
 *
 * Issue: https://github.com/yetone/alma-releases/issues/242
 */
import fs from "node:fs";
import path from "node:path";

const OLD = 'function deo(t=process.env,e=Pue.existsSync){for(let n of(t.PATH||"").split(ad.delimiter).filter(Boolean)){let i=ad.join(n,CG);if(e(i))return i}';
const NEW = 'function deo(t=process.env,e=Pue.existsSync){let ok=n=>{if(!n)return!1;if(e(n))return!0;try{let d=ad.dirname(n),b=ad.basename(n).toLowerCase();return Pue.readdirSync(d).some(x=>String(x).toLowerCase()===b)}catch{return!1}};for(let n of(t.PATH||"").split(ad.delimiter).filter(Boolean)){let i=ad.join(n,CG);if(ok(i))return i}';

const args = new Set(process.argv.slice(2));
const target =
  process.argv.find((a) => a.includes("server.mjs")) ||
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Alma", "alma-server", "lib", "server.mjs");

if (!fs.existsSync(target)) {
  console.error("server.mjs not found at: " + target);
  process.exit(1);
}
const bak = target + ".bak-pwsh";

if (args.has("--revert")) {
  if (!fs.existsSync(bak)) { console.error("No backup at " + bak); process.exit(1); }
  fs.copyFileSync(bak, target);
  console.log("Reverted from " + bak);
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");

if (src.includes(NEW)) { console.log("Already patched."); process.exit(0); }
if (!src.includes(OLD)) { console.error("Target function not found - bundle layout changed."); process.exit(2); }

const patched = src.replace(OLD, NEW);
const occurrences = src.split(OLD).length - 1;
console.log("Matched " + occurrences + " occurrence(s); size " + src.length + " -> " + patched.length);

if (args.has("--check")) { console.log("Dry run only, nothing written."); process.exit(0); }

if (!fs.existsSync(bak)) fs.copyFileSync(target, bak);
fs.writeFileSync(target, patched, "utf8");
console.log("Patched " + target);
console.log("Backup  " + bak);
console.log("Restart Alma for the change to take effect.");
