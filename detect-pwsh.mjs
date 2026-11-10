#!/usr/bin/env node
/**
 * Repro / verification for Alma issue #242
 *   https://github.com/yetone/alma-releases/issues/242
 *
 * Demonstrates that a Microsoft Store-installed PowerShell 7 is invisible to
 * Alma's `fs.existsSync`-based pwsh discovery, even though the App Execution
 * Alias exists and can be spawned successfully.
 *
 * Run with the SAME runtime Alma uses:
 *   "C:\Users\<you>\AppData\Local\Programs\Alma\alma-server\runtime\node.exe" detect-pwsh.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PWsh = "pwsh.exe";
const alias = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", PWsh);
const pf7 = path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", PWsh);
const pf7pre = path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7-preview", PWsh);
const pf86 = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "PowerShell", "7", PWsh);
const pkgRoot = "C:\\Program Files\\WindowsApps";

const rows = [];
const record = (probe, result) => rows.push([probe, String(result)]);

record("existsSync(alias)", fs.existsSync(alias));
try {
  const names = fs.readdirSync(path.dirname(alias)).map((n) => String(n).toLowerCase());
  record("readdir(WindowsApps) contains pwsh.exe", names.includes(PWsh.toLowerCase()));
} catch (e) {
  record("readdir(WindowsApps)", "ERR " + e.code);
}
try {
  const r = spawnSync(alias, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
    encoding: "utf8",
    timeout: 20000,
  });
  record("spawnSync(alias) status", r.status);
  record("spawnSync(alias) version", (r.stdout || "").trim() || "(empty)");
} catch (e) {
  record("spawnSync(alias)", "ERR " + e.message);
}
record("existsSync(ProgramFiles\\PowerShell\\7)", fs.existsSync(pf7));
record("existsSync(ProgramFiles\\PowerShell\\7-preview)", fs.existsSync(pf7pre));
record("existsSync(ProgramFiles(x86)\\PowerShell\\7)", fs.existsSync(pf86));
try {
  fs.readdirSync(pkgRoot);
  record("readdir(C:\\Program Files\\WindowsApps)", "OK (unexpected)");
} catch (e) {
  record("readdir(C:\\Program Files\\WindowsApps)", "ERR " + e.code);
}

// --- the two resolvers -----------------------------------------------------

/** Current upstream behaviour: existsSync only. */
function resolveCurrent(env = process.env, exists = fs.existsSync) {
  for (const dir of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const c = path.join(dir, PWsh);
    if (exists(c)) return c;
  }
  for (const c of [pf7, pf7pre, pf86, alias]) {
    if (c && exists(c)) return c;
  }
  return "powershell.exe";
}

/** Proposed behaviour: fall back to a readdir name match. */
function resolvePatched(env = process.env, exists = fs.existsSync) {
  const ok = (candidate) => {
    if (!candidate) return false;
    if (exists(candidate)) return true;
    try {
      const dir = path.dirname(candidate);
      const base = path.basename(candidate).toLowerCase();
      return fs.readdirSync(dir).some((n) => String(n).toLowerCase() === base);
    } catch {
      return false;
    }
  };
  for (const dir of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const c = path.join(dir, PWsh);
    if (ok(c)) return c;
  }
  for (const c of [pf7, pf7pre, pf86, alias]) {
    if (ok(c)) return c;
  }
  return "powershell.exe";
}

const current = resolveCurrent();
const patched = resolvePatched();

const w = Math.max(...rows.map((r) => r[0].length));
console.log("Probe".padEnd(w) + " | Result");
console.log("-".repeat(w) + "-+-" + "-".repeat(8));
for (const [k, v] of rows) console.log(k.padEnd(w) + " | " + v);

console.log("");
console.log("current resolver ->", current);
console.log("patched resolver ->", patched);

const buggy = current.toLowerCase().endsWith(PWsh.toLowerCase()) === false;
console.log("");
console.log(buggy ? "BUG PRESENT: pwsh 7 not detected, fell back to Windows PowerShell 5.1" : "OK: pwsh 7 detected");
console.log(patched.toLowerCase().endsWith(PWsh.toLowerCase()) ? "PATCH WORKS: pwsh 7 resolved" : "PATCH INEFFECTIVE");
