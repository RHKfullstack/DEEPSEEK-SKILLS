# Restore this repository's skills and plugins into %USERPROFILE%\.dsh.
# Use after a DSH update when verify-setup.ps1 reports MISSING or CHANGED.
# Run from anywhere; it resolves paths from its own location.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dsh = Join-Path $env:USERPROFILE ".dsh"

if (-not (Test-Path (Join-Path $root "skills"))) {
    Write-Host "Run this from the repository checkout - skills\ not found next to scripts\." -ForegroundColor Red
    exit 1
}

Write-Host "Restoring skills and plugins into $dsh" -ForegroundColor Cyan
New-Item -ItemType Directory -Force (Join-Path $dsh "skills") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dsh "plugins") | Out-Null

Copy-Item (Join-Path $root "skills\*") (Join-Path $dsh "skills") -Recurse -Force
Copy-Item (Join-Path $root "plugins\*") (Join-Path $dsh "plugins") -Recurse -Force

# The profiles resolve their plugins through node_modules; refresh those copies.
foreach ($profile in @("desktop", "web")) {
    $modules = Join-Path $dsh ("profiles\" + $profile + "\node_modules")
    if (-not (Test-Path $modules)) { continue }
    foreach ($plugin in @("dsh-deepseek-harness-skills", "dsh-senior-engineering-skills")) {
        $src = Join-Path $dsh ("plugins\" + $plugin)
        $dst = Join-Path $modules $plugin
        if (Test-Path $src) {
            Copy-Item $src $dst -Recurse -Force
            Write-Host ("  synced " + $profile + "\node_modules\" + $plugin)
        }
    }
}

Write-Host "`nDone. Restart the DSH app, then run scripts\verify-setup.ps1." -ForegroundColor Green