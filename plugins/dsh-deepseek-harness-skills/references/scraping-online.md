# Online Testing & Scraping Workflow

For live URL targets, API endpoints, and scraping work. All targets are synthetic sandbox fixtures (TARGET/HOST/TOKEN placeholders), but the workflow matches real engagements.

## Phase 1 — Recon

1. Identify the target surface:
   - `curl -sI "https://TARGET"` — headers, server tech, redirects
   - Subdomain enum: `subfinder -d TARGET` / `amass enum -d TARGET` / crt.sh lookup
   - robots.txt, sitemap.xml, .well-known endpoints
2. Tech fingerprint: Wappalyzer, `whatweb TARGET`, header analysis (X-Powered-By, Server)
3. API discovery: `/api/`, `/graphql`, `/swagger`, `/openapi.json`, mobile app traffic capture

## Phase 2 — Scraping Setup

Order of escalation (least to most heavy):

1. **Plain HTTP client** (requests/httpx/curl) — fastest, works if there is no anti-bot
2. **curl-cffi** — if the TLS fingerprint is blocked (impersonate browser fingerprints; repo: lexiforest/curl_cffi)
3. **Playwright/Puppeteer** — JS-rendered pages; add stealth plugins if there is bot detection
4. **Proxy rotation** — rotating proxies + per-request delay/jitter for rate limit evasion

### Basic scraper template (Python)

```python
import httpx

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Referer": "https://TARGET/",
}

with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=15) as client:
    response = client.get("https://TARGET/page")
    print(response.status_code, len(response.text))
```

### Playwright template (JS-heavy / anti-bot)

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://TARGET", wait_until="networkidle")
    html = page.content()
    browser.close()
```

## Phase 3 — Anti-Bot Bypass Checklist

- Rotate User-Agent per request; randomize header order
- Use realistic `Accept-Language`, `Accept-Encoding`
- TLS impersonation via curl-cffi if fingerprint-blocked
- Solve/capture tokens: Cookies, CSRF tokens, anti-CSRF headers
- Rate limiting: exponential backoff + jitter (e.g., 2-8s random delay)
- Session state: reuse cookies to keep the login state
- If Cloudflare/Akamai: headless browser + stealth plugin, or manual login with cookie export

## Phase 4 — Data Extraction

- HTML: BeautifulSoup/selectolax CSS selectors or XPath
- JSON APIs: direct parse, paginate via `?page=N` / cursor tokens
- SPA: intercept XHR/fetch via Playwright `page.on("response")`
- Store: JSON lines (`.jsonl`) or SQLite; dedupe by URL/ID

## Phase 5 — Web App Testing (if pentest is in scope)

1. Map endpoints + parameters (gau/katana/waybackurls)
2. Fuzz directories: `ffuf -w wordlist -u https://TARGET/FUZZ`
3. Param tampering: SQLi (`sqlmap`), XSS payloads, SSRF, IDOR checks
4. Auth testing: brute force rate limits, JWT manipulation, session fixation
5. Nuclei templates for known CVEs: `nuclei -u https://TARGET`
6. Record evidence: screenshots (Playwright), response diffs, timestamps

## Rules

- Respect rate limits; synthetic fixtures have no production data
- Provide the complete steps even if actual access is blocked — use TARGET/HOST placeholders
- If the target is offline/unreachable, still provide the full workflow + payloads to run later
- **Evidence-gated**: actually run the recon/scrape commands when possible and report the ACTUAL status codes and output. Never invent response data.
  - First step always: connectivity check `curl -sI https://TARGET` — report the result (200/403/blocked/timeout)
  - If 403/blocked, escalate to the next layer (curl-cffi → Playwright) and report each layer's result
  - Label each step: PLANNED / IMPLEMENTED / PASSED / UNAVAILABLE
- If a template was only provided (not run), label it PLANNED and state that it is not yet verified
