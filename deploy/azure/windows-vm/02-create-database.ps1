# -----------------------------------------------------------------------------
# Signacare EMR - Database setup
# 02-create-database.ps1
#
# Run AFTER 01-setup-prerequisites.ps1 has installed PostgreSQL.
# Creates the signacaredb database, signacare_owner role, app_user role,
# and required extensions (pgcrypto, pg_trgm).
#
# Mirrors apps/api/.env.example canonical names:
#   DB_NAME=signacaredb
#   DB_USER=signacare_owner   (DDL owner; runs migrations)
#   DB_APP_USER=app_user      (runtime; minimum-privilege)
#
# Generates per-role passwords and writes them to a temp file. Operator
# MUST move them to Key Vault and delete the local file.
# -----------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter()] [string]$DbName    = 'signacaredb',
    [Parameter()] [string]$OwnerRole = 'signacare_owner',
    [Parameter()] [string]$AppRole   = 'app_user',
    [Parameter(Mandatory=$true)] [string]$PostgresSuperuserPassword,
    [Parameter()] [string]$OwnerRolePassword,
    [Parameter()] [string]$AppRolePassword
)

$ErrorActionPreference = 'Stop'

function New-StrongPassword {
    -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
}

function Invoke-Psql($sql, $database = 'postgres') {
    $env:PGPASSWORD = $PostgresSuperuserPassword
    $psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
    if (-not (Test-Path $psql)) {
        throw "psql.exe not found at $psql - is PostgreSQL 17 installed?"
    }
    $stdout = 'C:\Setup\psql-stdout.log'
    $stderr = 'C:\Setup\psql-stderr.log'
    $sqlFile = 'C:\Setup\psql-command.sql'
    Set-Content -Path $sqlFile -Value $sql -Encoding UTF8
    $proc = Start-Process -FilePath $psql `
        -ArgumentList @('-h', 'localhost', '-U', 'postgres', '-d', $database, '-v', 'ON_ERROR_STOP=1', '-f', $sqlFile) `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr
    if (Test-Path $stdout) {
        Get-Content $stdout | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path $stderr) {
        Get-Content $stderr | ForEach-Object { Write-Host $_ }
    }
    if ($proc.ExitCode -ne 0) {
        throw "psql command failed: $sql"
    }
}

$ownerPassword = if ([string]::IsNullOrWhiteSpace($OwnerRolePassword)) { New-StrongPassword } else { $OwnerRolePassword }
$appPassword   = if ([string]::IsNullOrWhiteSpace($AppRolePassword)) { New-StrongPassword } else { $AppRolePassword }

Write-Host "[STEP] Creating database $DbName, roles $OwnerRole + $AppRole..." -ForegroundColor Cyan

# Idempotent role creation - DROP ... IF EXISTS doesn't apply for ROLE; use DO blocks
Invoke-Psql @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$OwnerRole') THEN
    CREATE ROLE $OwnerRole LOGIN PASSWORD '$ownerPassword' CREATEDB;
  ELSE
    ALTER ROLE $OwnerRole WITH PASSWORD '$ownerPassword' CREATEDB;
  END IF;
END `$`$;

DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$AppRole') THEN
    CREATE ROLE $AppRole LOGIN PASSWORD '$appPassword';
  ELSE
    ALTER ROLE $AppRole WITH PASSWORD '$appPassword';
  END IF;
END `$`$;
"@

# Create the DB if it doesn't exist (CREATE DATABASE can't run inside a DO block)
$dbExists = & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h localhost -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
if ($dbExists -ne '1') {
    Invoke-Psql "CREATE DATABASE $DbName OWNER $OwnerRole;"
    Write-Host "  Database $DbName created"
} else {
    Write-Host "  Database $DbName already exists - skipping"
}

# Connect to the new DB and install extensions + grant minimum privileges to app_user
Invoke-Psql @"
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

GRANT CONNECT ON DATABASE $DbName TO $AppRole;
GRANT USAGE ON SCHEMA public TO $AppRole;
ALTER DEFAULT PRIVILEGES FOR ROLE $OwnerRole IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $AppRole;
ALTER DEFAULT PRIVILEGES FOR ROLE $OwnerRole IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $AppRole;
"@ $DbName

# Write passwords to temp file for operator to move to Key Vault
$pwFile = "D:\Signacare\postgres-data\generated-passwords.txt"
$pwContent = @"
# Signacare EMR - generated DB role passwords ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
#
# *** IMPORTANT ***
# 1. Move both passwords below to Azure Key Vault as secrets:
#      - signacare-db-password         <- $OwnerRole password
#      - signacare-db-app-password     <- $AppRole password
# 2. DELETE THIS FILE immediately after Key Vault upload.
# 3. Update D:\Signacare\app\apps\api\.env with the new values (or use env vars).

DB_NAME=$DbName
DB_USER=$OwnerRole
DB_PASSWORD=$ownerPassword
DB_APP_USER=$AppRole
DB_APP_PASSWORD=$appPassword

# psql connection strings (for ad-hoc queries):
#   psql -h localhost -U $OwnerRole -d $DbName  (owner)
#   psql -h localhost -U $AppRole   -d $DbName  (runtime)
"@
Set-Content -Path $pwFile -Value $pwContent

Write-Host "`n[COMPLETE] Database setup done." -ForegroundColor Green
Write-Host "  Generated passwords written to: $pwFile" -ForegroundColor Yellow
Write-Host "  *** Move passwords to Azure Key Vault and DELETE the local file ***" -ForegroundColor Yellow
