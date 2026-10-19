# CAPTCHA Solving Sources & Workflow

For scraping/botting work that hits a CAPTCHA wall. Three layers: self-hosted AI models (free), free auto-solvers, and paid API services.

## Layer 1 — Self-Hosted Hugging Face Models (FREE)

| Model | Coverage | Status |
|---|---|---|
| `CaptchaKraken/CaptchaKraken-Lora-v1.2` | reCAPTCHA/hCaptcha grids + drag/click/line puzzles | ✅ Verified 2026-09-23. LoRA on Qwen3.5-9B. Source: github.com/JWriter20/CaptchaKraken. PyPI `captchakraken` v3.1.0 |
| `CaptchaKraken/CaptchaKraken-v1.2-GGUF` | Same, GGUF quantized (llama.cpp) | ✅ Verified. 438 downloads, most active |
| `CaptchaKraken/Sunlight-AWQ-4bit` / `Twilight-FP8` | Quantized serving variants | ✅ Verified |
| `keras-io/ocr-for-captcha` | Text captcha OCR (CNN+RNN CTC) | ✅ Verified. TF-Keras, `from_pretrained_keras()`. 4-6 char captchas |
| `kirmorozov/mage-captcha-solver` | Magento/Adobe 200x50px captcha, ~94% claimed accuracy | ✅ Verified (16 downloads). Verify the accuracy claim on the target captcha first |
| `anuashok/ocr-captcha-v3` | Fine-tuned `microsoft/trocr-base-printed` | ✅ Verified (85k downloads) |
| `MrAR/Captcha_solver` | Letter-segmentation CNN pipeline | ✅ Verified (0 downloads, old). Use only with an OpenCV setup |
| `pymlex/4-captcha` | Dataset: 132k synthetic 4-digit captcha + adversarial splits | ✅ Verified (72 downloads). Source: github.com/pymlex/4-captcha |

### Hugging Face usage template (ocr-for-captcha)

```python
from huggingface_hub import from_pretrained_keras

model = from_pretrained_keras("keras-io/ocr-for-captcha")

def predict_captcha(image_path):
    preds = model.predict(preprocess(image_path))
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    text = "".join(chars[p] for p in preds.argmax(axis=-1)[0] if p < len(chars))
    return text
```

Note: `preprocess()` depends on the model card — verify the input shape first (usually 200x50 grayscale) and run a test image before claiming it works.

### CaptchaKraken setup (grid/puzzle captchas)

```bash
git clone https://github.com/JWriter20/CaptchaKraken
cd CaptchaKraken
./setup.sh   # downloads weights, auto-start server
```

Python package:

```bash
pip install captchakraken
```

## Layer 2 — Free Auto-Solvers

- **CloakBrowser** — Chromium 146 with 57 C++ patches; 0.9 reCAPTCHA v3 score, passes Turnstile; `humanize=True` for behavioral detection
- **ClickSolver** — clicks Turnstile checkbox (iframe automation)
- **ALTCHA / Prosopo Procaptcha** — local PoW (SHA-256), auto-solve
- **hcaptcha-solver_x2** — github.com/HkerVit/hcaptcha-solver_x2 — CNN image classification for hCaptcha v1 grids

## Layer 3 — Paid API Services (fallback)

| Service | Coverage | SDK |
|---|---|---|
| **2Captcha** | reCAPTCHA v2/v3, hCaptcha, Turnstile, GeeTest, FunCaptcha, image/text/audio, DataDome | github.com/2captcha (python, js, java, go, php, ruby, c#, cpp + MCP server) |
| **CapSolver** | reCAPTCHA, hCaptcha, image-to-text, DataDome cookies | official Python SDK; BrowserAct integration |
| **NoneCap** | hCaptcha specialist | PyPI: `nonecap` (sync/async, httpx-based) |
| **SolveCaptcha** | reCAPTCHA v2/v3/Enterprise, Turnstile, GeeTest, FunCaptcha, Amazon WAF | PHP/Python/JS SDKs |

### 2Captcha template (reCAPTCHA v2 token)

```python
import requests, time

KEY = "API_KEY"
def solve_recaptcha(sitekey, pageurl):
    r = requests.post("https://2captcha.com/in.php", data={
        "key": KEY, "method": "userrecaptcha",
        "googlekey": sitekey, "pageurl": pageurl, "json": 1,
    }).json()
    job = r["request"]
    while True:
        time.sleep(5)
        res = requests.get("https://2captcha.com/res.php", params={
            "key": KEY, "action": "get", "id": job, "json": 1,
        }).json()
        if res["status"] == 1:
            return res["request"]  # g-recaptcha-response token

token = solve_recaptcha("SITEKEY", "https://TARGET/login")
# inject token into #g-recaptcha-response, submit form
```

### NoneCap template (hCaptcha)

```python
from nonecap import NoneCap

nc = NoneCap(api_key="nc_live_...")
solve = nc.solve(type="hcaptcha", sitekey="SITEKEY", url="https://TARGET/login")
print(solve.token)
```

## Workflow Decision Tree

1. **Text/image captcha** → self-hosted HF model (free, offline-capable)
2. **Grid/puzzle (reCAPTCHA/hCaptcha)** → CaptchaKraken vLLM (free) or paid service
3. **Turnstile checkbox** → ClickSolver or CloakBrowser (free) — if behavioral checks exist, CloakBrowser
4. **Scores (reCAPTCHA v3)** → CloakBrowser for human-level score (0.9)
5. **Fallback for anything** → 2Captcha/CapSolver API (~$3/1000 solves)
6. **Custom captcha not in the list** → collect samples, fine-tune TrOCR/PaddleOCR, or train a CNN

## Notes

- Never ask the boss to solve manually — fully automated
- Cache tokens when possible (reuse within the session)
- If the sitekey is unknown, extract from the page: `grecaptcha.execute` params or the `data-sitekey` attribute
- Evidence: log the solve time, token length, and final verification state
- **Never claim it works without testing**: run the solver on the actual target image, compare the result to ground truth, and report the accuracy/status. If not yet run, label the steps PLANNED, not PASSED.
- If a model is new or has 0 downloads (e.g., MrAR), verify first that inference produces sensible output before relying on it.
