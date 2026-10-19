# Sync the installed plugin copies with the source

`C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills` is the source of truth. Both DSH
surfaces run the **installed** copy under their profile:

- desktop app  -> `C:\Users\admin\.dsh\profiles\desktop\node_modules\dsh-deepseek-harness-skills`
- web / CLI    -> `C:\Users\admin\.dsh\profiles\web\node_modules\dsh-deepseek-harness-skills`

A plain `pnpm install` does **not** re-copy a changed `file:` directory dependency: pnpm reports
"Already up to date" and leaves the stale copy in place (recorded in
`..\..\..\xampp\htdocs\root-ai\tests\dsh-parity-audit\evidence\skills-policy-change.md`). The
working procedure, used and verified on 2026-10-01 and again here, is:

1. remove the installed package directory;
2. remove `.modules.yaml` and `.pnpm-workspace-state-v1.json` from the profile's `node_modules`, so
   pnpm cannot decide the tree is current;
3. run `pnpm install --config.confirmModulesPurge=false` in the profile directory;
4. compare SHA256 of `index.js` and every file under `prompts\` between source and the installed
   copy. A mismatch means the install did not take.

`sync-profiles.ps1` performs exactly those steps for both profiles, prints the hash comparison per
file, and exits non-zero if any file differs. It never edits `package.json`, `cordis.patch.yml` or
any bundle list: the organizer ships inside the package those already register.

Use it after changing anything in this plugin:

```powershell
pwsh -File tools\sync-profiles.ps1
```

A running surface keeps the previously imported module in memory. Files on disk are current
immediately; the running session picks the change up when it restarts or reloads plugins
(`patchReload: live` covers the `cordis.patch.yml` layer, not an already-imported ESM module).
