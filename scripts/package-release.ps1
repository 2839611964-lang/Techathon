param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputPath) {
  $OutputPath = Join-Path (Split-Path $sourceRoot -Parent) 'Marie-AI-Source.zip'
}
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stagingRoot = Join-Path $tempBase ("marie-package-" + [guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $stagingRoot 'Marie-AI'

Push-Location $sourceRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw '生产构建失败' }

  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  $files = @('.env.example', '.gitignore', 'README.md', 'index.html', 'package.json', 'package-lock.json', 'server.js', 'dev-api.js', 'vite.config.js', 'vercel.json', 'start-demo.cmd', 'start-dev.cmd', 'share-online.cmd')
  $directories = @('api', 'server', 'src', 'public', 'scripts', 'dist')
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination $packageRoot }
  foreach ($directory in $directories) { Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination $packageRoot -Recurse }

  $forbidden = Get-ChildItem -LiteralPath $packageRoot -Recurse -Force | Where-Object { $_.Name -in @('.env.local', '.git', 'node_modules') }
  if ($forbidden) { throw "打包内容包含禁止文件：$($forbidden.FullName -join ', ')" }
  if (Test-Path -LiteralPath $outputFullPath) { Remove-Item -LiteralPath $outputFullPath }
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $outputFullPath -CompressionLevel Optimal
  Write-Host "`n源码包已生成：$outputFullPath"
} finally {
  Pop-Location
  $resolvedStaging = [IO.Path]::GetFullPath($stagingRoot)
  if ($resolvedStaging.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStaging)) {
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}
