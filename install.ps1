# Downloads the latest Rote release and unpacks it, ready for Chrome's Load unpacked.
# Run it again to update. An update keeps the same folder, so Chrome keeps the same
# extension ID and your saved profile, and the bridge is updated too if it is there.
# Chrome does not let a script add an extension, so the first install ends with three clicks.
# Works in Windows PowerShell 5.1 and PowerShell 7.
param(
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Rote'),
  # Also unpacks and registers the optional bridge for Claude Code and Codex.
  [switch]$WithBridge,
  [switch]$NoOpen,
  # Downloads and unpacks again even when this version is already there.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
$extension = Join-Path $Destination 'extension'
$bridge = Join-Path $Destination 'bridge'
$headers = @{ 'User-Agent' = 'rote-install' }
$release = Invoke-RestMethod 'https://api.github.com/repos/shin2344234/rote/releases/latest' -Headers $headers
$latest = $release.tag_name -replace '^v', ''

function Get-InstalledVersion {
  $file = Join-Path $extension 'manifest.json'
  if (-not (Test-Path $file)) { return $null }
  try { return (Get-Content $file -Raw | ConvertFrom-Json).version } catch { return 'unknown' }
}

# Downloads one release file, checks it, and unpacks it into a new temporary folder.
function Get-Asset([string]$Pattern) {
  $asset = $release.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
  if (-not $asset) { throw "Release $($release.tag_name) has no file matching $Pattern." }
  $work = Join-Path ([IO.Path]::GetTempPath()) ('rote-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory $work | Out-Null
  $zip = Join-Path $work $asset.name
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers $headers -UseBasicParsing
  # GitHub records a SHA-256 for each release file. A mismatch means the download is not what was published.
  if ($asset.digest -match '^sha256:(.+)$') {
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
    if ($actual -ne $Matches[1]) {
      Remove-Item $work -Recurse -Force
      throw "The download of $($asset.name) does not match the published checksum."
    }
  }
  $unpacked = Join-Path $work 'files'
  Expand-Archive $zip -DestinationPath $unpacked
  return (Get-Item -LiteralPath $unpacked).FullName
}

# Makes $To hold exactly the files in $From, in place. Replacing the folder itself would
# also work, but Chrome or Explorer may have it open, and the path has to stay the same.
# It refuses a folder that is not empty and does not look like an earlier copy, so a
# mistyped -Destination can't delete someone's files.
function Sync-Folder([string]$From, [string]$To, [string]$Marker) {
  if ((Test-Path $To) -and (Get-ChildItem -LiteralPath $To -Force | Select-Object -First 1) -and -not (Test-Path (Join-Path $To $Marker))) {
    throw "$To already holds files that are not Rote. Pick another folder with -Destination."
  }
  New-Item -ItemType Directory -Force $To | Out-Null
  $To = (Get-Item -LiteralPath $To).FullName
  $keep = @{}
  foreach ($file in Get-ChildItem -LiteralPath $From -Recurse -File -Force) {
    $relative = $file.FullName.Substring($From.Length).TrimStart('\')
    $keep[$relative.ToLowerInvariant()] = $true
    $target = Join-Path $To $relative
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
  }
  foreach ($file in Get-ChildItem -LiteralPath $To -Recurse -File -Force) {
    $relative = $file.FullName.Substring($To.Length).TrimStart('\')
    if (-not $keep.ContainsKey($relative.ToLowerInvariant())) { Remove-Item -LiteralPath $file.FullName -Force }
  }
  Get-ChildItem -LiteralPath $To -Recurse -Directory -Force | Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1) } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
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

# Started with only a URL, Chrome shows its profile picker and then drops the URL.
# Naming a profile skips the picker. This picks the profile that already has this
# copy of Rote loaded, or else the one used last.
function Find-ChromeProfile([string]$Folder) {
  $userData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
  $found = @{ Directory = $null; Name = $null; Loaded = $false }
  try { $state = [IO.File]::ReadAllText((Join-Path $userData 'Local State')) | ConvertFrom-Json } catch { return $found }
  $profiles = $state.profile.info_cache
  # Chrome's preference files are JSON, so the path appears there with its backslashes doubled.
  $needle = '"' + [IO.Path]::GetFullPath($Folder).TrimEnd('\').Replace('\', '\\') + '"'
  foreach ($directory in @($profiles.PSObject.Properties.Name)) {
    foreach ($name in 'Secure Preferences', 'Preferences') {
      $file = Join-Path $userData "$directory\$name"
      if (-not (Test-Path -LiteralPath $file)) { continue }
      try { $text = [IO.File]::ReadAllText($file) } catch { continue }
      if ($text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return @{ Directory = $directory; Name = $profiles.$directory.name; Loaded = $true }
      }
    }
  }
  $last = $state.profile.last_used
  if (-not $last) { $last = 'Default' }
  $found.Directory = $last
  if ($profiles.$last) { $found.Name = $profiles.$last.name }
  return $found
}

function Register-Bridge {
  # A child process, because the default execution policy blocks a .ps1 file even when this script arrived through a pipe.
  $ErrorActionPreference = 'Continue'
  $output = & (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bridge 'install.ps1') -ExtensionId (Get-UnpackedExtensionId $extension) 2>&1
  if ($LASTEXITCODE -ne 0) { return "The bridge is unpacked in $bridge but was not registered:`n$($output | Out-String)" }
  return 'The bridge to Claude Code and Codex is registered. Moving the Rote folder breaks it, so run this again after a move.'
}

$installed = Get-InstalledVersion
$hadBridge = (Test-Path (Join-Path $bridge 'install.ps1'))
$current = $installed -eq $latest -and -not $Force
$lines = @()
$next = $null

if ($current) {
  $lines += "Rote $latest in $extension is already the latest version."
} else {
  $files = Get-Asset '^rote-\d[\d.]*\.zip$'
  Sync-Folder $files $extension 'manifest.json'
  Remove-Item (Split-Path $files) -Recurse -Force
  if ($installed) { $lines += "Rote in $extension is updated from $installed to $latest." }
  else { $lines += "Rote $latest is unpacked in $extension" }
}

# The bridge comes from the same release, so it is updated whenever the extension is,
# and installed when it was asked for and is not there yet.
if (($hadBridge -and -not $current) -or ($WithBridge -and (-not $hadBridge -or -not $current))) {
  $files = Get-Asset '^rote-bridge-\d[\d.]*\.zip$'
  Sync-Folder (Join-Path $files 'bridge') $bridge 'install.ps1'
  Remove-Item (Split-Path $files) -Recurse -Force
  $lines += ''
  $lines += Register-Bridge
} elseif ($WithBridge) {
  $lines += ''
  $lines += Register-Bridge
}

$chrome = Find-ChromeProfile $extension
$inProfile = if ($chrome.Name) { ", in the Chrome profile named $($chrome.Name)" } else { '' }
$lines += ''
if ($chrome.Loaded -and $current) {
  $lines += "Chrome already has this copy loaded$inProfile. Nothing else to do."
} elseif ($chrome.Loaded) {
  $next = 'reload'
  $lines += "To finish in Chrome$inProfile, do this."
  $lines += '  1. Type chrome://extensions in the address bar and press Enter.'
  $lines += '  2. Click the reload icon on the Rote card.'
  $lines += 'Your saved profile and answers stay as they were.'
} else {
  $next = 'load'
  $lines += "To finish in Chrome$inProfile, do this."
  $lines += '  1. Type chrome://extensions in the address bar and press Enter.'
  $lines += '  2. Turn on Developer mode at the top right, then click Load unpacked.'
  $lines += '  3. Paste the folder path, which is now on your clipboard, and choose the folder.'
  if ($installed) {
    $lines += 'Chrome does not have this folder loaded. If you loaded Rote from a different folder,'
    $lines += 'that copy keeps its own saved profile. Update it there, or remove it once this one works.'
  }
  try { Set-Clipboard $extension } catch { $lines += "Could not reach the clipboard. The folder is $extension" }
}
$lines | ForEach-Object { Write-Output $_ }

if (-not $NoOpen -and $next) {
  # Chrome ignores chrome:// addresses given on its command line, so this opens a Rote
  # page with the same steps. Started with only an address, Chrome may show its profile
  # picker and then drop the address, so the profile is named too. Start-Process in
  # Windows PowerShell does not quote arguments, and profile folders have spaces, like Profile 1.
  $page = "https://rote.walker-computers.com/next/$next"
  $arguments = if ($chrome.Directory) { "--profile-directory=`"$($chrome.Directory)`" $page" } else { $page }
  try { Start-Process chrome $arguments } catch { Write-Output 'Could not start Chrome. Open it yourself and follow the steps above.' }
}
