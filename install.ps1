# Downloads the latest Rote release and unpacks it, ready for Chrome's Load unpacked.
# Chrome does not let a script add an extension, so the last three clicks are yours.
# Run it again to update. Works in Windows PowerShell 5.1 and PowerShell 7.
param(
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Rote'),
  # Also unpacks and registers the optional bridge for Claude Code and Codex. Needs Node.
  [switch]$WithBridge,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
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

# Chrome names an unpacked extension after its folder: the first 16 bytes of the SHA-256
# of the full path, written with the letters a to p. Knowing the ID before Chrome loads
# the folder lets the bridge be registered in the same run.
function Get-UnpackedExtensionId([string]$Folder) {
  $full = [IO.Path]::GetFullPath($Folder).TrimEnd('\')
  $full = $full.Substring(0, 1).ToUpper() + $full.Substring(1)
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($full))
  -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}

$extension = Join-Path $Destination 'extension'
Expand-Asset '^rote-\d[\d.]*\.zip$' $extension
$bridgeNote = ''
if ($WithBridge) {
  Expand-Asset '^rote-bridge-\d[\d.]*\.zip$' $Destination
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $bridgeNote = "The bridge is unpacked in $Destination but needs Node. Install it from https://nodejs.org and run this again."
  } else {
    # A child process, because the default execution policy blocks a .ps1 file even when this script arrived through a pipe.
    $ErrorActionPreference = 'Continue'
    $bridgeOutput = & (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Destination 'bridge\install.ps1') -ExtensionId (Get-UnpackedExtensionId $extension) 2>&1
    $bridgeFailed = $LASTEXITCODE -ne 0
    $ErrorActionPreference = 'Stop'
    if ($bridgeFailed) {
      $bridgeNote = "The bridge is unpacked in $Destination but was not registered:`n$($bridgeOutput | Out-String)"
    } else {
      $bridgeNote = 'The bridge to Claude Code and Codex is registered. Moving the Rote folder breaks it, so run this again after a move.'
    }
  }
}

Write-Output "Rote $($release.tag_name) is unpacked in $extension"
Write-Output ''
Write-Output 'To finish in Chrome:'
Write-Output '  1. Open chrome://extensions and turn on Developer mode.'
Write-Output '  2. Click Load unpacked. If Rote is already listed, click its reload icon and stop here.'
Write-Output '  3. Paste the folder path, which is now on your clipboard, and choose the folder.'
if ($bridgeNote) {
  Write-Output ''
  Write-Output $bridgeNote
}

try { Set-Clipboard $extension } catch { Write-Output "Could not reach the clipboard. The folder is $extension" }
if (-not $NoOpen) {
  try { Start-Process chrome 'chrome://extensions' } catch { Write-Output 'Could not start Chrome. Open chrome://extensions yourself.' }
}
