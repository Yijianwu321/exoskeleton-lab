$ErrorActionPreference = 'Stop'
$siteRoot = $PSScriptRoot
$pythonCandidates = @(
  (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'),
  'C:\Python314\python.exe',
  'python.exe'
)
$pythonExe = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $pythonExe) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) { $pythonExe = $pythonCommand.Source }
}
if (-not $pythonExe) { Write-Host '未找到 Python。请使用任意本地静态网页服务器打开本文件夹。'; Read-Host '按回车退出'; exit 1 }
$portNumber = 8776
try {
  $serverProcess = Start-Process -FilePath $pythonExe -ArgumentList @('-m','http.server',"$portNumber",'--bind','127.0.0.1','--directory',('"' + $siteRoot + '"')) -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 800
  if ($serverProcess.HasExited) { throw '本地预览端口可能已被占用，请关闭之前的预览或更换端口。' }
  Start-Process "http://127.0.0.1:$portNumber/model.html"
  Write-Host '预览已打开。保持此窗口运行，结束后按回车关闭本次预览服务。'
  Read-Host | Out-Null
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue }
}
