# Downloads the latest Rote release and unpacks it, ready for Chrome's Load unpacked.
# Chrome does not let a script add an extension, so the last three clicks are yours.
# Run it again to update. Works in Windows PowerShell 5.1 and PowerShell 7.
param(
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Rote'),
  # Also unpacks the optional bridge for Claude Code and Codex.
  [switch]$WithBridge,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$headers = @{ 'User-Agent' = 'rote-install' }
$release = Invoke-RestMethod 'https://api.github.com/repos/shin2344234/rote/releases/latest' -Headers $headers

function Expand-Asset([string]$Pattern, [string]$Target) {
  $asset = $release.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
  if (-not $asset) { throw "Release $($release.tag_name) has no file matching $Pattern." }
  $zip = Join-Path ([IO.Path]::GetTempPath()) $asset.name
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers $headers -UseBasicParsing
  # GitHub records a SHA-256 for each release file. A mismatch means the download is not what was published.
  if ($asset.digest -match '^sha256:(.+)$') {
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
    if ($actual -ne $Matches[1]) {
      Remove-Item $zip
      throw "The download of $($asset.name) does not match the published checksum."
    }
  }
  New-Item -ItemType Directory -Force $Target | Out-Null
  Expand-Archive $zip -DestinationPath $Target -Force
  Remove-Item $zip
}

$extension = Join-Path $Destination 'extension'
Expand-Asset '^rote-\d[\d.]*\.zip$' $extension
if ($WithBridge) { Expand-Asset '^rote-bridge-\d[\d.]*\.zip$' $Destination }

Write-Output "Rote $($release.tag_name) is unpacked in $extension"
Write-Output ''
Write-Output 'To finish in Chrome:'
Write-Output '  1. Open chrome://extensions and turn on Developer mode.'
Write-Output '  2. Click Load unpacked. If Rote is already listed, click its reload icon and stop here.'
Write-Output '  3. Paste the folder path, which is now on your clipboard, and choose the folder.'
if ($WithBridge) {
  Write-Output ''
  Write-Output "The bridge is unpacked in $Destination. Rote shows its setup command under Profile and logs. Run that command from $Destination."
}

try { Set-Clipboard $extension } catch { Write-Output "Could not reach the clipboard. The folder is $extension" }
if (-not $NoOpen) {
  try { Start-Process chrome 'chrome://extensions' } catch { Write-Output 'Could not start Chrome. Open chrome://extensions yourself.' }
}
