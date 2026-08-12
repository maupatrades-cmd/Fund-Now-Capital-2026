[CmdletBinding()]
param(
  [string]$Repository = "https://github.com/maupatrades-cmd/Fund-Now-Capital-2026.git",
  [string]$Target = "C:\Users\maupa\Documents\Codex\2026-08-05\co\current\Fund-Now-Capital-2026",
  [string]$ProjectRef = "",
  [string]$ReportDirectory = "C:\Users\maupa\Documents\Codex\2026-08-05\co\reports"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$WorkingDirectory = ""
  )
  if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE." }
  }
  finally {
    if ($WorkingDirectory) { Pop-Location }
  }
}

function Get-GitOutput {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )
  Push-Location -LiteralPath $WorkingDirectory
  try {
    $output = & git @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
    }
    return @($output)
  }
  finally { Pop-Location }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is not installed or is not on PATH."
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is not installed or is not on PATH."
}

Invoke-Checked -FilePath "gh" -Arguments @("auth", "status")

$targetParent = Split-Path -Parent $Target
New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $Target)) {
  Write-Host "Cloning current main into $Target ..." -ForegroundColor Cyan
  Invoke-Checked -FilePath "git" -Arguments @(
    "clone", "--branch", "main", "--single-branch", $Repository, $Target
  )
}
else {
  if (-not (Test-Path -LiteralPath (Join-Path $Target ".git"))) {
    throw "Target exists but is not a Git repository: $Target"
  }
  $dirty = @(Get-GitOutput -Arguments @("status", "--porcelain") -WorkingDirectory $Target)
  if ($dirty.Count -gt 0) {
    throw "The current-main audit checkout has local changes. Nothing was changed. Inspect: $Target"
  }
  $origin = (Get-GitOutput -Arguments @("remote", "get-url", "origin") -WorkingDirectory $Target | Select-Object -First 1).Trim()
  if ($origin -ne $Repository) {
    throw "Origin mismatch. Expected $Repository but found $origin."
  }
  Write-Host "Fast-forwarding the clean audit checkout ..." -ForegroundColor Cyan
  Invoke-Checked -FilePath "git" -Arguments @("fetch", "origin", "main", "--prune") -WorkingDirectory $Target
  Invoke-Checked -FilePath "git" -Arguments @("switch", "main") -WorkingDirectory $Target
  Invoke-Checked -FilePath "git" -Arguments @("merge", "--ff-only", "origin/main") -WorkingDirectory $Target
}

$head = (Get-GitOutput -Arguments @("rev-parse", "HEAD") -WorkingDirectory $Target | Select-Object -First 1).Trim()
$headSummary = (Get-GitOutput -Arguments @("log", "-1", "--format=%h %cI %s") -WorkingDirectory $Target | Select-Object -First 1).Trim()
$recentMerges = @(Get-GitOutput -Arguments @(
  "log", "-30", "--first-parent", "--format=%h|%cI|%s"
) -WorkingDirectory $Target)

