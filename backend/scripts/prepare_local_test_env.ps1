param(
  [string]$StockEnv = 'W:\RK Stocks and linesheets\.env',
  [string]$OutputEnv = "$PSScriptRoot\..\.env.local"
)

if (!(Test-Path -LiteralPath $StockEnv)) { throw 'RK-STOCK .env was not found.' }
$stock = Get-Content -LiteralPath $StockEnv
$mongoLine = $stock | Where-Object { $_ -match '^\s*MONGO_URI\s*=' } | Select-Object -First 1
$dbLine = $stock | Where-Object { $_ -match '^\s*MONGO_DB\s*=' } | Select-Object -First 1
if (!$mongoLine -or !$dbLine) { throw 'RK-STOCK Mongo settings are incomplete.' }
$mongoValue = ($mongoLine -split '=', 2)[1].Trim()
$stockDb = ($dbLine -split '=', 2)[1].Trim()
if (!$mongoValue -or $stockDb -match '(?i)RKFUPL|RKSTOCKDB') { throw 'Refusing an unsafe Mongo deployment target.' }
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$secret = [Convert]::ToBase64String($bytes)
$jwtBytes = New-Object byte[] 48
$jwtRng = [Security.Cryptography.RandomNumberGenerator]::Create()
$jwtRng.GetBytes($jwtBytes)
$jwtRng.Dispose()
$jwtSecret = [Convert]::ToBase64String($jwtBytes)
$content = @(
  "MONGO_DB=$mongoValue"
  'DB_NAME=RK_WEB_TEST_DB'
  'FLASK_ENV=development'
  "SECRET_KEY=$secret"
  "JWT_SECRET_KEY=$jwtSecret"
  'JWT_COOKIE_SECURE=false'
  'SHARED_SESSION_COOKIE_NAME=rk_shared_session'
  'SHARED_SESSION_COOKIE_DOMAIN='
  'SHARED_SESSION_COOKIE_SECURE=false'
  'SHARED_SESSION_COOKIE_SAMESITE=Lax'
  'AUTH_SESSION_DAYS=30'
  "SHARED_SESSION_INTERNAL_SECRET=$secret"
  'MAIL_PROVIDER=zoho'
)
Set-Content -LiteralPath $OutputEnv -Value $content -Encoding utf8
Write-Output 'Created backend/.env.local for RK_WEB_TEST_DB. Secret and URI were not printed.'
