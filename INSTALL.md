# Install

Two independent install paths. You can use either one alone.

## 1. User-level skills (no install, no restart)

These are plain markdown bundles discovered from the DSH home directory.

```
copy skills\*  ->  %USERPROFILE%\.dsh\skills\
```

Result:

```
~/.dsh/skills/
├── casino-compliance/SKILL.md
├── casino-game-math/SKILL.md
├── casino-rng-provably-fair/SKILL.md
├── casino-wallet-ledger/SKILL.md
├── client-code-intake/SKILL.md
├── creative-designer/SKILL.md
├── diagram-and-wireframe/SKILL.md
├── game-assets/SKILL.md
├── game-backend/SKILL.md
├── game-client-2d/SKILL.md
├── game-client-3d/SKILL.md
├── game-design/SKILL.md
├── game-netcode/SKILL.md
├── game-quality-gate/SKILL.md
├── live-preview-gate/SKILL.md
├── project-quality-chain/SKILL.md
├── senior-app-security/SKILL.md
├── senior-background-jobs/SKILL.md
├── senior-code-craft/SKILL.md
├── senior-database-design/SKILL.md
├── senior-frontend-engineering/SKILL.md
├── senior-production-defaults/SKILL.md
├── senior-quality-gate/SKILL.md
├── stack-index/SKILL.md
├── stack-php-mysql/SKILL.md
├── stack-python/SKILL.md
└── ui-design/SKILL.md
```

Each directory holds a `SKILL.md` with YAML frontmatter (`name`, `description`), then the body.

**Verification:** the skill appears in the catalog on the next model turn. The filesystem provider watches the directory, so no restart and no install step is needed.

```powershell
# confirm the loader sees them
Get-ChildItem "$env:USERPROFILE\.dsh\skills" -Directory | ForEach-Object { $_.Name }
```

If a skill does not appear, the frontmatter is malformed — the first line must be `---`, and `name` and `description` must both be present.

## 2. Plugin packages

These register skills programmatically and inject the compact policy sections into the system prompt. They are npm packages consumed through a DSH profile.

```powershell
# from a profile directory, e.g. ~/.dsh/profiles/desktop
pnpm add file:<path-to>\plugins\dsh-deepseek-harness-skills
pnpm add file:<path-to>\plugins\dsh-senior-engineering-skills
```

Then confirm both appear in the profile's `package.json` `dsh.profile.bundles` list and restart DSH.

**Restart is required for plugin packages.** The skill bodies are read into an ESM module at import time, so an edited file on disk does not reach a running session until it restarts. A file-level `pnpm install` also does not re-copy a changed `file:` dependency; remove the installed package directory and `node_modules/.modules.yaml` first.

## Verifying the whole install

1. Catalog size: 27 user skills + 11 plugin skills + 3 core skills (`sandbox-mode`, `plannable`, `organizer`) = 41, plus the harness's own bundled skills.
2. `senior-code-review` must contain the line beginning `> **Stack:**` — that is the bridge to `stack-php-mysql`.
3. Ask for a code review on a Laravel change. Expected automatic loads: `senior-code-review` + `stack-php-mysql`, plus `senior-app-security` when the change touches auth or input.

## Uninstall

- User-level: delete the skill's directory under `~/.dsh/skills/`. Takes effect immediately.
- Plugin: `pnpm remove dsh-deepseek-harness-skills dsh-senior-engineering-skills` from the profile, then restart.
