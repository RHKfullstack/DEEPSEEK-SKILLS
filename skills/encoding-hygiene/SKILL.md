---
name: encoding-hygiene
description: Write, detect and repair text without corrupting it - UTF-8 with no BOM on every write path, byte-level detection instead of reading a console, targeted repair instead of a whole-file round-trip, and a gate that fails the build on mojibake. Use whenever writing files from a shell or script, when a document shows characters like a-circumflex-euro or a-dash, when a skill or config silently fails to parse, before committing non-ASCII text, and when a validator reports a BOM or an encoding warning. Mojibake is silent corruption - the file loads and every quote and dash is wrong.
---

# Encoding Hygiene

<!-- deliberate-mojibake-examples -->

This file knowingly contains corrupted characters, because it has to show them. See "the exemption" in
Phase 4: the marker line above is what tells the gate to skip exactly this file, and nothing else.

**Mojibake is silent corruption, not a cosmetic bug.** The file opens, the tests pass, the feature works —
and every em dash, quotation mark, arrow and accented letter in it is wrong. Nothing throws. The corrupted
text then goes into a commit, gets read by a model, and becomes part of the next author's source of truth.
In this pack it survived **36 days** across 11 skill bodies and one always-on prompt file before anyone
noticed, because the only check anyone ran was a console print — and the console lied.

This skill is that failure turned into procedure: write correctly, detect by bytes, repair surgically, and
make a gate fail when it comes back.

## Phase 0 — The three ways text rots

| # | What happened | What you see | What it breaks |
|---|---|---|---|
| 1 | UTF-8 bytes were decoded as cp1252/ANSI, then saved as UTF-8 | `â€”` for an em dash, `â€™` for an apostrophe, `Ã©` for é, `â€¦` for an ellipsis | every renderer shows the wrong characters; the reader loses the punctuation the author chose |
| 2 | Text was written as UTF-16 where UTF-8 was expected | first bytes `FF FE` (LE) or `FE FF` (BE), or a `00` byte after every ASCII character | shells, git, YAML and most parsers reject it or read garbage |
| 3 | A BOM was written at byte 0 of a UTF-8 file | first bytes `EF BB BF` | a leading `---` is no longer line 1, so YAML frontmatter is invisible and a skill or config silently does not register |

Case 1 is the one that spreads, because it is a **round trip through a tool that guessed the encoding** —
a shell reading a file as ANSI, a copy through a console, an old script, a merge from a Windows machine.
Case 3 is the one that fails quietly: nothing errors, the entry simply is not there.

**EVIDENCE: the first 8 bytes of every file you wrote, printed as hex.**

## Phase 1 — Write with no BOM, always

| Surface | Correct write | The trap |
|---|---|---|
| PowerShell 5.1 | `[System.IO.File]::WriteAllText($p, $text, [System.Text.UTF8Encoding]::new($false))` | `Out-File -Encoding utf8` writes UTF-8 **with** BOM; `>` and `Out-File` default to **UTF-16LE**; `Set-Content` on a **new** file falls back to the ANSI code page |
| PowerShell 7 | `Set-Content -Encoding utf8NoBOM` | `-Encoding utf8` means no BOM here — the opposite of 5.1 |
| Node | `fs.writeFileSync(p, text, "utf8")` | `"binary"` / `latin1` on a path that is not ASCII |
| Python | `open(p, "w", encoding="utf-8", newline="\n")` | `open(p, "w")` uses the **locale** encoding — cp1252 on a Windows default before Python 3.15, where PEP 686 makes UTF-8 the default |
| PHP | `file_put_contents($p, $s)`, `mb_*` for lengths | `utf8_encode()` is not a fix; it assumes latin1 |
| MySQL | `utf8mb4` on the column, table **and** connection | `utf8` in MySQL is a 3-byte subset: no emoji, no 4-byte character |
| HTTP / HTML | `Content-Type: text/html; charset=utf-8`, `<meta charset="utf-8">` | a header without a charset lets the browser guess |
| git | `.gitattributes`: `* text=auto eol=lf` | `core.autocrlf` mixed with `eol=lf` produces files that differ only by CRLF, and every hash comparison reports drift |

Two rules hold across every surface:

- **Read as UTF-8 too.** A tool that writes UTF-8 but reads ANSI is worse than one that does neither: it
  corrupts on the next edit rather than the first.
- **Never test an encoding claim through a console.** See Phase 2.

**EVIDENCE: the write call, and the file's first bytes.**

## Phase 2 — Detect by bytes; the console is not evidence

This is the rule that would have caught this pack's corruption a month earlier.

