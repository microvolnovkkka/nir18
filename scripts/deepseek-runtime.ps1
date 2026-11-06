# Runtime files are deliberately kept outside the source folder so its complete
# contents can be uploaded to GitHub without binaries, caches or machine paths.
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeBase = $env:NIR18_RUNTIME_DIR
if (-not $runtimeBase) { $runtimeBase = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\nir18-deepseek-runtime' }
$hasher = [Security.Cryptography.SHA256]::Create()
try { $projectHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-','').Substring(0,16).ToLowerInvariant() }
finally { $hasher.Dispose() }
$localRoot = Join-Path $runtimeBase "projects\$projectHash"
