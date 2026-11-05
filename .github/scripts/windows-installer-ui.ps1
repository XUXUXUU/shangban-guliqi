# Runs only on a disposable GitHub Windows runner. Test fixture is never an app profile.
param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][string]$InstallDir,
  [Parameter(Mandatory)][string]$EvidenceDir
)
$ErrorActionPreference = 'Stop'
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Requires a disposable GitHub Actions runner.' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InstallerWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
}
'@
$u = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]::Descendants
$uninstaller = Join-Path $InstallDir 'uninstall.exe'
$app = Join-Path $InstallDir 'shang-ban-gu-li-qi.exe'
$bundle = Join-Path $env:LOCALAPPDATA 'com.shangbanguliqi.desktop'
$fixture = Join-Path $bundle 'installer-ci-fixture.txt'
$installer = (Resolve-Path -LiteralPath $Installer).Path
$evidence = (New-Item -ItemType Directory -Path $EvidenceDir -Force).FullName
$script:ActiveProcess = $null
function Get-Window($p) {
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    $p.Refresh()
    if ($p.HasExited) { throw "Installer closed before showing a window ($($p.ExitCode))." }
    if ($p.MainWindowHandle -ne 0) { return $u::FromHandle($p.MainWindowHandle) }
  }
  throw 'No interactive installer window on the runner.'
}
function Capture($window, $name) {
  $handle = [IntPtr]$window.Current.NativeWindowHandle
  $r = New-Object InstallerWindow+Rect
  if (![InstallerWindow]::GetWindowRect($handle, [ref]$r)) { throw "Cannot find bounds for $name" }
  $bitmap = New-Object System.Drawing.Bitmap(($r.R-$r.L), ($r.B-$r.T))
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $dc = $graphics.GetHdc()
    try { $ok = [InstallerWindow]::PrintWindow($handle, $dc, 2) } finally { $graphics.ReleaseHdc($dc) }
    if (!$ok) { throw "Native screenshot failed: $name" }
    $bitmap.Save((Join-Path $evidence "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}
function Find-Named($window, [string]$name) {
  $condition = New-Object System.Windows.Automation.PropertyCondition($u::NameProperty, $name)
  $exact = $window.FindFirst($scope, $condition)
  if ($exact) { return $exact }
  # The standard NSIS buttons append keyboard accelerators such as "(C)".
  $all = $window.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($control in $all) {
    $normalized = ($control.Current.Name -replace '&', '' -replace '\s*\([A-Za-z]\)\s*<?\s*>?$', '').Trim()
    if ($normalized -eq $name) { return $control }
  }
}
function Find-Control($window, [string]$name) {
  $control = Find-Named $window $name
  if (!$control) {
    $all = $window.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)
    throw "Control missing: $name; UI contains: $((@($all) | ForEach-Object { $_.Current.Name }) -join ' | ')"
  }
  return $control
}
function Invoke-Control($control) {
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke()
    return
  }
  $handle = [IntPtr]$control.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero -or ![InstallerWindow]::PostMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw "Cannot invoke NSIS control: $($control.Current.Name)"
  }
}
function Start-Uninstaller {
  # _?= runs the actual uninstaller in-place so its HWND belongs to the tracked process.
  $script:ActiveProcess = Start-Process -FilePath $uninstaller -ArgumentList "_?=$InstallDir" -PassThru
  Get-Window $script:ActiveProcess
}
function Wait-Uninstaller {
  if (!$script:ActiveProcess.WaitForExit(10000)) { throw 'Uninstaller did not close.' }
  $script:ActiveProcess = $null
}
function Finish-Uninstaller($window) {
  # The final page may be translated as 完成 or 关闭 depending on the NSIS build.
  $limit = 30
  while ($limit-- -gt 0) {
    $finish = Find-Named $window '完成'
    if (!$finish) { $finish = Find-Named $window '关闭' }
    if ($finish -and $finish.Current.IsEnabled) { break }
    Start-Sleep -Milliseconds 250
  }
  if (!$finish -or !$finish.Current.IsEnabled) { throw 'No enabled Chinese finish button.' }
  Capture $window '04-uninstall-complete'
  Invoke-Control $finish
  Wait-Uninstaller
}
try {
  if (!(Test-Path -LiteralPath $fixture)) { throw 'The disposable fixture is missing.' }
  $script:ActiveProcess = Start-Process -FilePath $installer -ArgumentList "/D=$InstallDir" -PassThru
  $setup = Get-Window $script:ActiveProcess
  Capture $setup '01-install-upgrade-welcome'
  if ($setup.Current.Name -notmatch '安装') { throw "Setup title is not Chinese: $($setup.Current.Name)" }
  # Capture the welcome page without starting installation or relying on the shell's exit dialog.
  Stop-Process -Id $script:ActiveProcess.Id
  if (!$script:ActiveProcess.WaitForExit(5000)) { throw 'Setup welcome window did not close.' }
  $script:ActiveProcess = $null

  $window = Start-Uninstaller
  Capture $window '02-uninstall-confirm'
  if ($window.Current.Name.Trim() -ne '卸载上班鼓励器') { throw "Unexpected uninstall title: $($window.Current.Name)" }
  $box = Find-Control $window '同时删除应用数据'
  $handle = [IntPtr]$box.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero) { throw 'Could not resolve the native data deletion checkbox.' }
  $state = [InstallerWindow]::SendMessage($handle, 0x00F0, [IntPtr]::Zero, [IntPtr]::Zero)
  if ($state -ne [IntPtr]::Zero) { throw 'Data deletion was preselected.' }
  $null = Find-Control $window '卸载位置：'
  Invoke-Control (Find-Control $window '取消')
  Wait-Uninstaller
  if (!(Test-Path -LiteralPath $app) -or !(Test-Path -LiteralPath $fixture)) { throw 'Cancel modified the installation or data.' }

  $window = Start-Uninstaller
  $box = Find-Control $window '同时删除应用数据'
  $handle = [IntPtr]$box.Current.NativeWindowHandle
  $null = [InstallerWindow]::SendMessage($handle, 0x00F1, [IntPtr]1, [IntPtr]::Zero)
  if ([InstallerWindow]::SendMessage($handle, 0x00F0, [IntPtr]::Zero, [IntPtr]::Zero) -ne [IntPtr]1) { throw 'Could not select the test checkbox.' }
  Capture $window '03-uninstall-opt-in'
  Invoke-Control (Find-Control $window '卸载')
  $desktop = $u::RootElement
  $message = $null
  for ($i=0; $i -lt 30 -and !$message; $i++) {
    Start-Sleep -Milliseconds 250
    $dialogs = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
      (New-Object System.Windows.Automation.PropertyCondition($u::ProcessIdProperty, $script:ActiveProcess.Id)))
    foreach ($d in $dialogs) {
      $candidate = Find-Named $d '将永久删除本机的工资、排班、提成、暂停、满勤、激励目标和应用偏好。确定继续吗？'
      if ($candidate) { $message = $d; break }
    }
  }
  if (!$message) { throw 'Missing explicit data deletion confirmation.' }
  Capture $message '03b-uninstall-delete-warning'
  # The system message box uses the runner's language, so locate the IDYES button by its ID.
  $yesCondition = New-Object System.Windows.Automation.PropertyCondition($u::AutomationIdProperty, '6')
  $yes = $message.FindFirst($scope, $yesCondition)
  if (!$yes) { throw 'Could not identify the affirmative system button.' }
  Invoke-Control $yes
  Finish-Uninstaller $window
  if ((Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $fixture)) { throw 'Confirmed opt-in uninstall did not remove fixture and executable.' }
  'Native Windows installer/uninstaller localization, cancel and opt-in passed.' | Set-Content -Encoding UTF8 (Join-Path $evidence 'result.txt')
} catch {
  $_ | Out-String | Set-Content -Encoding UTF8 (Join-Path $evidence 'result.txt')
  throw
} finally {
  if ($script:ActiveProcess -and !$script:ActiveProcess.HasExited) {
    Stop-Process -Id $script:ActiveProcess.Id -ErrorAction SilentlyContinue
  }
}
