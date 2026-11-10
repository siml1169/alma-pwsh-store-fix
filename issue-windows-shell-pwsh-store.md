## Summary

With `general.windowsShell = "powershell"`, Alma's Bash tool still runs **Windows PowerShell 5.1** instead of **PowerShell 7 (pwsh)** on a machine where pwsh 7 *is* installed — because it was installed from the **Microsoft Store** rather than the MSI.

The setting itself is honored (it is not silently falling back to `auto`/Git Bash), but pwsh discovery fails, so the `powershell.exe` fallback is used. Users on a Store-installed pwsh get a silent downgrade to 5.1 with no indication why.

## Environment

- Alma: `v0.4.567` (`alma-server 0.4.567`, `node v24.22.2`, `abi 137`, `platform windows/amd64`)
- OS: Windows 11 Pro `10.0.26200` (build 26200), AMD64
- Setting: `general.windowsShell = "powershell"` (confirmed in `app_settings.settings_data`)
- PowerShell 7: **Store package** — `Microsoft.PowerShell 7.6.9.0`
  - `InstallLocation`: `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.9.0_x64__8wekyb3d8bbwe`
- Git for Windows `2.55.0.windows.3` is also installed — notable because if the setting were being ignored and `auto` were used, the tool would pick Git Bash. It does not, so the preference *is* being read.

## Evidence / Reproduction

Inside Alma's Bash tool, with `windowsShell = "powershell"`:

```
PSVersion: 5.1.26100.9711
Edition:   Desktop
Exe:       C:\windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

Expected: PS 7.6.9.

Directly invoking the installed pwsh 7 works fine from the same session:

```
> & "$env:LOCALAPPDATA\Microsoft\WindowsApps\pwsh.exe" -NoProfile -Command '...'
7.6.9
```

### Root cause

`pwsh.exe` discovery (`deo()` in `lib/server.mjs`) checks these candidates via `fs.existsSync` only:

1. every `PATH` entry → `<dir>\pwsh.exe`
2. `%ProgramFiles%\PowerShell\7\pwsh.exe`
3. `%ProgramFiles%\PowerShell\7-preview\pwsh.exe`
4. `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe`
5. `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`

The MSI installer puts pwsh at **#2**, but the Store package only provides **#5** — an *App Execution Alias*, i.e. a 0-byte package reparse point. **`fs.existsSync()` returns `false` for that alias**, so the resolver walks past every candidate and returns the literal fallback `"powershell.exe"` (Windows PowerShell 5.1).

Probed from Alma's own bundled runtime (`alma-server\runtime\node.exe`), which is what actually runs this code:

| Probe | Result |
| --- | --- |
| `fs.existsSync(%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe)` | **`false`** ← the bug |
| `fs.readdirSync(%LOCALAPPDATA%\Microsoft\WindowsApps)` | contains **`pwsh.exe`** |
| `spawnSync(alias, [...])` | **status 0**, stdout `7.6.9` |
| `fs.existsSync("C:\Program Files\PowerShell\7\pwsh.exe")` | `false` (MSI layout absent) |
| `fs.readdirSync("C:\Program Files\WindowsApps")` | **`EPERM`** — enumerating the package dir is not a viable fallback |

So the alias genuinely exists and is genuinely spawnable — only `existsSync` is blind to it. Note `readdir` *is* permitted on the user-level `WindowsApps` dir, which makes a directory-name match a reliable existence test.

## Proposed fix

Make candidate existence detection fall back to a `readdir` name match when `existsSync` says no. Minimal change inside `deo()`:

```diff
-function deo(t=process.env,e=Pue.existsSync){
+function deo(t=process.env,e=Pue.existsSync){
+  let ok=n=>{
+    if(!n)return!1;
+    if(e(n))return!0;
+    try{
+      let d=ad.dirname(n),b=ad.basename(n).toLowerCase();
+      return Pue.readdirSync(d).some(x=>String(x).toLowerCase()===b)
+    }catch{return!1}
+  };
   for(let n of(t.PATH||"").split(ad.delimiter).filter(Boolean)){
     let i=ad.join(n,CG);
-    if(e(i))return i
+    if(ok(i))return i
   }
   let r=[ /* ...same candidate list... */ ];
-  for(let n of r)if(n&&e(n))return n;
+  for(let n of r)if(ok(n))return n;
   return aeo
 }
```

Applied to the shipped `lib/server.mjs`, the patched resolver now returns:

```
resolved   = C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\pwsh.exe
spawned    = 7.6.9   (status 0)
node --check lib/server.mjs -> exit 0
```

### Why not just enumerate the package

`C:\Program Files\WindowsApps` returns `EPERM` to the app runtime, so resolving the real `Microsoft.PowerShell_*` package directory is not an option without elevation. The user-level alias directory is readable, so the `readdir` approach covers the Store case without any elevation change.

### Optional hardening

- After resolving a candidate, optionally confirm it by spawning it (`pwsh.exe -NoProfile -Command ''`) with a short timeout, so a broken alias falls through to the next candidate instead of producing a shell that cannot start.
- Consider surfacing which shell was actually resolved somewhere user-visible (log line / settings hint), since today the downgrade is completely silent. The settings copy already documents the intent: *"PowerShell means PowerShell 7 (pwsh) when it is installed, otherwise the built-in Windows PowerShell 5.1."* — it just cannot see a Store-installed pwsh.

## Workaround (no code change)

Install pwsh from the MSI instead of the Store, so it lands at `%ProgramFiles%\PowerShell\7\`:

```
winget install --id Microsoft.PowerShell --source winget
```

This is a workaround for the user, not a fix — the Store install remains a supported way to get pwsh and should not silently degrade the tool shell.

## Related

- #44 — same shell-resolution module, opposite symptom (Git Bash being preferred and breaking `alma` calls). Both are resolved by making backend detection robust; worth reviewing together.
