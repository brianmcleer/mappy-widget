<#
  install.ps1 - installs or updates gis-mcp under IIS (same pattern as the Droplets relay).

  RUN on the internal web server, in PowerShell as administrator, from this folder:
      powershell -ExecutionPolicy Bypass -File .\install.ps1

  What it does:
    1. Copies gis_mcp.py, web.config and requirements.txt to $Target (keeps an existing config.json;
       creates one from config.example.json the first time).
    2. Creates $Target\.venv from $Python and installs Flask and Waitress into it.
    3. Creates the IIS app pool (No Managed Code, AlwaysRunning) and the application $AppPath
       under $Site, pointing at $Target.
    4. Grants the app pool identity read on the folder and modify on logs.
    5. Recycles the pool and checks /health.

  Needs the HttpPlatformHandler IIS module (already installed for the Droplets relay).
  Safe to run again after editing gis_mcp.py: it updates the files and recycles the pool.
#>
param(
    [string]$Target  = "D:\GIS\Services\gis-mcp",
    [string]$Site    = "Default Web Site",
    [string]$AppPath = "/gis-mcp",
    [string]$Pool    = "gis-mcp",
    [string]$Python  = "C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe",
    [string]$HostName = "gis.example.org"
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this in PowerShell as administrator."
}

Write-Host "==> Files to $Target"
New-Item -ItemType Directory -Force -Path $Target, "$Target\logs" | Out-Null
Copy-Item "$here\gis_mcp.py", "$here\requirements.txt" -Destination $Target -Force
if (-not (Test-Path "$Target\web.config")) {
    (Get-Content "$here\web.config" -Raw).Replace("D:\GIS\Services\gis-mcp", $Target).Replace('value="/gis-mcp"', "value=""$AppPath""") | Set-Content "$Target\web.config" -Encoding UTF8
} else {
    Write-Host "    Kept the existing web.config."
}
if (-not (Test-Path "$Target\config.json")) {
    Copy-Item "$here\config.example.json" "$Target\config.json"
    Write-Host "    Created config.json from the example. Edit it (service_folders, layers, allowed_origins) before testing."
} else {
    Write-Host "    Kept the existing config.json."
}

Write-Host "==> Python environment"
if (-not (Test-Path "$Target\.venv\Scripts\python.exe")) {
    if (-not (Test-Path $Python)) { throw "Python not found at $Python. Pass -Python with a Python 3.9+ path." }
    & $Python -m venv "$Target\.venv"
    if ($LASTEXITCODE -ne 0) { throw "Could not create the venv." }
}
& "$Target\.venv\Scripts\python.exe" -m pip install --quiet --upgrade -r "$Target\requirements.txt"
if ($LASTEXITCODE -ne 0) { throw "pip install failed." }

Write-Host "==> IIS"
Import-Module WebAdministration
if (-not (Get-Module -ListAvailable -Name WebAdministration)) { throw "IIS WebAdministration module not found." }
$httpPlatform = Get-WebGlobalModule | Where-Object { $_.Name -eq "httpPlatformHandler" }
if (-not $httpPlatform) { throw "The HttpPlatformHandler IIS module is not installed." }
if (-not (Test-Path "IIS:\AppPools\$Pool")) {
    New-WebAppPool -Name $Pool | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$Pool" -Name managedRuntimeVersion -Value ""
Set-ItemProperty "IIS:\AppPools\$Pool" -Name startMode -Value "AlwaysRunning"
Set-ItemProperty "IIS:\AppPools\$Pool" -Name processModel.idleTimeout -Value "00:00:00"
$appName = $AppPath.TrimStart("/")
if (-not (Get-WebApplication -Site $Site -Name $appName)) {
    New-WebApplication -Site $Site -Name $appName -PhysicalPath $Target -ApplicationPool $Pool | Out-Null
} else {
    Set-ItemProperty "IIS:\Sites\$Site\$appName" -Name applicationPool -Value $Pool
}

Write-Host "==> Permissions"
icacls $Target /grant "IIS AppPool\${Pool}:(OI)(CI)RX" | Out-Null
icacls "$Target\logs" /grant "IIS AppPool\${Pool}:(OI)(CI)M" | Out-Null

Write-Host "==> Restart and check"
Restart-WebAppPool -Name $Pool
Start-Sleep -Seconds 4
$url = "https://$HostName$AppPath/health"
try {
    $health = Invoke-RestMethod -Uri $url -TimeoutSec 30
    Write-Host ("    {0}: ok, version {1}, {2} layers" -f $url, $health.version, $health.layers)
    foreach ($n in $health.notes) { Write-Warning $n }
} catch {
    Write-Warning "Health check failed at ${url}: $($_.Exception.Message). See $Target\logs."
}
Write-Host "`nMCP address for Mappy: https://$HostName$AppPath/mcp"
