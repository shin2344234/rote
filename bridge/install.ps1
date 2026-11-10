# Registers the bridge to Claude Code and Codex with Chrome for the current Windows user.
# The extension shows the full command, with its own ID, under Profile and logs.
# Run it once, then click Check again there. Pass -Uninstall to remove the registration.
# The bridge runs in the Windows PowerShell that comes with Windows and needs nothing else.
param(
  [string]$ExtensionId,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
if (-not $Uninstall -and $ExtensionId -notmatch '^[a-p]{32}$') {
  throw 'Pass -ExtensionId with the 32 letter ID of your copy of the extension. Profile and logs shows the full command.'
}
$hostName = 'com.resume_autofill.claude'
$registryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$launcher = Join-Path $PSScriptRoot 'host.bat'
$manifest = Join-Path $PSScriptRoot 'host-manifest.json'
$hostScript = Join-Path $PSScriptRoot 'host.ps1'

if ($Uninstall) {
  if (Test-Path $registryKey) { Remove-Item $registryKey }
  Remove-Item $launcher, $manifest -ErrorAction SilentlyContinue
  Write-Output 'Bridge removed.'
  return
}

if (-not (Test-Path $hostScript)) { throw "host.ps1 is missing from $PSScriptRoot. Download rote-bridge again." }
# A file unzipped from a download carries a mark that can make PowerShell ask before running it.
Unblock-File $hostScript -ErrorAction SilentlyContinue
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
Set-Content -Path $launcher -Encoding ascii -Value @(
  '@echo off'
  "`"$powershell`" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"%~dp0host.ps1`""
)

$json = [ordered]@{
  name            = $hostName
  description     = 'Lets Rote ask the local Claude Code or Codex install to answer form questions.'
  path            = $launcher
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
# Chrome rejects a manifest that starts with a byte order mark, and this call writes none in any PowerShell version.
[IO.File]::WriteAllText($manifest, $json)

New-Item -Path $registryKey -Force | Out-Null
Set-Item -Path $registryKey -Value $manifest
Write-Output "Bridge installed for extension $ExtensionId. In Rote, open Profile and logs and click Check again."
