# alma-pwsh-store-fix

Fix + repro for Alma issue **[#242](https://github.com/yetone/alma-releases/issues/242)**:

> With `general.windowsShell = "powershell"`, Alma's Bash tool still runs **Windows PowerShell 5.1**
> instead of **PowerShell 7 (pwsh)** when pwsh was installed from the **Microsoft Store**.

---

## The bug in one line

Alma finds `pwsh.exe` with `fs.existsSync` only. The Microsoft Store does **not** install pwsh to
`C:\Program Files\PowerShell\7\` - it registers an *App Execution Alias* at
`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`, a 0-byte package reparse point that
**`fs.existsSync` reports as missing**, even though it exists and runs fine.

Every candidate therefore fails, and the resolver returns its literal fallback `powershell.exe`
-> Windows PowerShell 5.1. The downgrade is completely silent.

## Reproduce it

Run with the **same runtime Alma uses**, not your system node:

```powershell
& "$env:LOCALAPPDATA\Programs\Alma\alma-server\runtime\node.exe" detect-pwsh.mjs
```

Output on a Store-installed pwsh 7.6.9 / Windows 11 26200:

```
Probe                                         | Result
----------------------------------------------+---------
existsSync(alias)                             | false
readdir(WindowsApps) contains pwsh.exe        | true
spawnSync(alias) status                       | 0
spawnSync(alias) version                      | 7.6.9
existsSync(ProgramFiles\PowerShell\7)         | false
existsSync(ProgramFiles\PowerShell\7-preview) | false
existsSync(ProgramFiles(x86)\PowerShell\7)    | false
readdir(C:\Program Files\WindowsApps)         | ERR EPERM

current resolver -> powershell.exe
patched resolver -> C:\Users\<you>\AppData\Local\Microsoft\WindowsApps\pwsh.exe

BUG PRESENT: pwsh 7 not detected, fell back to Windows PowerShell 5.1
PATCH WORKS: pwsh 7 resolved
```

Note `readdir` **is** allowed on the user-level `WindowsApps` folder, while the real package
directory (`C:\Program Files\WindowsApps`) returns `EPERM`. That is why the fix tests for the
alias by directory listing instead of trying to resolve the package.

## The fix

In `deo()` (the pwsh resolver in `alma-server/lib/server.mjs`), fall back to a `readdir` name
match when `existsSync` says no:

```js
let ok = n => {
  if (!n) return false;
  if (e(n)) return true;                     // fast path, unchanged
  try {
    let d = ad.dirname(n), b = ad.basename(n).toLowerCase();
    return Pue.readdirSync(d).some(x => String(x).toLowerCase() === b);
  } catch { return false; }
};
```

then use `ok(...)` instead of `e(...)` for both the `PATH` scan and the fixed candidate list.

- `fix-pwsh-store-alias.patch` - the change against the shipped bundle
- `apply-patch.mjs` - applies it to a local Alma install (backs up first)

```powershell
node apply-patch.mjs --check     # dry run
node apply-patch.mjs             # patch + backup
node apply-patch.mjs --revert    # restore
```

Restart Alma afterwards; the resolver caches its result per session.

## Caveats

- This patches a **built bundle**. An Alma update overwrites `server.mjs` and undoes it - rerun
  `apply-patch.mjs`, or apply the change upstream.
- If the alias is broken/stale, `readdir` will still report it. Optional hardening: spawn the
  resolved candidate once with a short timeout and fall through on failure.
- Storage location matters, not pwsh version. MSI installs land at
  `%ProgramFiles%\PowerShell\7\` and are detected correctly today.

## Workaround (no patching)

```powershell
winget install --id Microsoft.PowerShell --source winget
```

Installs the MSI layout to `%ProgramFiles%\PowerShell\7\`, which Alma already finds. This works
around the user's problem but leaves the Store install path broken.

## Related

- [#44](https://github.com/yetone/alma-releases/issues/44) - same resolver module, opposite
  symptom (Git Bash being preferred and breaking bundled `alma` CLI calls).
