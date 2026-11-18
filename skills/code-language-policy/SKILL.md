---
name: code-language-policy
description: Keep everything inside the code English even when the conversation is in Bisaya, Tagalog or any other language - comments, identifiers, docstrings, commit messages, test names, docs and error messages - while user-facing copy lives in locale files. Use whenever writing or reviewing code, when the owner speaks another language, when a repository has mixed-language comments, or before a commit that contains non-English text in source.
---

# Code Language Policy

**The conversation has one language; the code has another.** The owner may speak Bisaya and still needs English inside the repository. These are not in conflict, and mixing them is what produces a codebase nobody else can read.

The rule: **English in the code, the owner's language in the chat, the product's language in the locale files.** Three surfaces, three languages, no overlap.

## The rule, per artifact

| Artifact | Language | Why |
|---|---|---|
| Chat replies, explanations | **the owner's language** | they asked in it |
| Identifiers: variables, functions, classes, files | **English** | searchable, portable, no encoding surprises |
| Comments and docstrings | **English** | the next developer may not read Bisaya |
| Commit messages | **English** | the history is read by tools and teammates |
| README, ADRs, docs | **English** | same reason |
| Test names and descriptions | **English** | a failing test is a sentence for everyone |
| Developer-facing errors and logs | **English** | they end up in monitoring and search |
| **User-facing UI copy** | **the product's locale** | may be Bisaya — but in a locale file, never inline in code |

The last row is the only place another language belongs in the repository, and it belongs in **one file per locale**, not scattered through components.

## Phase 1 — Find what is already wrong

```bash
# non-ASCII anywhere in source (excluding locale files)
git grep -nP '[^\x00-\x7F]' -- '*.js' '*.ts' '*.tsx' '*.php' '*.py' \
  ':(exclude)resources/lang/**' ':(exclude)lang/**' ':(exclude)locales/**' ':(exclude)*.po'

# common Bisaya/Tagalog tokens in code
grep -rnE '\b(ug|nga|kay|para|kung|dili|kaayo|mao|nimo|ato|ngan|unta)\b' \
  --include='*.js' --include='*.ts' --include='*.php' --include='*.py' .
```

Each hit is a finding with a `file:line`. Report the count, then the list.

**EVIDENCE: the two commands and their output, with a verdict per hit.**

## Phase 2 — Rewrite, do not rename blindly

- **Comments and docstrings**: translate to English, keep the meaning, keep the length. A comment that loses its reason in translation is deleted, not kept.
- **Identifiers**: rename only when the rename is contained. A public function, an exported symbol, or a database column rename is a separate change with its own tests — note it, do not smuggle it into a comment cleanup.
- **User-facing strings**: move them to the locale file under a key, then reference the key. Bisaya UI text is correct in the locale file and wrong in the component.
- **Commit messages already pushed**: leave history alone. Rewriting pushed history to fix a comment's language is a worse change than the comment.

**EVIDENCE: the diff, and for each identified rename either the test that passes or a `PLANNED` note.**

## Phase 3 — Prevent the next one

- A line in `CONTRIBUTING.md`: *"Source code, comments, commit messages and docs are written in English. User-facing copy lives in the locale files."*
- Optional CI step, on source paths only:

```bash
git grep -nP '[^\x00-\x7F]' -- '*.js' '*.ts' '*.php' '*.py' \
  ':(exclude)lang/**' ':(exclude)locales/**' && exit 1 || exit 0
```

- The check must exclude the locale directories, or it fails on the one place another language is required.

**EVIDENCE: the CONTRIBUTING line, and the CI step's exit code on a clean tree.**

## Anti-default table

| Default | The policy |
|---|---|
| The owner speaks Bisaya, so the comments are Bisaya | comments are English; the *reply* is Bisaya |
| One file with both languages | one language per file: English |
| Bisaya UI text inline in JSX | a locale key in the locale file |
| Commit message in Bisaya | English |
| Test name in Bisaya | English |
| Renaming everything to English in a comment-only change | comments first, renames as their own change |
| Translating the chat answer into English too | the chat stays in the owner's language |

## Definition of done

- The non-ASCII grep over source returns only locale files.
- No Bisaya/Tagalog token remains in a comment, docstring, test name or commit message.
- User-facing copy is in a locale file, referenced by key.
- Renames that would break an API are listed as `PLANNED`, not done silently.

## Failure modes

1. **Translating the conversation into English.** The owner asked in Bisaya; only the code changes language.
2. **Bisaya comments kept "because the owner understands them".** The next developer does not, and neither does `git log --grep`.
3. **A comment cleanup that also renames public functions.** The diff becomes unreviewable and the cleanup gets reverted.
4. **Bisaya UI copy hardcoded in a component.** The only place it belongs is the locale file.
5. **The CI check that includes locale files.** It fails on correct code, so it gets disabled — which is how the rule dies.
6. **Mixed scripts in one file.** A single non-ASCII character breaks some toolchains and every `grep` the team runs.

## A note on authority

There is no external standard being cited here: this is a **project convention**, and the owner sets it. The mechanism is what matters — one language per surface, enforced by a grep that excludes the locale directory.
