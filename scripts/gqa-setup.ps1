<#
.SYNOPSIS
  Installs or updates GQA on Windows with Docker Desktop.

.DESCRIPTION
  Run through gqa-setup.bat (double-click). Safe to run again at any time:
  - checks Git and Docker Desktop, offering to install them with winget;
  - updates the code with a fast-forward git pull (skipped if you changed files);
  - creates .env with random secrets on first install, and on later runs only
    fills in settings that are missing. Existing values are never replaced,
    because the database passwords are tied to your existing data;
  - rebuilds and starts the containers, waits until GQA answers, then opens it.

  Works with Windows PowerShell 5.1 and PowerShell 7.
#>
[CmdletBinding()]
param(
  [string]$RepoDir = (Split-Path -Parent $PSScriptRoot),
  [switch]$NoUpdate,
  [switch]$NoBrowser
)

Set-StrictMode -Version 2.0
# 'Continue': in Windows PowerShell 5.1, 'Stop' turns any stderr output from git
# or docker into a terminating error. Exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
$WebUrl = 'http://localhost:3000'
$ApiHealthUrl = 'http://localhost:8080/healthz'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    $Text" -ForegroundColor Yellow }
function Stop-Setup([string]$Text) {
  Write-Host ''
  Write-Host "GQA setup stopped: $Text" -ForegroundColor Red
  exit 1
}
function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function Confirm-Choice([string]$Question) {
  $answer = Read-Host "    $Question [y/N]"
  return $answer -match '^(y|yes)$'
}
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

# Cryptographically random hex string (Windows PowerShell 5.1 compatible).
function New-Secret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Install-WithWinget([string]$Id, [string]$Name) {
  if (-not (Test-Command 'winget')) {
    Stop-Setup "$Name is not installed and winget is unavailable. Install $Name manually, then run this again."
  }
  if (-not (Confirm-Choice "$Name is not installed. Install it now with winget?")) {
    Stop-Setup "$Name is required."
  }
  & winget install --exact --id $Id --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { Stop-Setup "winget could not install $Name (exit code $LASTEXITCODE)." }
  Update-SessionPath
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim() }
  }
  return $values
}

# Sets KEY=value only where KEY is absent or empty. Never replaces a value.
function Set-MissingDotEnvValues([string]$Path, [hashtable]$Wanted) {
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($line in [IO.File]::ReadAllLines($Path)) { $lines.Add($line) }
  $added = @()
  foreach ($key in $Wanted.Keys) {
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match "^\s*$([regex]::Escape($key))\s*=(.*)$") { $index = $i; break }
    }
    if ($index -ge 0) {
      if ($Matches[1].Trim() -ne '') { continue }
      $lines[$index] = "$key=$($Wanted[$key])"
    } else {
      $lines.Add("$key=$($Wanted[$key])")
    }
    $added += $key
  }
  if ($added.Count -gt 0) {
    # UTF-8 without a byte-order mark, LF line endings: what Docker Compose expects.
    [IO.File]::WriteAllText($Path, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  }
  # Callers wrap the call in @(...), which handles zero, one or many keys.
  return $added
}

function Wait-ForUrl([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return $false
}

Write-Host 'GQA installer and updater' -ForegroundColor White
Write-Host "Folder: $RepoDir"

# --- 1. Prerequisites ------------------------------------------------------
Write-Step 'Checking Git and Docker'
if (-not (Test-Command 'git')) { Install-WithWinget 'Git.Git' 'Git' }
Write-Ok ((& git --version) -join ' ')

if (-not (Test-Command 'docker')) {
  Install-WithWinget 'Docker.DockerDesktop' 'Docker Desktop'
  Write-Note 'Docker Desktop was installed. Start it once (you may need to sign out or restart Windows),'
  Write-Note 'wait until it says "Engine running", then run gqa-setup.bat again.'
  exit 0
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $desktop) {
    Write-Note 'Docker is not running. Starting Docker Desktop (this can take a minute)...'
    Start-Process -FilePath $desktop | Out-Null
    $deadline = (Get-Date).AddSeconds(180)
    do {
      Start-Sleep -Seconds 5
      & docker info *> $null
    } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)
  }
  if ($LASTEXITCODE -ne 0) { Stop-Setup 'Docker is not running. Start Docker Desktop, wait for "Engine running", then run this again.' }
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Docker Compose v2 is required. Update Docker Desktop.' }
Write-Ok 'Docker is running.'

# --- 2. Code update ----------------------------------------------------------
Set-Location -LiteralPath $RepoDir -ErrorAction Stop
if (-not (Test-Path (Join-Path $RepoDir 'compose.yaml'))) { Stop-Setup "compose.yaml not found in $RepoDir." }

if ($NoUpdate) {
  Write-Step 'Skipping code update (-NoUpdate)'
} elseif (Test-Path (Join-Path $RepoDir '.git')) {
  Write-Step 'Updating GQA code'
  $changes = & git status --porcelain --untracked-files=no
  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if ($changes) {
    Write-Note 'You have local changes to GQA files, so the update was skipped to protect them:'
    $changes | ForEach-Object { Write-Note "  $_" }
  } else {
    $before = (& git rev-parse --short HEAD).Trim()
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      Write-Note "git pull failed on branch '$branch'. Continuing with the current version."
    } else {
      $after = (& git rev-parse --short HEAD).Trim()
      if ($before -eq $after) { Write-Ok "Already up to date ($after on $branch)." }
      else { Write-Ok "Updated $before -> $after on $branch." }
    }
  }
} else {
  Write-Note 'This folder is not a Git clone, so the code cannot be updated automatically.'
}

