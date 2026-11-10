#!/usr/bin/env node
/**
 * Applies the pwsh Store-alias detection fix to a locally installed Alma bundle.
 *
 *   node apply-patch.mjs            # patch (backs up first)
 *   node apply-patch.mjs --check    # dry run
 *   node apply-patch.mjs --revert   # restore from backup
 *
 * Issue: https://github.com/yetone/alma-releases/issues/242
 *
 * NOTE: no UTF-8 BOM here on purpose. A BOM would stop Node from recognising
 * the `#!` line, so `./apply-patch.mjs` would fail even though
 * `node apply-patch.mjs` happens to work.
 */
import fs from "node:fs";
import path from "node:path";

// Replaces the WHOLE resolver, including the fixed-candidate loop. Patching
// only the PATH scan would leave the WindowsApps candidate on existsSync and
// the original bug would survive.
const OLD = 'function deo(t=process.env,e=Pue.existsSync){for(let n of(t.PATH||"").split(ad.delimiter).filter(Boolean)){let i=ad.join(n,CG);if(e(i))return i}let r=[ad.join(t.ProgramFiles||"C:\\\\Program Files","PowerShell","7",CG),ad.join(t.ProgramFiles||"C:\\\\Program Files","PowerShell","7-preview",CG),ad.join(t["ProgramFiles(x86)"]||"C:\\\\Program Files (x86)","PowerShell","7",CG),ad.join(t.LOCALAPPDATA||"","Microsoft","WindowsApps",CG)];for(let n of r)if(n&&e(n))return n;return aeo}';

const NEW = 'function deo(t=process.env,e=Pue.existsSync){let ok=n=>{if(!n)return!1;if(e(n))return!0;try{let d=ad.dirname(n),b=ad.basename(n).toLowerCase();return Pue.readdirSync(d).some(x=>String(x).toLowerCase()===b)}catch{return!1}};for(let n of(t.PATH||"").split(ad.delimiter).filter(Boolean)){let i=ad.join(n,CG);if(ok(i))return i}let r=[ad.join(t.ProgramFiles||"C:\\\\Program Files","PowerShell","7",CG),ad.join(t.ProgramFiles||"C:\\\\Program Files","PowerShell","7-preview",CG),ad.join(t["ProgramFiles(x86)"]||"C:\\\\Program Files (x86)","PowerShell","7",CG),ad.join(t.LOCALAPPDATA||"","Microsoft","WindowsApps",CG)];for(let n of r)if(ok(n))return n;return aeo}';

const args = new Set(process.argv.slice(2));
const explicit = process.argv.find((a) => a.toLowerCase().endsWith("server.mjs"));
const target =
  explicit || path.join(process.env.LOCALAPPDATA || "", "Programs", "Alma", "alma-server", "lib", "server.mjs");
const bak = target + ".bak-pwsh";

if (!fs.existsSync(target)) {
  console.error("server.mjs not found at: " + target);
  process.exit(1);
}

if (args.has("--revert")) {
  if (!fs.existsSync(bak)) {
    console.error("No backup at " + bak);
    process.exit(1);
  }
  fs.copyFileSync(bak, target);
  console.log("Reverted from " + bak);
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");

if (src.includes(NEW)) {
  console.log("Already patched.");
  process.exit(0);
}
if (!src.includes(OLD)) {
  console.error("Target resolver not found - the bundle layout has changed.");
  process.exit(2);
}

const patched = src.replace(OLD, NEW);
const count = src.split(OLD).length - 1;
console.log("Matched " + count + " resolver(s); size " + src.length + " -> " + patched.length);

// Verify both halves actually landed before writing anything.
const pathScanFixed = patched.includes("if(ok(i))return i");
const fixedLoopFixed = patched.includes("for(let n of r)if(ok(n))return n");
const oldLoopGone = !patched.includes("for(let n of r)if(n&&e(n))return n");
if (!pathScanFixed || !fixedLoopFixed || !oldLoopGone) {
  console.error(
    "Refusing to write: incomplete patch (pathScan=" +
      pathScanFixed +
      ", fixedLoop=" +
      fixedLoopFixed +
      ", oldLoopGone=" +
      oldLoopGone +
      ")"
  );
  process.exit(3);
}

if (args.has("--check")) {
  console.log("Dry run only, nothing written.");
  process.exit(0);
}

// Refresh the backup from the bundle we are about to change, so a later
// --revert restores THIS release and not a stale one from a previous update.
if (fs.existsSync(bak)) {
  const stale = fs.statSync(bak);
  const cur = fs.statSync(target);
  if (stale.mtimeMs < cur.mtimeMs) {
    console.log("Refreshing stale backup from the current bundle.");
  }
}
fs.copyFileSync(target, bak);

fs.writeFileSync(target, patched, "utf8");
console.log("Patched  " + target);
console.log("Backup   " + bak);
console.log("Restart Alma for the change to take effect.");
