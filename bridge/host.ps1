# Native Messaging host. Chrome starts it for one request, passes the request on
# stdin, reads one reply from stdout, and the process exits. It runs in the
# Windows PowerShell that ships with Windows, so the bridge needs nothing else installed.
# Nothing may write to the success stream here, because stdout carries the reply.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Web.Extensions
$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = [int]::MaxValue

$TimeoutMs = 240000
$Utf8 = New-Object System.Text.UTF8Encoding $false
$ModelPattern = '\A[A-Za-z0-9_.-]+\z'
# A started program's stdin uses the console input encoding, and a UTF-8 one with a
# byte order mark would put that mark in front of the prompt.
try { [Console]::InputEncoding = $Utf8 } catch {}

# Picks the first path that exists, then anything on PATH that Windows can start directly.
function Find-Tool([string]$Override, [string[]]$Candidates, [string]$Name) {
  if ($Override) { return $Override }
  foreach ($pattern in $Candidates) {
    $hit = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  $onPath = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -match '\.exe$' } | Select-Object -First 1
  if ($onPath) { return $onPath.Source }
  return $Name
}

$npm = Join-Path $env:APPDATA 'npm\node_modules'
$Claude = @{
  Name = 'Claude Code'
  Path = Find-Tool $env:CLAUDE_BIN @(Join-Path $HOME '.local\bin\claude.exe') 'claude'
}
# The npm package for Codex carries a native codex.exe, so the bridge runs that and skips Node.
$Codex = @{
  Name = 'Codex'
  Path = Find-Tool $env:CODEX_BIN @(
    (Join-Path $npm '@openai\codex\node_modules\@openai\codex-win32-*\vendor\*\bin\codex.exe'),
    (Join-Path $npm '@openai\codex\vendor\*\codex\codex.exe')
  ) 'codex'
}

