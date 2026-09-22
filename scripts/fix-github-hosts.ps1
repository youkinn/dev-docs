#requires -Version 5.1
<#
  修复本机 github.com 被解析到不可用 IP（GitHub520 hosts 过期、间歇性阻断）导致的 git / gh 连不上。
  判据：TCP 预筛 + TLS 实测（TCP 能握手不代表 TLS 能过）。
  用法：powershell -ExecutionPolicy Bypass -File scripts/fix-github-hosts.ps1 [-DryRun]
  说明：docs/github-hosts-fix.md
#>
[CmdletBinding()]
param(
    [string[]]$Candidates = @('140.82.116.3', '20.27.177.113', '20.205.243.166', '140.82.112.3', '140.82.114.3', '140.82.121.3', '4.237.22.38', '140.82.113.3'),
    [int]$Port = 443,
    [int]$TcpTimeoutMs = 3000,
    [int]$TlsTimeoutSec = 8,
    [string]$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts",
    [switch]$DryRun
)

function Test-Tcp {
    param([string]$Ip)
    $client = New-Object Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($Ip, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TcpTimeoutMs)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-Tls {
    param([string]$Ip)
    $target = "github.com:${Port}:$Ip"
    $code = (& curl.exe --resolve $target -I --max-time $TlsTimeoutSec -sS -o NUL -w "%{http_code}" https://github.com/ 2>$null) -join ''
    return ($code -match '^(200|301|302)$')
}

function Get-HostsIp {
    param([string]$Name)
    $hit = Select-String -Path $HostsPath -Pattern "^\s*(\S+)\s+$([Regex]::Escape($Name))\s*$" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.Matches[0].Groups[1].Value }
    return $null
}

$current = Get-HostsIp 'github.com'

if ($current -and (Test-Tls $current)) {
    "github.com -> $current TLS 实测可用，无需改动"
    exit 0
}

$pick = $null
foreach ($ip in $Candidates) {
    if ((Test-Tcp $ip) -and (Test-Tls $ip)) { $pick = $ip; break }
}

if (-not $pick) {
    "github.com 当前($current)不可用，候选 IP 全部 TLS 实测失败；疑似整体网络不通或全线阻断，稍后重试"
    exit 1
}

if ($DryRun) {
    "选定 $pick（DryRun，未改 hosts；当前 $current）"
    exit 0
}

$backup = Join-Path $env:TEMP ("hosts.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Copy-Item -LiteralPath $HostsPath -Destination $backup -Force

$text = [IO.File]::ReadAllText($HostsPath)
if ($current) {
    $text = [Regex]::Replace($text, '(?m)^\S+(\s+)github\.com\s*$', "$pick`$1github.com")
} else {
    $text = $text.TrimEnd() + "`r`n$pick                github.com`r`n"
}
[IO.File]::WriteAllText($HostsPath, $text, (New-Object Text.UTF8Encoding($false)))
ipconfig /flushdns | Out-Null

$resolved = (Resolve-DnsName github.com -Type A -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
"github.com -> $pick 已写入 hosts（原 $current）；DNS 已刷新；备份 $backup；解析=$resolved"