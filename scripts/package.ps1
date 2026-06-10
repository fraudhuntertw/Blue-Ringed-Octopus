<#
.SYNOPSIS
    打包 Blue-Ringed-Octopus 為可上架 / sideload 的乾淨 .zip。

.DESCRIPTION
    採「白名單」策略：只複製 extension 執行期真正需要的檔案，
    自動排除建置工具、暫存檔、個人/內部資料與開發筆記。
    產出 dist/blue-ringed-octopus-v<version>.zip（version 取自 manifest.json）。

    刻意排除（不會進壓縮包）：
      - scripts/、icons/generate.py、icons/icon16.png（未被 manifest 引用）
      - *.tmp.*、誤建的「 - 複製」副本檔
      - fraudsite.txt、local/、anonymous*、todo.md、BRO.md、.claude/、.git
      - README.md（上架不需要；要附說明可自行加 -IncludeReadme）

    ⚠️ 本腳本只負責「打包乾淨」。匿名發布的帳號 / IP / 瀏覽器隔離等
       operational security 請另見 anonymous-checklist.md。

.EXAMPLE
    pwsh scripts/package.ps1
    pwsh scripts/package.ps1 -IncludeReadme
#>
[CmdletBinding()]
param(
    [switch]$IncludeReadme
)

$ErrorActionPreference = 'Stop'

# 專案根目錄 = 本腳本的上一層
$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    throw "找不到 manifest.json（預期路徑：$manifestPath）"
}

$version = (Get-Content $manifestPath -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw 'manifest.json 缺少 version 欄位'
}
Write-Host "打包版本：v$version" -ForegroundColor Cyan

# 暫存目錄與輸出
$distDir = Join-Path $root 'dist'
# staging 放系統暫存目錄，避免 Dropbox / OneDrive 等同步軟體在壓縮時鎖住剛複製的檔案
$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) "_stage-bro"
$zipPath = Join-Path $distDir "blue-ringed-octopus-v$version.zip"

New-Item -ItemType Directory -Path $distDir -Force | Out-Null
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

# ---- 白名單：(來源相對路徑, glob 過濾) ----
# 整個目錄複製（再個別剔除雜物）
function Copy-Tree {
    param([string]$RelDir, [string[]]$Include)
    $srcDir = Join-Path $root $RelDir
    if (-not (Test-Path $srcDir)) { return }
    $dstDir = Join-Path $stageDir $RelDir
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    Get-ChildItem -Path $srcDir -Recurse -File | ForEach-Object {
        $name = $_.Name
        # 一律排除暫存檔與誤建副本
        if ($name -like '*.tmp.*' -or $name -like '* - 複製*' -or $name -like '*copy*.png') { return }
        $ok = $false
        foreach ($pat in $Include) { if ($name -like $pat) { $ok = $true; break } }
        if (-not $ok) { return }
        $rel = $_.FullName.Substring($srcDir.Length).TrimStart('\','/')
        $target = Join-Path $dstDir $rel
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item $_.FullName $target -Force
    }
}

# manifest（單檔）
Copy-Item $manifestPath (Join-Path $stageDir 'manifest.json') -Force

# 各 runtime 目錄
Copy-Tree 'background' @('*.js')
Copy-Tree 'content'    @('*.js', '*.css')
Copy-Tree 'popup'      @('*.html', '*.js', '*.css')
Copy-Tree 'options'    @('*.html', '*.js', '*.css')
Copy-Tree 'lib'        @('*.js')                 # *.tmp.* 已在 Copy-Tree 內排除
Copy-Tree '_locales'   @('*.json')
Copy-Tree 'icons'      @('octopus-*.png')        # 只收章魚五狀態，排除 generate.py / icon16.png / 複製檔

if ($IncludeReadme) {
    Copy-Item (Join-Path $root 'README.md') (Join-Path $stageDir 'README.md') -Force
}

# ---- 壓縮 ----
# 不用 Compress-Archive：Windows PowerShell 5.1（.NET Framework 後端）會把 zip entry
# 路徑用反斜線「\」分隔,Chrome / Web Store 解壓時無法辨識子目錄而整包壞掉。
# 改用 System.IO.Compression 手動逐檔建 entry,強制以「/」分隔,5.1 與 pwsh 7 皆正確。
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
# ZipArchiveMode / CompressionLevel 型別在 .NET Framework 位於 System.IO.Compression.dll,
# 5.1 不會隨 FileSystem.dll 連帶載入,少這行會直接噴 Unable to find type。
Add-Type -AssemblyName System.IO.Compression
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -Path $stageDir -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($stageDir.Length).TrimStart('\', '/').Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}

# ---- 清單與大小回報 ----
$files = Get-ChildItem -Path $stageDir -Recurse -File
$sizeKB = [math]::Round(((Get-Item $zipPath).Length / 1KB), 1)
Write-Host "已產生：$zipPath  ($sizeKB KB, $($files.Count) 檔)" -ForegroundColor Green
$files | ForEach-Object { '  ' + $_.FullName.Substring($stageDir.Length).TrimStart('\','/').Replace('\','/') } | Sort-Object | Write-Host

Remove-Item $stageDir -Recurse -Force
