# LibreCanvas 一键启动：桥 → 画布 → ComfyUI → 打开浏览器
# 由 start-canvas.bat 以隐藏窗口调用；单独手动运行也可以：
#   powershell -ExecutionPolicy Bypass -File start-canvas.ps1 [-NoBrowser]

param([switch]$NoBrowser)

$ErrorActionPreference = 'Continue'
$Root = 'D:\libre-canvas'
$LogDir = Join-Path $Root 'launchers\logs'
New-Item -ItemType Directory $LogDir -Force | Out-Null
$Log = Join-Path $LogDir 'launcher.log'

function Say($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Output $line
  Add-Content -Path $Log -Value $line -Encoding UTF8
}

function Test-Port($port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ok = $c.ConnectAsync('127.0.0.1', $port).Wait(600)
    $c.Close()
    return $ok
  } catch { return $false }
}

function Wait-Port($port, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return (Test-Port $port)
}

Say '=== LibreCanvas 启动 ==='

# 1) 本机桥（后处理 / 质检 / 启停 ComfyUI）
if (Test-Port 8791) {
  Say '桥已在运行 (8791)'
} else {
  Say '启动桥…'
  Start-Process -FilePath 'node.exe' `
    -ArgumentList 'scripts\post-bridge.mjs' `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'bridge.out.log') `
    -RedirectStandardError (Join-Path $LogDir 'bridge.err.log')
  if (Wait-Port 8791 20) { Say '桥已就绪 (8791)' } else { Say '警告：桥没起来，去看 launchers\logs\bridge.err.log' }
}

# 2) 画布（vite dev server，自带 /__comfy 代理，不能换成静态托管）
if (Test-Port 5173) {
  Say '画布已在运行 (5173)'
} else {
  Say '启动画布 dev server（首次约 2~5 秒）…'
  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm run dev > launchers\logs\canvas.log 2>&1' `
    -WorkingDirectory $Root -WindowStyle Hidden
  if (Wait-Port 5173 90) { Say '画布已就绪 (5173)' } else { Say '警告：画布没起来，去看 launchers\logs\canvas.log' }
}

# 3) ComfyUI：不阻塞，交给桥异步拉起（22B 模型加载要几十秒）
if (Test-Port 8188) {
  Say 'ComfyUI 已在运行 (8188)'
} else {
  Say '通知桥后台拉起 ComfyUI（不影响画布先打开）…'
  try {
    Start-Job -ScriptBlock {
      Invoke-WebRequest -Uri 'http://127.0.0.1:8791/comfy/start' -Method POST -TimeoutSec 200 -UseBasicParsing | Out-Null
    } | Out-Null
  } catch { Say '拉起 ComfyUI 的请求失败，可在设置页点「启动 ComfyUI」' }
}

# 4) 打开浏览器
if (-not $NoBrowser) {
  if (Test-Port 5173) {
    Say '打开浏览器 http://localhost:5173'
    Start-Process 'http://localhost:5173'
  } else {
    Say '画布没就绪，不打开浏览器；请查看日志'
  }
}

Say '=== 完成 ==='