# Older checkouts on Windows converted files to CRLF line endings, which breaks
# scripts that run inside the Linux containers. .gitattributes now asks for LF;
# re-check out the tracked files once so the existing copy follows it.
$probe = Join-Path $RepoDir 'db-migrate\migrate.sh'
if ((Test-Path (Join-Path $RepoDir '.git')) -and (Test-Path $probe) -and
    ([IO.File]::ReadAllText($probe)).Contains("`r")) {
  if (& git status --porcelain --untracked-files=no) {
    Write-Note 'Some files have Windows line endings, but you have local changes, so they were left as they are.'
  } else {
    Write-Step 'Fixing Windows line endings in GQA files'
    & git rm -r --cached --quiet .
    & git reset --hard --quiet HEAD
    if ($LASTEXITCODE -eq 0) { Write-Ok 'Files re-checked out with Linux line endings (your .env was not touched).' }
    else { Write-Note 'Could not re-check out files; continuing (the migration step tolerates CRLF).' }
  }
}

# --- 3. Configuration (.env) -------------------------------------------------
Write-Step 'Checking configuration (.env)'
$envFile = Join-Path $RepoDir '.env'
$newAdminPassword = $null
$existingDatabase = [bool](& docker volume ls -q --filter 'label=com.docker.compose.volume=gqa_pgdata')

if (-not (Test-Path $envFile)) {
  if ($existingDatabase) {
    Write-Note 'A GQA database volume already exists, but .env is missing.'
    Write-Note 'New database passwords would not match it. Restore your previous .env, or remove the'
    Write-Note 'old volume only if you intend to delete all GQA data (docker volume ls / docker volume rm).'
    Stop-Setup '.env is missing for an existing database.'
  }
  Copy-Item -LiteralPath (Join-Path $RepoDir '.env.example') -Destination $envFile -ErrorAction Stop
  $newAdminPassword = New-Secret 18
  $added = @(Set-MissingDotEnvValues $envFile @{
    'GQA_ADMIN_PASSWORD'    = $newAdminPassword
    'GQA_RUNNER_TOKEN'      = New-Secret 32
    'GQA_DB_APP_PASSWORD'   = New-Secret 32
    'GQA_DB_ADMIN_PASSWORD' = New-Secret 32
    'GQA_SECRETS_KEY'       = New-Secret 32
  })
  Write-Ok "Created .env with new random secrets ($($added -join ', '))."
} else {
  $current = Read-DotEnv $envFile
  if (-not $current.ContainsKey('GQA_DB_ADMIN_PASSWORD') -or $current['GQA_DB_ADMIN_PASSWORD'] -eq '') {
    if ($existingDatabase) {
      Stop-Setup 'GQA_DB_ADMIN_PASSWORD is empty in .env. Set it to the original database password used when GQA was first installed.'
    }
  }
  $wanted = @{
    'GQA_RUNNER_TOKEN'      = New-Secret 32
    'GQA_DB_APP_PASSWORD'   = New-Secret 32
    'GQA_DB_ADMIN_PASSWORD' = New-Secret 32
    'GQA_SECRETS_KEY'       = New-Secret 32
  }
  if (-not $current.ContainsKey('GQA_ADMIN_PASSWORD') -or $current['GQA_ADMIN_PASSWORD'] -eq '') {
    $newAdminPassword = New-Secret 18
    $wanted['GQA_ADMIN_PASSWORD'] = $newAdminPassword
  }
  $added = @(Set-MissingDotEnvValues $envFile $wanted)
  if ($added.Count -gt 0) { Write-Ok "Added missing settings to .env: $($added -join ', '). Existing values were kept." }
  else { Write-Ok '.env is complete. Existing values were kept.' }
}

# --- 4. Build and start ------------------------------------------------------
Write-Step 'Building and starting GQA (the first build can take several minutes)'
& docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
  Write-Note 'Recent container logs:'
  & docker compose logs --no-color --tail 40
  Stop-Setup 'docker compose up failed. See the messages above.'
}

Write-Step 'Waiting for GQA to answer'
$apiUp = Wait-ForUrl $ApiHealthUrl 240
$webUp = $apiUp -and (Wait-ForUrl $WebUrl 120)
if (-not $webUp) {
  & docker compose ps
  Stop-Setup "GQA did not answer at $WebUrl in time. Check 'docker compose logs api web'."
}
Write-Ok "GQA is running at $WebUrl"

# --- 5. Next steps -------------------------------------------------------------
Write-Host ''
Write-Host '------------------------------------------------------------' -ForegroundColor White
Write-Host ' Sign in:  admin@gqa.local' -ForegroundColor White
if ($newAdminPassword -and -not $existingDatabase) {
  Write-Host " Password: $newAdminPassword" -ForegroundColor White
  Write-Host ' (also saved as GQA_ADMIN_PASSWORD in .env; change it later in Account security)'
} else {
  Write-Host ' Password: your current administrator password. On a new database it is the'
  Write-Host ' GQA_ADMIN_PASSWORD value in .env.'
}
Write-Host ''
Write-Host ' To enable AI code review: open "AI settings" (top right), choose'
Write-Host ' DeepSeek, OpenAI, Gemini or Claude, paste the API key, allow sending'
Write-Host ' project context, then Save and Test connection.'
Write-Host ''
Write-Host ' Run gqa-setup.bat again at any time to update GQA.'
Write-Host '------------------------------------------------------------' -ForegroundColor White

if (-not $NoBrowser) { Start-Process $WebUrl }
exit 0