**A console can print correct text as mojibake.** Windows PowerShell 5.1's `Get-Content` decodes UTF-8 as
the ANSI code page, so a **perfectly correct** em dash (`E2 80 94`) prints as `â€”` — which is exactly what
a corrupted file contains. In this pack that misread hid the real corruption for weeks: the same `â€”` on
screen meant "correct" in one file and "corrupted" in another, and no one could tell which was which.

So detection is a byte operation:

| Pattern (hex) | Means |
|---|---|
| `c3a2` | the character `â` — the signature of cp1252-decoded UTF-8 |
| `c383` | the character `Ã` — the other half of the same signature |
| `e282ac` | a stray `€`, almost always part of a mis-decoded dash |
| `efbfbd` | U+FFFD, the replacement character: something was already lost |
| `efbbbf` | a UTF-8 BOM at the start |
| `fffe` / `feff` | a UTF-16 BOM: the file is not UTF-8 at all |
| `00` between ASCII bytes | UTF-16 written where UTF-8 was expected |

Implementation rules, learned by getting them wrong:

- **Convert the file to one hex string and search it at even offsets only.** A substring match that starts
  on an odd index spans two bytes and is a false positive — a `c3a2` "hit" that is really the tail of one
  character and the head of the next.
- **Report the count and the line**, so the repair has a target and the rescan has something to compare.
- **Check the whole tree, not the file you suspect**: corruption arrives in bulk, and the one file you
  opened is rarely the only one.
- **An ASCII-only diff hides it.** Compare normalised text, and fold to ASCII before comparing bodies:
  two copies of the same document differing only in corrupted punctuation look identical to `git diff
  --stat`.

**EVIDENCE: the scan command, its per-file counts, and the first hit's line.**

## Phase 3 — Repair surgically; the whole-file round trip destroys good text

There are two repair methods. One is safe and one silently damages the file you are fixing.

| Method | When | What it does |
|---|---|---|
| **Targeted replacement** of the exact sequence | always, when you know each broken character's intended value | `â€”` → `—`; touches only what you named |
| **Whole-file cp1252 round-trip** (encode the text as cp1252, then decode those bytes as UTF-8) | **never** on a file that may mix correct and corrupted characters | repairs the mojibake **and** destroys every character that was already correct |

Why the round trip is a trap: a correct `—` is `E2 80 94`. Encoding that character to cp1252 gives the
single byte `0x97`; decoding `0x97` as UTF-8 is invalid and yields U+FFFD — a **compliant-looking** `?`
or `�` that no longer says anything. In this pack that is exactly what happened: a round trip fixed five
corrupted em dashes and turned five correct ones into U+FFFD in the same pass, and the damage was only
visible because the file was recounted afterwards.

The repair procedure:

1. **Snapshot before touching anything.** The bytes you are about to rewrite are the only record of what
   was there.
2. **Replace one known sequence at a time**, then rescan. Ten small replacements beat one clever one.
3. **Re-count the target character** after the repair: if the file had 10 em dashes before and has 5 now,
   the repair ate the rest.
4. **Re-run the project's own gate**, and any test that asserts a literal string — a mojibake file is how
   a "the section reaches the prompt" test fails for a reason that has nothing to do with the section.
5. **Report the before/after counts**, not "fixed".

**EVIDENCE: a before count, an after count, and a rescan that reports zero.**

## Phase 4 — Make it a gate, or it comes back

A repair without a gate is a delay. The check belongs in the same validator that already runs on push,
and it must **fail**, not warn:

- no `c3a2` / `c383` / `efbfbd` in any tracked text file;
- no `EF BB BF` at byte 0 and no `FF FE` / `FE FF`;
- the file parses as UTF-8 strictly — a decode error is a finding, not something to normalise away;
- YAML frontmatter starts at line 1 (which the BOM check protects);
- the same scan also covers the files that ship **outside** the tree you think of as source: prompt files,
  adapter output, manifests, and workflow YAML, because those are the ones nobody reads.

**EVIDENCE: the gate command, and a deliberately corrupted file that makes it fail.**

### The exemption, and why it is a marker and not a path

A file that exists to document the corruption has to contain it — this one does, on purpose. A gate that
cannot express that will either fail forever on the one file that explains it, or get switched off.

So the exemption is **a line inside the file**:

```html
<!-- deliberate-mojibake-examples -->
```

and the gate skips the file that carries it. Three rules make that safe:

- **The marker is visible in the file**, in a diff, in review. A path-based exclusion (`!docs/**`) is
  invisible, and it silently covers every future corruption under that path.
- **The marker exempts one file, never a directory.**
- **The exemption is counted and reported** by name, so nobody can add markers until the check means
  nothing.

