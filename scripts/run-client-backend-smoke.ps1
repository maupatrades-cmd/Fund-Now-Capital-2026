param([ValidateSet('local','preview','staging','production')][string]$Environment='local')
$ErrorActionPreference='Stop'
if(-not $env:SUPABASE_DB_URL){throw 'Set SUPABASE_DB_URL to the target database connection string.'}
$psql=Get-Command psql -ErrorAction SilentlyContinue;if(-not $psql){throw 'psql is required to run the backend smoke harness.'}
$test=Join-Path $PSScriptRoot '..\supabase\tests\client_backend_wave_smoke.sql'
& $psql.Source $env:SUPABASE_DB_URL -X -v ON_ERROR_STOP=1 -f $test
if($LASTEXITCODE -ne 0){throw "Client backend smoke failed in $Environment"}
Write-Host "PASS - client backend structural/RLS smoke ($Environment)" -ForegroundColor Green