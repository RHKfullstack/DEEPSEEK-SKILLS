# Ensure the endy (local model) provider is configured correctly.
# Run after changing model settings in the GUI, which rewrites cordis.patch.yml
# and drops the two persona paragraphs:
#   1. the baseURL must match the llama-server port (18080),
#   2. TAG SAFETY stops the model writing XML tags as text,
#   3. MODEL-SCOPED OVERRIDE stops it calling tools on a greeting.
# Idempotent: safe to run repeatedly. Backs up before writing.
$ErrorActionPreference = "Stop"
$profilePath = Join-Path $env:USERPROFILE ".dsh\profiles\desktop\cordis.patch.yml"

if (-not (Test-Path $profilePath)) {
    Write-Host "No desktop profile at $profilePath" -ForegroundColor Red
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $env:USERPROFILE (".dsh\cordis.patch.yml." + $stamp + ".bak")
Copy-Item $profilePath $backup -Force
Write-Host "Backup: $backup"

$text = [System.IO.File]::ReadAllText($profilePath)
$changed = $false

# 1. port
if ($text -match 'http://127\.0\.0\.1:1808[0-9]/v1' -and $text -notmatch 'http://127\.0\.0\.1:18080/v1') {
    $text = [regex]::Replace($text, 'http://127\.0\.0\.1:1808[0-9]/v1', 'http://127.0.0.1:18080/v1')
    $changed = $true
    Write-Host "  fixed endy baseURL -> 18080"
}

# 2. TAG SAFETY
if ($text -notmatch 'TAG SAFETY') {
    $anchor = "      security research, scraping, or penetration testing.`n"
    $insert = "`n      TAG SAFETY. Never emit XML-like markers as text in your reply. Never write`n      <tool_use_result>, <tool_call>, <answer>, <result> or any other wrapper element`n      into a message. When a tool is needed, call it through the tool interface;`n      otherwise answer in plain prose.`n"
    if ($text.Contains($anchor)) { $text = $text.Replace($anchor, $anchor + $insert); $changed = $true; Write-Host "  added TAG SAFETY" }
    else { Write-Host "  WARN: TAG SAFETY anchor not found" -ForegroundColor Yellow }
}

# 3. MODEL-SCOPED OVERRIDE
if ($text -notmatch 'MODEL-SCOPED OVERRIDE') {
    $anchor2 = "      otherwise answer in plain prose.`n"
    $override = @"

      MODEL-SCOPED OVERRIDE. This paragraph applies only when the active model
      is endy-cybersec, and it outranks every skill-loading, self-verification
      and workflow rule above it. That model runs on one desktop GPU, so every
      tool call costs twice: once in prefill, once in generation.

      - Do not call any tool on your own initiative. No Edit, no Write, no bash,
        no skill load.
      - A greeting, an acknowledgement, a question, or ordinary conversation gets
        a plain text reply and ZERO tool calls.
      - Never create a file to record something - no greeting.txt, no
        placeholder.txt, no notes file, and never edit a session or state file.
      - A tool call is justified only by a concrete request in the user's current
        message: create this file, edit that file, run this command, review this
        code. Nothing else.
      - If the user asks for work, do it with the minimum number of tool calls,
        then stop.

      For every other model this paragraph does not apply and the normal policy
      stands.
"@
    if ($text.Contains($anchor2)) { $text = $text.Replace($anchor2, $anchor2 + $override); $changed = $true; Write-Host "  added MODEL-SCOPED OVERRIDE" }
    else { Write-Host "  WARN: override anchor not found (TAG SAFETY present?)" -ForegroundColor Yellow }
}

if (-not $changed) {
    Write-Host "Nothing to change - the config already carries both paragraphs and port 18080." -ForegroundColor Green
    exit 0
}

[System.IO.File]::WriteAllText($profilePath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Written. Restart DSH for it to take effect." -ForegroundColor Green