**EVIDENCE: the gate output lists the exempt files by name.**

## The incident record this skill was written from

Kept because a rule with a scar behind it is followed, and a rule without one is not:

- **36 days.** 11 senior skill bodies carried `â€”` from the commit that first added them until 2026-11-25.
  Every rendered body showed it; every diff that touched those files preserved it.
- **The always-on file.** The pack's skill policy opened with `[SKILLS POLICY â€” …]` — a corrupted line that
  was injected into the model's system prompt on **every single turn**, for weeks, and no test caught it.
  Its only symptom was that one render test failed with "section not found", which reads like a wiring bug.
- **The console lied.** Windows PowerShell 5.1 printed correct em dashes and corrupted ones identically, so
  three separate inspections concluded "the file is fine".
- **The round trip bit back.** The first repair attempt fixed five sequences and destroyed five correct
  characters, which the character count exposed immediately and a "looks right" check would not have.
- **The fix that held**: targeted replacement, byte scan with even offsets, character counts before and
  after, rescan clean, both validators green.

## Anti-default table

| Default | The gate |
|---|---|
| Reading a file in the console to judge its encoding | print the first bytes as hex, or scan the whole file |
| `Out-File` / `>` from PowerShell 5.1 | `[System.IO.File]::WriteAllText` with a no-BOM encoder |
| `open(p, "w")` in Python | `encoding="utf-8"` explicitly, always |
| "It looks fine on screen" | a correct em dash and a corrupted one look identical in an ANSI console |
| Whole-file cp1252 round-trip to fix mojibake | targeted replacement, then recount the characters |
| Fixing the file you opened | scan the tree; corruption arrives in bulk |
| Fixing mojibake and stopping there | add the byte check to the validator, or it returns |
| Comparing bodies with `git diff --stat` | fold to ASCII, or normalise, before concluding "no change" |
| Treating a BOM as harmless | it hides YAML frontmatter and an entry registers as missing |
| Repairing the text but not the commit | the corruption is already in history; note it, and say which commits |

## Definition of done

- Every file written by the run has no BOM (`EF BB BF` absent) and is strict UTF-8.
- The byte scan over the changed tree reports zero `c3a2`, `c383`, `efbfbd` and zero BOMs.
- Any repair was targeted, with a before and after count for the character being repaired.
- The project's gate runs it on every push — as its own step or inside the validator — never as a one-off shell command someone remembers.
- The report states what was corrupted, for how long, and which commits the corruption reached.

## Failure modes

1. **The invisible corruption** — a file that never throws and is wrong in every quote it contains.
2. **The ANSI console** — the check that cannot see the difference, used as the only check.
3. **The destructive repair** — a round trip that fixes the broken characters and destroys the correct ones.
4. **The BOM** — the file is UTF-8 and correct, and the parser still cannot see the first line.
5. **The UTF-16 accident** — `>` from PowerShell 5.1 produces a file the next tool reads as garbage.
6. **The ASCII-only diff** — two copies compared after folding, so the corruption is declared "no change".
7. **The repaired copy, not the source** — the installed copy is fixed and the repository still ships the
   corruption, or the reverse.
8. **The one-off fix** — every file corrected by hand, no gate, and the next commit reintroduces it.

## Overlap — what this skill does not own

- `code-language-policy` owns **which language** the text is in, not whether its bytes are valid.
- `senior-frontend-engineering` owns i18n behaviour in a browser; this skill owns the encoding of the files
  that get shipped to it.
- `organizer` owns where the file lives; a BOM is not a placement problem.
- The repository's own validator owns its checks — this skill adds the byte-level ones to it rather than
  creating a second validator.

## Sources — verified live 2026-11-25

- [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) — the label-to-encoding mapping that decides what a decoder guesses, which is the root of case 1.
- [Unicode — UTF-8, a transformation format of ISO 10646 (RFC 3629)](https://www.rfc-editor.org/rfc/rfc3629) — the byte structure `E2 80 94` / `E2 86 92` that makes the mojibake signatures in Phase 2 decodable, and why a lone `0x97` is not a character.
- [Microsoft — about_Character_Encoding](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding) — the documented difference between PowerShell 5.1 and 7 `-Encoding utf8`, and why `Out-File` defaults bite.
- [Python — `open()` and the `encoding` argument](https://docs.python.org/3/library/functions.html#open) — the locale default that produces cp1252 output on Windows.
- [gitattributes](https://git-scm.com/docs/gitattributes) — `text=auto` and `eol`, and how a CRLF/LF mix makes every hash comparison report drift that does not exist.
