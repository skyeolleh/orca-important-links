param([switch]$WaitForExit, [switch]$ValidateOnly, [switch]$Restore)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Orca-ProcessGuard.ps1')
$planPath = Join-Path $PSScriptRoot 'artifacts\connection-plan.json'
$logPath = Join-Path $PSScriptRoot 'artifacts\apply-status.txt'
function Log([string]$message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Output $line
}
function Hash([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function RunningOrca {
  @(Get-OrcaConnectionBlockingProcesses -Executable $plan.executable)
}
try {
  $plan = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $expected = [IO.Path]::GetFullPath((Join-Path $plan.install 'resources\app.asar'))
  if (![string]::Equals($expected, [IO.Path]::GetFullPath($plan.originalPath), [StringComparison]::OrdinalIgnoreCase)) { throw '설치 대상 경로가 계획과 다릅니다.' }
  if ($plan.version -ne '1.4.222') { throw '지원하지 않는 Orca 버전입니다.' }
  if ((Hash $plan.backup) -ne $plan.originalHash -or (Hash $plan.replacement) -ne $plan.replacementHash) { throw '준비된 연결 파일의 해시가 다릅니다.' }
  if ((Hash $plan.executable) -ne $plan.executableHash) { throw 'Orca가 업데이트됐습니다. 연결을 다시 준비하세요.' }
  $fromHash = if ($Restore) { $plan.replacementHash } else { $plan.originalHash }
  $toHash = if ($Restore) { $plan.originalHash } else { $plan.replacementHash }
  $source = if ($Restore) { $plan.backup } else { $plan.replacement }
  if ((Hash $plan.originalPath) -eq $toHash) { Log '이미 요청한 상태입니다.'; exit 0 }
  if ((Hash $plan.originalPath) -ne $fromHash) { throw '설치본이 준비 이후 바뀌었습니다. 덮어쓰지 않습니다.' }
  if ($ValidateOnly) { Log '대상·버전·원본·연결 파일 검증 통과. 설치본은 변경하지 않았습니다.'; exit 0 }
  if ((RunningOrca).Count -gt 0) {
    if (!$WaitForExit) { throw 'Orca가 실행 중입니다. 종료 후 적용하거나 -WaitForExit로 기다리세요.' }
    Log 'Orca 앱이 종료될 때까지 대기합니다. 남은 충돌 보고기는 대기 대상에서 제외하며 앱·터미널은 종료하지 않습니다.'
    $deadline = (Get-Date).AddHours(24)
    while ((RunningOrca).Count -gt 0) {
      if ((Get-Date) -gt $deadline) { throw '대기 시간이 끝났습니다. 종료 후 다시 적용하세요.' }
      Start-Sleep -Seconds 5
    }
  }
  if ((Hash $plan.originalPath) -ne $fromHash -or (Hash $plan.executable) -ne $plan.executableHash) { throw '대기 중 앱이 변경됐습니다. 설치를 중단합니다.' }
  $staging = Join-Path (Split-Path -Parent $plan.originalPath) ('important-links-' + [Guid]::NewGuid().ToString() + '.tmp')
  $rollback = Join-Path (Split-Path -Parent $plan.originalPath) ('important-links-' + [Guid]::NewGuid().ToString() + '.rollback')
  $committed = $false
  try {
    Copy-Item -LiteralPath $source -Destination $staging
    if ((Hash $staging) -ne $toHash) { throw '임시 연결 파일 검증 실패.' }
    if ((RunningOrca).Count -gt 0) { throw 'Orca가 다시 실행되어 적용을 중단합니다.' }
    if ((Hash $plan.originalPath) -ne $fromHash) { throw '설치본이 바뀌어 적용을 중단합니다.' }
    [IO.File]::Replace($staging, $plan.originalPath, $rollback)
    if ((Hash $plan.originalPath) -ne $toHash) {
      [IO.File]::Replace($rollback, $plan.originalPath, $null)
      throw '적용 검증 실패. 원래 설치본으로 복원했습니다.'
    }
    $committed = $true
    Log $(if ($Restore) { '복원 완료. 다음 Orca 실행부터 원래 설치본을 사용합니다.' } else { '연결 적용 완료. 다음 Orca 실행부터 중요 링크 0.4.0과 연결됩니다.' })
  } finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging }
    if ($committed -and (Test-Path -LiteralPath $rollback)) { Remove-Item -LiteralPath $rollback }
  }
} catch { Log ('실패: ' + $_.Exception.Message); exit 1 }