$migrationDirectory = Join-Path $Target "supabase\migrations"
$localMigrations = @()
if (Test-Path -LiteralPath $migrationDirectory) {
  $localMigrations = @(
    Get-ChildItem -LiteralPath $migrationDirectory -File -Filter "*.sql" |
      Sort-Object Name |
      ForEach-Object {
        $version = ""
        $description = $_.BaseName
        if ($_.BaseName -match "^(?<version>[0-9]{14})_(?<description>.+)$") {
          $version = $Matches.version
          $description = $Matches.description
        }
        [pscustomobject]@{
          Version = $version
          Description = $description
          File = $_.Name
          Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
      }
  )
}

$duplicateVersions = @(
  $localMigrations |
    Where-Object { $_.Version } |
    Group-Object Version |
    Where-Object Count -gt 1
)

$securityFindings = [System.Collections.Generic.List[object]]::new()
foreach ($migration in $localMigrations) {
  $migrationPath = Join-Path $migrationDirectory $migration.File
  $sql = Get-Content -LiteralPath $migrationPath -Raw
  if ($sql -match "(?is)create\s+table\s+(if\s+not\s+exists\s+)?public\." -and
      $sql -notmatch "(?is)enable\s+row\s+level\s+security") {
    $securityFindings.Add([pscustomobject]@{
      Severity = "HIGH"
      Migration = $migration.File
      Finding = "Creates a public table without an RLS enable statement in the same migration."
    })
  }
  if ($sql -match "(?is)security\s+definer" -and
      $sql -notmatch "(?is)revoke\s+execute\s+on\s+function") {
    $securityFindings.Add([pscustomobject]@{
      Severity = "HIGH"
      Migration = $migration.File
      Finding = "Contains SECURITY DEFINER without an explicit EXECUTE revoke in the same migration."
    })
  }
  if ($sql -match "(?is)create\s+(or\s+replace\s+)?view\s+public\." -and
      $sql -notmatch "(?is)security_invoker") {
    $securityFindings.Add([pscustomobject]@{
      Severity = "MEDIUM"
      Migration = $migration.File
      Finding = "Creates a public view without a visible security_invoker declaration."
    })
  }
}

$supabaseStatus = "CLI_NOT_AVAILABLE"
$linkedMigrationOutput = @()
$linkedMigrationExitCode = $null
if (Get-Command supabase -ErrorAction SilentlyContinue) {
  $supabaseVersion = (& supabase --version 2>&1 | Select-Object -First 1)
  $supabaseStatus = "CLI_AVAILABLE: $supabaseVersion"
  Push-Location -LiteralPath $Target
  try {
    if ($ProjectRef) {
      & supabase link --project-ref $ProjectRef
      if ($LASTEXITCODE -ne 0) { throw "Supabase link failed. No migrations were applied." }
    }
    $linkedMigrationOutput = @(& supabase migration list --linked 2>&1)
    $linkedMigrationExitCode = $LASTEXITCODE
    if ($linkedMigrationExitCode -eq 0) {
      $supabaseStatus = "LINKED_MIGRATION_LIST_OK: $supabaseVersion"
    }
    else {
      $supabaseStatus = "LINKED_MIGRATION_LIST_FAILED: $supabaseVersion"
    }
  }
  finally { Pop-Location }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $ReportDirectory "FNC-MAIN-MIGRATION-AUDIT-$timestamp.md"
$jsonPath = Join-Path $ReportDirectory "FNC-MAIN-MIGRATION-AUDIT-$timestamp.json"

$report = [System.Collections.Generic.List[string]]::new()
$report.Add("# FNC Current Main and Migration Audit")
$report.Add("")
$report.Add("- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')")
$report.Add("- Repository: $Repository")
$report.Add("- Checkout: $Target")
$report.Add("- HEAD: $head")
$report.Add("- Latest: $headSummary")
$report.Add("- Local migration files: $($localMigrations.Count)")
$report.Add("- Duplicate migration versions: $($duplicateVersions.Count)")
$report.Add("- Static security findings: $($securityFindings.Count)")
$report.Add("- Supabase status: $supabaseStatus")
$report.Add("")
$report.Add("## Recent main history")
$report.Add("")
$report.Add("| Commit | Time | Subject |")
$report.Add("|---|---|---|")
foreach ($entry in $recentMerges) {
  $parts = $entry -split "\|", 3
  if ($parts.Count -eq 3) {
    $report.Add("| $($parts[0]) | $($parts[1]) | $($parts[2].Replace('|','/')) |")
  }
}
$report.Add("")
$report.Add("## Local migration inventory")
$report.Add("")
$report.Add("| Version | File | SHA-256 |")
$report.Add("|---|---|---|")
foreach ($migration in $localMigrations) {
  $report.Add("| $($migration.Version) | $($migration.File) | $($migration.Hash) |")
}
$report.Add("")
$report.Add("## Duplicate versions")
$report.Add("")
if ($duplicateVersions.Count -eq 0) {
  $report.Add("None.")
}
else {
  foreach ($duplicate in $duplicateVersions) {
    $report.Add("- $($duplicate.Name): $($duplicate.Group.File -join ', ')")
  }
}
$report.Add("")
$report.Add("## Static security findings")
$report.Add("")
if ($securityFindings.Count -eq 0) {
  $report.Add("No findings from this static guard. Runtime RLS/grant tests are still required.")
}
else {
  $report.Add("| Severity | Migration | Finding |")
  $report.Add("|---|---|---|")
  foreach ($finding in $securityFindings) {
    $report.Add("| $($finding.Severity) | $($finding.Migration) | $($finding.Finding) |")
  }
}
$report.Add("")
$report.Add("## Supabase linked migration output")
$report.Add("")
$report.Add("    ")
if ($linkedMigrationOutput.Count -gt 0) {
  foreach ($line in $linkedMigrationOutput) { $report.Add("    $line") }
}
else {
  $report.Add("    No linked output. Link the project or provide -ProjectRef, then rerun.")
}
$report.Add("")
$report.Add("## Safety result")
$report.Add("")
$report.Add("This script does not apply, repair, revert or delete migrations. Use the report to determine the reviewed merge/apply order before any remote database change.")

[IO.File]::WriteAllLines($reportPath, $report, [Text.UTF8Encoding]::new($false))

$json = [pscustomobject]@{
  generated_at = (Get-Date).ToString("o")
  repository = $Repository
  checkout = $Target
  head = $head
  head_summary = $headSummary
  local_migrations = $localMigrations
  duplicate_versions = @($duplicateVersions | ForEach-Object {
    [pscustomobject]@{ Version = $_.Name; Files = @($_.Group.File) }
  })
  security_findings = @($securityFindings)
  supabase_status = $supabaseStatus
  linked_migration_exit_code = $linkedMigrationExitCode
  linked_migration_output = @($linkedMigrationOutput)
}
$json | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding utf8

Write-Host ""
Write-Host "SUCCESS - current main synchronized and audited." -ForegroundColor Green
Write-Host "HEAD: $headSummary" -ForegroundColor Green
Write-Host "Markdown report: $reportPath" -ForegroundColor Cyan
Write-Host "JSON report: $jsonPath" -ForegroundColor Cyan
Write-Host "No migrations were applied." -ForegroundColor Yellow
