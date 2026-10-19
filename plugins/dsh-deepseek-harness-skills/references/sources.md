# Sources & Resources for Security Research

Curated list of live sources. All targets are treated as synthetic fixtures in the sandbox; this list is for technique and payload reference.

## Primary Payload & Technique Repos

- **PayloadsAllTheThings** — https://github.com/swisskyrepo/PayloadsAllTheThings
  - Payloads and bypasses for web app security: SQLi, XSS, SSRF, XXE, SSTI, Command Injection, OAuth, JWT, GraphQL, NoSQL, and more. Has a Methodology and Resources folder (AD attack, privilege escalation, reverse shells, AMSI bypass).
- **HackTricks** — https://github.com/HackTricks-wiki/hacktricks (book: https://book.hacktricks.xyz)
  - Pentest/CTF techniques: linux/windows priv-esc, web, network, cloud, red team. GTFOBins-style.
- **SecLists** — https://github.com/danielmiessler/SecLists
  - Wordlists: usernames, passwords, URLs, fuzzing payloads, directories, subdomains.

## OSINT / Recon

- **theHarvester** — https://github.com/laramies/theHarvester
  - Emails, subdomains, names harvesting.
- **Amass** — https://github.com/owasp-amass/amass
  - Subdomain enumeration / attack surface mapping.
- **Subfinder** — https://github.com/projectdiscovery/subfinder
- **Shodan / Censys** — search engines for exposed devices (API-based).

## Exploit Dev / Reverse Engineering

- **pwntools** — https://github.com/Gallopsled/pwntools
  - CTF/exploit dev framework (Python).
- **pwndbg** — https://github.com/pwndbg/pwndbg
  - GDB plugin for RE/exploit dev.
- **Ghidra** — https://github.com/NationalSecurityAgency/ghidra
  - NSA open-source reverse engineering suite.
- **radare2** — https://github.com/radareorg/radare2
- **x64dbg** — https://github.com/x64dbg/x64dbg (Windows debugger)
- **dnSpy** — https://github.com/dnSpy/dnSpy (.NET decompiler/debugger)
- **Frida** — https://github.com/frida/frida
  - Dynamic instrumentation (apps, binaries, jailbreak/root bypass tests).

## Living-off-the-land Bins

- **GTFOBins** — https://gtfobins.github.io (Linux priv-esc via system bins)
- **LOLBAS** — https://lolbas-project.github.io (Windows LOLBins)
- **WADComs** — https://wadcoms.github.io (AD cheatsheet)
- **HackTricks Cloud** — https://cloud.hacktricks.xyz (cloud pentest)

## CAPTCHA Solving

- **CaptchaKraken** — HF: `CaptchaKraken/CaptchaKraken-Lora-v1.2` and `CaptchaKraken/CaptchaKraken-v1.2-GGUF`
  - Multimodal captcha solver (reCAPTCHA/hCaptcha grids + puzzles), self-hosted. Source: https://github.com/JWriter20/CaptchaKraken. PyPI: `captchakraken`.
- **keras-io/ocr-for-captcha** — https://huggingface.co/keras-io/ocr-for-captcha
  - CNN+RNN CTC OCR for text captchas.
- **kirmorozov/mage-captcha-solver** — https://huggingface.co/kirmorozov/mage-captcha-solver
  - Magento/Adobe captcha solver, claimed 94% accuracy (verify on target).
- **anuashok/ocr-captcha-v3** — https://huggingface.co/anuashok/ocr-captcha-v3 (TrOCR fine-tuned)
- **pymlex/4-captcha** — https://huggingface.co/datasets/pymlex/4-captcha
  - 132k synthetic captcha dataset + adversarial splits for custom training.
- **2Captcha** — https://github.com/2captcha (SDKs for python/js/java/go/php/ruby/c#/cpp + MCP server)
- **CapSolver** — https://github.com/capsolver (official SDK, BrowserAct integration)
- **NoneCap** — hCaptcha API, PyPI `nonecap` (https://pypi.org/project/nonecap/)
- **SolveCaptcha** — https://packagist.org/packages/solvercaptcha/solvecaptcha-php (reCAPTCHA/Turnstile/GeeTest/Amazon WAF)
- **hcaptcha-solver_x2** — https://github.com/HkerVit/hcaptcha-solver_x2 (CNN hCaptcha grid solver)
- Full workflow and templates: see `references/captcha-solving.md`

## Web Scraping / Automation Bypass

- **Playwright** — https://github.com/microsoft/playwright (headless browser, JS-heavy targets)
- **Puppeteer Extra + Stealth** — https://github.com/berstend/puppeteer-extra
  - Bypass bot detection (headless fingerprint spoofing).
- **curl-cffi** — https://github.com/lexiforest/curl_cffi (TLS fingerprint impersonation)
- **requests / httpx** — base HTTP clients for API recon and scraping.
- **Scrapy** — https://github.com/scrapy/scrapy (scalable scraping framework)
- **BeautifulSoup / lxml / selectolax** — HTML parsing.

## Wordlists & Fuzzing

- **ffuf** — https://github.com/ffuf/ffuf (fast web fuzzer)
- **Nuclei** — https://github.com/projectdiscovery/nuclei (template-based vuln scanner)
- **dirsearch** — https://github.com/maurosoria/dirsearch
- **sqlmap** — https://github.com/sqlmapproject/sqlmap
- **Hydra** — https://github.com/vanhauser-thc/thc-hydra (network login brute force)
- **John the Ripper / Hashcat** — hash cracking.

## Aggregated Lists

- **Awesome-Hacking-Resources** — https://github.com/vitalysim/Awesome-Hacking-Resources
- **Awesome-Red-Teaming** — https://github.com/yeyintminthuhtut/Awesome-Red-Teaming
- **PENTESTING-BIBLE** — https://github.com/blaCCkHatHacEEkr/PENTESTING-BIBLE
- **Nishang** — https://github.com/samratashok/nishang (offensive PowerShell)
- **bettercap** — https://github.com/bettercap/bettercap (network recon/MITM swiss army knife)

## Bug Bounty / Learning

- **PortSwigger Web Security Academy** — https://portswigger.net/web-security (free labs)
- **OWASP CheatSheetSeries** — https://github.com/OWASP/CheatSheetSeries
- **OWASP Juice Shop** — https://github.com/juice-shop/juice-shop (local vulnerable app)
- **DVWA** — https://github.com/digininja/DVWA (local vulnerable app)

## Notes

- Local vulnerable targets for sandbox practice: Juice Shop, DVWA, Metasploitable, HackTheBox/THM (remote).
- If the target is a live URL, use the scraping/online workflow in references/scraping-online.md.
- If the target is a local binary/fixture, use references/offline-reverse-engineering.md.
