function Test-OrcaProcessBlocksConnection {
  param($Process, [string]$Executable)
  # 소유 경로를 읽지 못하는 Orca 프로세스는 안전하게 대기 대상으로 둔다.
  if (!$Process.ExecutablePath) { return $true }
  if (![string]::Equals($Process.ExecutablePath, $Executable, [StringComparison]::OrdinalIgnoreCase)) { return $false }
  # 충돌 보고기는 앱 종료 후에도 남지만 렌더러·플러그인 코드를 읽지 않는다.
  # 주 앱, 렌더러 및 역할이 불명확한 보조 프로세스는 계속 대기한다.
  if ($Process.CommandLine -and [regex]::IsMatch($Process.CommandLine, '(?:^|\s)--type=crashpad-handler(?:\s|$)', [Text.RegularExpressions.RegexOptions]::IgnoreCase)) { return $false }
  return $true
}

function Get-OrcaConnectionBlockingProcesses {
  param([string]$Executable)
  @(Get-CimInstance Win32_Process -Filter "Name='Orca.exe'" | Where-Object {
    Test-OrcaProcessBlocksConnection -Process $_ -Executable $Executable
  })
}
