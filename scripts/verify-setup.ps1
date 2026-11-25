# Verify that the skill setup in %USERPROFILE%\.dsh still matches the manifest.
# Run after any DSH update. Exit code 0 = intact, 1 = something changed.
$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $PSScriptRoot "setup-manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$dsh = Join-Path $env:USERPROFILE ".dsh"
$fail = 0

Write-Host "DSH skill setup check" -ForegroundColor Cyan

# Hash the text, not the bytes on disk. The manifest states "this is the content this setup
# owns"; a CRLF checkout and an LF checkout of the same file are the same content, and hashing
# raw bytes reports drift that does not exist. Normalising the line endings keeps the check
# meaningful whichever way the file reached the machine.
function Get-NormalizedHash {
    param([string]$Path)
    $text = ([System.IO.File]::ReadAllText($Path)) -replace "`r`n", "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("X2") }) -join "")
    } finally {
        $sha.Dispose()
    }
}

foreach ($entry in $manifest.files) {
    $live = $entry.path -replace '^~', $env:USERPROFILE
    if (-not (Test-Path $live)) {
        Write-Host ("  MISSING  " + $entry.path) -ForegroundColor Red
        $fail++
        continue
    }
    $hash = Get-NormalizedHash $live
    if ($hash -ne $entry.sha256) {
        Write-Host ("  CHANGED  " + $entry.path) -ForegroundColor Yellow
        $fail++
    } else {
        Write-Host ("  OK       " + $entry.path)
    }
}

$skillsDir = Join-Path $dsh "skills"
$count = 0
if (Test-Path $skillsDir) { $count = (Get-ChildItem $skillsDir -Directory).Count }
if ($count -ne $manifest.skillsCount) {
    Write-Host ("  SKILLS   expected {0}, found {1}" -f $manifest.skillsCount, $count) -ForegroundColor Yellow
    $fail++
} else {
    Write-Host ("  OK       skills count " + $count)
}

$cfg = Join-Path $dsh "profiles\desktop\cordis.patch.yml"
if (Test-Path $cfg) {
    $mode = (Select-String -Path $cfg -Pattern '^\s*mode:\s*(\S+)' | Select-Object -First 1).Matches.Groups[1].Value
    $policy = (Select-String -Path $cfg -Pattern '^\s*policy:\s*(\S+)' | Select-Object -First 1).Matches.Groups[1].Value
    Write-Host ("  INFO     sandbox mode=" + $mode + " policy=" + $policy)
}

if ($fail -eq 0) {
    Write-Host "`nINTACT - nothing to do." -ForegroundColor Green
    exit 0
}
Write-Host ("`n" + $fail + " difference(s). Restore with: scripts\restore-setup.ps1, then restart DSH.") -ForegroundColor Yellow
exit 1