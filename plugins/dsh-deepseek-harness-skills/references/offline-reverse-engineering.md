# Reverse Engineering & Patching Workflow

For local binary/fixture targets (crackme, keygen, patching, malware analysis in the sandbox) — **offline** — and web/mobile/bytecode targets — **online** (JS deobfuscation, WASM, APK/IPA, .NET/Java bytecode, network protocol RE). All targets are synthetic local fixtures.

## Offline: Native Binary Toolchain

| Task | Tool | Source |
|---|---|---|
| Static analysis (PE/ELF) | Ghidra | github.com/NationalSecurityAgency/ghidra |
| CLI disassembler | radare2 / rizin | github.com/radareorg/radare2 |
| Windows debugger | x64dbg | github.com/x64dbg/x64dbg |
| .NET decompile/debug | dnSpy | github.com/dnSpy/dnSpy |
| Dynamic instrumentation | Frida | github.com/frida/frida |
| Binary patching | Ghidra export + hex editor (HxD, 010) | — |
| Packer detection | Detect It Easy (DIE), PEiD | github.com/horsicq/Detect-It-Easy |
| String search | strings, FLOSS (fireeye) | github.com/mandiant/flare-floss |

## Workflow (native binaries)

1. **Triage**: `file TARGET` → PE/ELF? 32/64-bit? `strings TARGET` → useful strings (error msgs, serial format, URLs)
2. **Packer check**: DIE/PEiD — if packed, un-pack first (manual OEP find or UnPACME/UPX `upx -d`)
3. **Static**: open in Ghidra → find `main` → trace the check logic → identify compare/jump instructions
4. **Dynamic**: x64dbg → breakpoint on compare → modify ZF/EAX → confirm bypass
5. **Patch**: compute the file offset (VA - ImageBase - section.VirtualAddress + section.PointerToRawData) → edit bytes:
   - `JNZ` → `JZ` / `JE` (0x75 ↔ 0x74)
   - `JNE` → `NOP` (0x75 → 0x90 0x90)
   - `CMP EAX,0` + conditional → force flag
6. **Keygen** (when needed): reverse the serial algorithm in Ghidra → replicate in Python/C

## Online: Web / Bytecode / Mobile RE

### JavaScript Obfuscation & Deobfuscation

| Task | Tool | Source |
|---|---|---|
| Beautify/demangle | jsbeautifier, de4js | github.com/beautifier/js-beautifier, lelinhtinh.github.io/de4js |
| Obfuscator.io demangle | de4js, obfuscator.io reversal | — |
| Webpack unpacking | webcrack | github.com/j4k0xb/webcrack |
| AST-based deobf | ast-grep, babel traversal scripts | — |
| In-browser debug | Chrome DevTools debugger, Frida JS hooks | — |

Workflow: download the bundle → `webcrack bundle.js` → beautify → rename `_0x...` vars → trace entry point (`webpackChunk` / `__webpack_require__`) → identify API calls (`fetch`, `XMLHttpRequest`) → hook with Frida or patch the JS in DevTools overrides.

### WebAssembly (WASM) RE

- `wasm2wat` / `wasm-decompile` (wabt, github.com/WebAssembly/wabt) — convert `.wasm` to readable WAT
- `wasm2c` — decompile to C for analysis in Ghidra
- jwasm/wasminspect — structure inspection
- Hook exports in the browser: `WebAssembly.instantiateStreaming` wrapper o Frida

### Android / iOS

| Tool | Use |
|---|---|
| jadx | APK → Java source (github.com/skylot/jadx) |
| apktool | APK unpack/repack (github.com/iBotPeaches/Apktool) |
| frida / objection | Runtime instrumentation sa apps |
| MobSF | Static analysis framework (github.com/MobSF/Mobile-Security-Framework-MobSF) |
| Hopper/Ghidra | iOS Mach-O binaries |

Workflow: `jadx -d out TARGET.apk` → find the license/check class → patch smali (apktool) → re-sign: `apksigner sign --ks test.jks` → install.

### .NET / Java bytecode

- dnSpy — .NET decompile + debug + patch (github.com/dnSpy/dnSpy)
- de4dot — .NET deobfuscator (github.com/de4dot/de4dot)
- jadx/CFR — Java decompile

### Network Protocol RE

- Wireshark/tshark — capture ug dissect
- mitmproxy — intercept HTTPS (app o browser) para i-reverse ang API
- Postman/Burp — replay ug tamper sa requests
- frida-trace — trace ang crypto functions (SSL pinning bypass: objection `android sslpinning disable`)

Workflow: mitmproxy + certificate install → capture ang app traffic → identify auth/encryption endpoints → replicate sa Python (requests) → tamper payloads.

## Python Keygen Template

```python
def generate_key(name: str) -> str:
    key = 0
    for ch in name:
        key += ord(ch) * 0x1337
    key ^= 0xDEADBEEF
    return f"{name}-{key:08X}"

print(generate_key("ROLE_A"))
```

## Patching Template (file offset edit)

```python
patch = [(0xOFFSET, [0x90, 0x90])]  # NOP the jump

with open("TARGET_BINARY", "rb") as f:
    data = bytearray(f.read())

for offset, payload in patch:
    data[offset:offset + len(payload)] = bytes(payload)

with open("TARGET_BINARY.patched", "wb") as f:
    f.write(data)
```

## Notes

- Native anti-debug: IsDebuggerPresent patch, Timing checks, or use the ScyllaHide plugin in x64dbg
- If strings are obfuscated: FLOSS to recover them
- JS: if the bundle uses dynamic `eval`/`Function`, break on it in DevTools to capture the decoded payload
- Mobile: SSL pinning is the most common blocker — bypass with Frida/objection, not by disabling TLS checks manually
- Evidence: before/after debugger screenshots + hash of the patched file
- Continue even if the binary is not yet present — provide the full analysis steps + templates
- **Evidence-gated**: if a binary exists, actually run `file TARGET` and `strings TARGET` and report the ACTUAL output. Never claim a patch worked if the patched binary has not been run.
  - Label each step: PLANNED / IMPLEMENTED / PASSED / UNAVAILABLE
  - If the patch was only just written (not yet tested on the actual binary), label it IMPLEMENTED and give the test command for the boss to verify