# Windows passes a program one command line, and the program splits it back into
# arguments. This quotes each argument so that split gives back exactly what was sent.
function ConvertTo-Argument([string]$Value) {
  if ($Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $out = New-Object System.Text.StringBuilder
  [void]$out.Append('"')
  $slashes = 0
  foreach ($c in $Value.ToCharArray()) {
    if ($c -eq [char]92) {
      $slashes++
    } elseif ($c -eq '"') {
      [void]$out.Append([string]::new([char]92, $slashes * 2 + 1)).Append('"')
      $slashes = 0
    } else {
      [void]$out.Append([string]::new([char]92, $slashes)).Append($c)
      $slashes = 0
    }
  }
  [void]$out.Append([string]::new([char]92, $slashes * 2)).Append('"')
  return $out.ToString()
}

function Invoke-Tool($Tool, [string[]]$Arguments, [string]$Stdin, [string]$Cwd) {
  $file = $Tool.Path
  $all = @($Arguments)
  # A .cmd or .bat file runs through cmd.exe, which reads characters like & and % in the
  # prompt as commands. The bridge refuses those rather than risk it.
  if ($file -match '\.(cmd|bat|ps1)$') { throw "Could not start $($Tool.Name) at ${file}: the bridge can only start a program file, not a script." }
  # A script path, used by the tests, runs through Node when Node is there.
  if ($file -match '\.[cm]?js$') {
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { throw "Could not start $($Tool.Name) at ${file}: it is a script and Node is not installed." }
    $all = @($file) + $all
    $file = $node.Source
  }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $file
  $info.Arguments = ($all | ForEach-Object { ConvertTo-Argument $_ }) -join ' '
  $info.WorkingDirectory = $Cwd
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = $Utf8
  $info.StandardErrorEncoding = $Utf8
  try {
    $process = [System.Diagnostics.Process]::Start($info)
  } catch {
    $why = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
    throw "Could not start $($Tool.Name) at ${file}: $why"
  }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  try {
    $bytes = $Utf8.GetBytes($Stdin)
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $process.StandardInput.Close()
  } catch {
    # The tool exited before reading its input. Its exit code and output explain why.
  }
  if (-not $process.WaitForExit($TimeoutMs)) {
    try { $process.Kill() } catch {}
    throw "$($Tool.Name) took longer than four minutes."
  }
  $process.WaitForExit()
  return @{ Code = $process.ExitCode; Stdout = $stdout.Result; Stderr = $stderr.Result }
}

function New-TempFolder {
  $folder = Join-Path ([IO.Path]::GetTempPath()) ('resume-autofill-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  [void](New-Item -ItemType Directory -Path $folder)
  return $folder
}

function Get-Field($Map, [string]$Key) {
  if ($Map -is [System.Collections.IDictionary] -and $Map.ContainsKey($Key)) { return , $Map[$Key] }
  return $null
}

function Limit([string]$Text, [int]$Count, [switch]$FromEnd) {
  if ($Text.Length -le $Count) { return $Text }
  if ($FromEnd) { return $Text.Substring($Text.Length - $Count) }
  return $Text.Substring(0, $Count)
}

# An empty working directory and no setting sources keep project files, hooks,
# plugins and MCP servers out of the run. The --bare flag would do the same but
# it requires an API key, and this route exists to use the Claude Code sign-in.
function Invoke-Claude([string]$System, [string]$Prompt, $Schema, [string]$Model) {
  if ($Model -notmatch $ModelPattern) { throw 'The bridge received an invalid model name.' }
  $cwd = New-TempFolder
  try {
    $run = Invoke-Tool $Claude @(
      '-p',
      '--output-format', 'json',
      '--json-schema', $json.Serialize($Schema),
      '--system-prompt', $System,
      '--model', $Model,
      '--tools', '',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence'
    ) $Prompt $cwd
    try {
      $parsed = $json.DeserializeObject($run.Stdout)
    } catch {
      $parsed = $null
    }
    if ($parsed -isnot [System.Collections.IDictionary]) {
      $text = if ($run.Stderr) { $run.Stderr } else { $run.Stdout }
      throw "Claude Code exited with code $($run.Code): $(Limit $text 400)"
    }
    if ((Get-Field $parsed 'is_error') -eq $true) {
      $why = Get-Field $parsed 'result'
      if ($null -eq $why) { $why = Get-Field $parsed 'subtype' }
      throw "Claude Code reported an error: $(Limit ([string]$why) 400)"
    }
    if (-not $parsed.ContainsKey('structured_output')) { throw 'Claude Code returned no structured answer.' }
    return , $parsed['structured_output']
  } finally {
    Remove-Item -LiteralPath $cwd -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Codex has no system prompt flag, so the instructions lead the prompt. An empty
# working directory, a read-only sandbox and no user config keep project files,
# rules and MCP servers out of the run. The sign-in still comes from the Codex home folder.
# An empty model leaves the choice to Codex.
function Invoke-Codex([string]$System, [string]$Prompt, $Schema, [string]$Model) {
  if ($Model -and $Model -notmatch $ModelPattern) { throw 'The bridge received an invalid model name.' }
  $cwd = New-TempFolder
  $files = New-TempFolder
  $schemaFile = Join-Path $files 'schema.json'
  $answerFile = Join-Path $files 'answer.json'
  try {
    [IO.File]::WriteAllText($schemaFile, $json.Serialize($Schema), $Utf8)
    $arguments = @(
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox', 'read-only',
      '--color', 'never',
      '--cd', $cwd,
      '--output-schema', $schemaFile,
      '--output-last-message', $answerFile
    )
    if ($Model) { $arguments += @('--model', $Model) }
    $arguments += '-'
    $run = Invoke-Tool $Codex $arguments "$System`n`n$Prompt" $cwd
    if (-not (Test-Path -LiteralPath $answerFile)) {
      $text = if ($run.Stderr) { $run.Stderr } else { $run.Stdout }
      throw "Codex exited with code $($run.Code) and no answer: $(Limit $text 400 -FromEnd)"
    }
    $text = [IO.File]::ReadAllText($answerFile, $Utf8)
    try {
      $answer = $json.DeserializeObject($text)
    } catch {
      throw "Codex returned something other than JSON: $(Limit $text 200)"
    }
    return , $answer
  } finally {
    Remove-Item -LiteralPath $cwd, $files -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Tells the options page which tools this PC has, so it can say what is missing.
function Find-Version($Tool) {
  try {
    $run = Invoke-Tool $Tool @('--version') '' ([IO.Path]::GetTempPath())
    if ($run.Code -eq 0) { return @{ found = $true; version = ($run.Stdout.Trim() -split "`n")[0].Trim() } }
  } catch {}
  return @{ found = $false }
}

function Invoke-Request($Request) {
  $type = Get-Field $Request 'type'
  $engine = Get-Field $Request 'engine'
  if ($type -eq 'status') {
    return @{ ok = $true; claude = (Find-Version $Claude); codex = (Find-Version $Codex) }
  }
  if ($type -eq 'ping') {
    $tool = if ($engine -eq 'codex') { $Codex } else { $Claude }
    $run = Invoke-Tool $tool @('--version') '' ([IO.Path]::GetTempPath())
    if ($run.Code -ne 0) { throw "$($tool.Name) exited with code $($run.Code): $(Limit $run.Stderr 400)" }
    return @{ ok = $true; version = $run.Stdout.Trim() }
  }
  if ($type -eq 'ask') {
    $system = Get-Field $Request 'system'
    $prompt = Get-Field $Request 'prompt'
    $schema = Get-Field $Request 'schema'
    if ($prompt -isnot [string] -or $system -isnot [string] -or -not $schema) { throw 'The bridge received an incomplete request.' }
    $model = [string](Get-Field $Request 'model')
    if ($engine -eq 'codex') { $result = Invoke-Codex $system $prompt $schema $model }
    else { $result = Invoke-Claude $system $prompt $schema $model }
    return @{ ok = $true; result = $result }
  }
  throw 'The bridge received an unknown request.'
}

# Chrome frames each message as a four byte little-endian length and then UTF-8 JSON.
function Read-Exactly($Stream, [int]$Count) {
  $buffer = New-Object byte[] $Count
  $read = 0
  while ($read -lt $Count) {
    $n = $Stream.Read($buffer, $read, $Count - $read)
    if ($n -le 0) { throw 'Chrome closed the connection before sending a whole request.' }
    $read += $n
  }
  return , $buffer
}

function Send-Reply($Message) {
  $body = $Utf8.GetBytes($json.Serialize($Message))
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes([uint32]$body.Length), 0, 4)
  $stdout.Write($body, 0, $body.Length)
  $stdout.Flush()
}

try {
  $stdin = [Console]::OpenStandardInput()
  $size = [BitConverter]::ToUInt32((Read-Exactly $stdin 4), 0)
  $request = $json.DeserializeObject($Utf8.GetString((Read-Exactly $stdin ([int]$size))))
  $reply = Invoke-Request $request
} catch {
  $reply = @{ ok = $false; error = $_.Exception.Message }
}
Send-Reply $reply
exit 0
