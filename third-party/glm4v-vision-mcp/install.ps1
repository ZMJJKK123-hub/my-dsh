#requires -Version 5.1
<#
.SYNOPSIS
  GLM-4.6V-Flash 图像理解 MCP —— Windows 一键安装脚本

.DESCRIPTION
  1. 创建 Python 虚拟环境并安装依赖（mcp / httpx / python-dotenv / Pillow）
  2. 写入 server\.env（ZHIPU_API_KEY）
  3. 把 MCP 服务器注册进 Codex 配置 ~\.codex\config.toml（幂等）
  4. 修复 Codex models.json 隐藏 MCP 工具的 bug（issue #36382）
  5. 安装 Codex Skill（glm-image-understanding）
  6. 运行离线冒烟测试

.EXAMPLE
  .\install.ps1                          # 交互输入 ZHIPU_API_KEY
  $env:ZHIPU_API_KEY="xxx"; .\install.ps1
  .\install.ps1 -ApiKey xxx
#>
[CmdletBinding()]
param([string]$ApiKey = "")

$ErrorActionPreference = "Stop"
$ProjectDir = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$Server     = Join-Path $ProjectDir "server\glm4v_mcp_server.py"
$Venv       = Join-Path $ProjectDir ".venv"
$VenvPy     = Join-Path $Venv "Scripts\python.exe"
$CodexHome  = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }

function Write-Info  { Write-Host "[info]  $args" -ForegroundColor Cyan }
function Write-Ok    { Write-Host "[ok]    $args" -ForegroundColor Green }
function Write-Warn2 { Write-Host "[warn]  $args" -ForegroundColor Yellow }
function Write-Err   { Write-Host "[error] $args" -ForegroundColor Red }

# ---------------------------------------------------------------- 1. python 3.10+
$py = $null
foreach ($cand in @((Get-Command python -ErrorAction SilentlyContinue), (Get-Command py -ErrorAction SilentlyContinue))) {
    if (-not $cand) { continue }
    try {
        $ver = & $cand.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($LASTEXITCODE -eq 0 -and $ver -match '^\d+\.\d+') {
            $major, $minor = ($ver -split '\.')
            if ([int]$major -gt 3 -or ([int]$major -eq 3 -and [int]$minor -ge 10)) { $py = $cand.Source; break }
        }
    } catch { }
}
if (-not $py) {
    Write-Err "未找到 Python 3.10+。请从 https://www.python.org/downloads/ 安装（安装时勾选 Add python.exe to PATH）。"
    exit 1
}
Write-Info "使用 Python: $py"

# ---------------------------------------------------------------- 2. venv + 依赖
if (-not (Test-Path $VenvPy)) {
    Write-Info "创建虚拟环境: $Venv"
    & $py -m venv $Venv
    if ($LASTEXITCODE -ne 0) { Write-Err "创建虚拟环境失败"; exit 1 }
}
& $VenvPy -m pip install --upgrade pip -q
Write-Info "安装依赖（mcp / httpx / python-dotenv / Pillow）..."
& $VenvPy -m pip install -q -r (Join-Path $ProjectDir "server\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Err "依赖安装失败，请检查网络后重试"; exit 1 }
Write-Ok "依赖安装完成"

# ---------------------------------------------------------------- 3. ZHIPU_API_KEY
if (-not $ApiKey) { $ApiKey = $env:ZHIPU_API_KEY }
if (-not $ApiKey) {
    $envFile = Join-Path $ProjectDir "server\.env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^ZHIPU_API_KEY=' } | Select-Object -First 1
        if ($line) { $ApiKey = ($line -replace '^ZHIPU_API_KEY=', '').Trim().Trim('"').Trim("'") }
    }
}
if (-not $ApiKey) {
    $secure = Read-Host -Prompt "请输入 ZHIPU_API_KEY（获取：https://open.bigmodel.cn/usercenter/apikeys）" -AsSecureString
    $ApiKey = [System.Net.NetworkCredential]::new('', $secure).Password
}
$ApiKey = $ApiKey.Trim()
if (-not $ApiKey) {
    Write-Warn2 "未输入 Key，将写入占位符 REPLACE_WITH_YOUR_REAL_KEY，稍后需手动替换"
    $ApiKey = "REPLACE_WITH_YOUR_REAL_KEY"
}
$envFile = Join-Path $ProjectDir "server\.env"
[System.IO.File]::WriteAllText($envFile, "ZHIPU_API_KEY=$ApiKey`r`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "已写入 $envFile"

# ---------------------------------------------------------------- 4. 注册 Codex MCP
Write-Info "注册 MCP 到 Codex 配置: $CodexHome\config.toml"
& $VenvPy (Join-Path $ProjectDir "scripts\register_codex.py") --python $VenvPy --server $Server --key $ApiKey --codex-home $CodexHome
if ($LASTEXITCODE -ne 0) { Write-Err "Codex 注册失败"; exit 1 }
Write-Ok "Codex MCP 注册完成（服务器名: glm4v）"

# ---------------------------------------------------------------- 5. 修复 models.json
Write-Info "检查 Codex models.json（DeepSeek 自定义模型会隐藏 MCP 工具，issue #36382）..."
& $VenvPy (Join-Path $ProjectDir "scripts\fix_models_json.py") --codex-home $CodexHome

# ---------------------------------------------------------------- 6. 安装 Codex Skill
$skillSrc = Join-Path $ProjectDir "skill\glm-image-understanding"
if (Test-Path $skillSrc) {
    $skillDst = Join-Path $CodexHome "skills\glm-image-understanding"
    New-Item -ItemType Directory -Force -Path $skillDst | Out-Null
    Copy-Item (Join-Path $skillSrc "*") -Destination $skillDst -Recurse -Force
    Write-Ok "已安装 Codex Skill: $skillDst"
}

# ---------------------------------------------------------------- 7. 冒烟测试
Write-Info "运行离线冒烟测试..."
& $VenvPy (Join-Path $ProjectDir "scripts\verify.py")

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " 安装完成！接下来只需 2 步：" -ForegroundColor Green
Write-Host " 1. 完全退出 Codex（不是只关窗口），重新打开" -ForegroundColor Green
Write-Host " 2. 新建会话，发送一张图片或问“这张图里有什么”" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "可选验证：codex mcp list；或让模型调用 mcp__glm4v__check_setup(ping=true)"
Write-Host "联网真实验证：`$env:ZHIPU_API_KEY='<Key>'; & `"$VenvPy`" scripts\verify.py --full"
