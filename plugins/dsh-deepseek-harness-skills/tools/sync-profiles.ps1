# Sync the installed copy of this plugin in every DSH profile with the source on disk.
#
#   powershell -NoProfile -File tools\sync-profiles.ps1
#   powershell -NoProfile -File tools\sync-profiles.ps1 -Profiles desktop
#
# Requires Windows PowerShell 5.1 or PowerShell 7+. No `??` or ternary syntax, so it runs on
# both. `pnpm` must be on PATH.
#
# Why this exists instead of a bare `pnpm install`: pnpm does not re-copy a changed
# `file:` directory dependency, so the installed copy silently keeps the old index.js and the
# old prompts. Removing the installed package directory plus the two pnpm state files forces a
# real re-copy. See tools\SYNC-PROFILES.md for the full note and the recorded evidence.
#
# It never edits package.json, cordis.patch.yml or a bundle list - the plugin already ships
# inside the package those register.

[CmdletBinding()]
param(
  [string[]]$Profiles = @('desktop', 'web'),
  [string]$Source = 'C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills',
  [string]$DshHome = 'C:\Users\admin\.dsh',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$packageName = 'dsh-deepseek-harness-skills'
# Files the harness actually loads. tools\ is shipped but never imported by the host, so a
# tools-only edit does not need a profile sync; everything here does.
$tracked = [System.Collections.Generic.List[string]]::new()
$tracked.Add('index.js')
$tracked.Add('package.json')
Get-ChildItem -File (Join-Path $Source 'prompts') | ForEach-Object {
  $tracked.Add("prompts\$($_.Name)")
}

function Get-RelativeHash {
  param([string]$Root, [string]$Relative)
  $path = Join-Path $Root $Relative
  if (-not (Test-Path $path)) { return $null }
  return (Get-FileHash -Algorithm SHA256 $path).Hash
}

$failures = @()

foreach ($profile in $Profiles) {
  $profileDir = Join-Path $DshHome "profiles\$profile"
  $installed = Join-Path $profileDir "node_modules\$packageName"

  Write-Output ""
  Write-Output "=== profile: $profile ==="
  if (-not (Test-Path $profileDir)) {
    Write-Output "  SKIP - no such profile directory: $profileDir"
    continue
  }

  if (Test-Path $installed) {
    Remove-Item -Recurse -Force $installed
    Write-Output "  removed installed package: $installed"
  }
  else {
    Write-Output "  installed package absent (fresh install): $installed"
  }

  foreach ($stateFile in '.modules.yaml', '.pnpm-workspace-state-v1.json') {
    $statePath = Join-Path $profileDir "node_modules\$stateFile"
    if (Test-Path $statePath) {
      Remove-Item -Force $statePath
      Write-Output "  removed pnpm state: $stateFile"
    }
  }

  if (-not $SkipInstall) {
    Push-Location $profileDir
    try {
      $output = & pnpm install --config.confirmModulesPurge=false 2>&1
      $code = $LASTEXITCODE
      foreach ($line in $output) { Write-Output "  pnpm: $line" }
      if ($code -ne 0) {
        Write-Output "  FAIL - pnpm install exited $code"
        $failures += "$profile`: pnpm install exit $code"
        continue
      }
    }
    finally {
      Pop-Location
    }
  }

  if (-not (Test-Path $installed)) {
    Write-Output "  FAIL - installed package still missing after install"
    $failures += "$profile`: installed package missing"
    continue
  }

  foreach ($relative in $tracked) {
    $sourceHash = Get-RelativeHash -Root $Source -Relative $relative
    $installedHash = Get-RelativeHash -Root $installed -Relative $relative
    if ($null -eq $sourceHash) {
      Write-Output ("  MISSING IN SOURCE  {0}" -f $relative)
      $failures += "$profile`: source file missing: $relative"
      continue
    }
    if ($sourceHash -eq $installedHash) {
      Write-Output ("  OK   {0,-28} {1}" -f $relative, $sourceHash.Substring(0, 12))
    }
    else {
      $installedShown = 'MISSING'
      if ($installedHash) { $installedShown = $installedHash.Substring(0, 12) }
      Write-Output ("  DIFF {0,-28} source={1} installed={2}" -f `
          $relative, $sourceHash.Substring(0, 12), $installedShown)
      $failures += "$profile`: hash mismatch: $relative"
    }
  }
}

Write-Output ""
if ($failures.Count -eq 0) {
  Write-Output "SYNC OK - every profile carries the current plugin"
  exit 0
}
Write-Output "SYNC FAILED - $($failures.Count) problem(s):"
foreach ($failure in $failures) { Write-Output "  - $failure" }
exit 1
