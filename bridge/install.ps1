# Registers the bridge to Claude Code and Codex with Chrome for the current Windows user.
# The extension shows the full command, with its own ID, under Profile and logs.
# Run it once, then click Check again there. Pass -Uninstall to remove the registration.
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

if ($Uninstall) {
  if (Test-Path $registryKey) { Remove-Item $registryKey }
  Remove-Item $launcher, $manifest -ErrorAction SilentlyContinue
  Write-Output 'Bridge removed.'
  return
}

$node = (Get-Command node -ErrorAction Stop).Source
Set-Content -Path $launcher -Encoding ascii -Value @(
  '@echo off'
  "`"$node`" `"%~dp0host.mjs`""
)

[ordered]@{
  name            = $hostName
  description     = 'Lets Rote ask the local Claude Code or Codex install to answer form questions.'
  path            = $launcher
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json | Set-Content -Path $manifest -Encoding utf8NoBOM

New-Item -Path $registryKey -Force | Out-Null
Set-Item -Path $registryKey -Value $manifest
Write-Output "Bridge installed for extension $ExtensionId. Reload the extension, then use Test connection."
