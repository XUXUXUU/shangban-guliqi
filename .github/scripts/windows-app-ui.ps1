param(
  [Parameter(Mandatory)][int]$AppPid,
  [Parameter(Mandatory)][string]$EvidenceDir
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This script requires a disposable GitHub runner.' }

try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $u = [System.Windows.Automation.AutomationElement]
  $scope = [System.Windows.Automation.TreeScope]::Descendants
  $app = Get-Process -Id $AppPid
  for ($i = 0; $i -lt 30; $i++) {
    $app.Refresh()
    if ($app.MainWindowHandle -ne 0) { break }
    Start-Sleep -Milliseconds 200
  }
  if ($app.MainWindowHandle -eq 0) { throw 'The installed process has no window accessible to the runner.' }
  $root = $u::FromHandle($app.MainWindowHandle)
  function Find-AppControl([string]$name) {
    $match = New-Object System.Windows.Automation.PropertyCondition($u::NameProperty, $name)
    for ($i = 0; $i -lt 30; $i++) {
      $node = $root.FindFirst($scope, $match)
      if ($node) { return $node }
      Start-Sleep -Milliseconds 150
    }
    throw "UI Automation could not find: $name"
  }
  function Open-Control([string]$name) {
    $control = Find-AppControl $name
    $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  }
  function Read-Input([string]$name) {
    $label = New-Object System.Windows.Automation.PropertyCondition($u::NameProperty, $name)
    $edit = New-Object System.Windows.Automation.PropertyCondition($u::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $condition = New-Object System.Windows.Automation.AndCondition($label, $edit)
    $control = $root.FindFirst($scope, $condition)
    if (!$control) { throw "UI Automation could not find the edit field: $name" }
    return $control.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
  }

  $null = Find-AppControl '取消置顶'
  Open-Control '设置'
  $null = Find-AppControl '上班 08:00'
  $null = Find-AppControl '下班 19:00'
  $null = Find-AppControl '午休结束 14:00'
  if ((Read-Input '税后月薪（元）') -ne '6000.05') { throw 'The window did not display the saved salary.' }
  if ((Read-Input '满勤奖金（元）') -ne '500') { throw 'The window did not display the saved attendance bonus.' }
  Open-Control '激励目标 管理'
  Open-Control '编辑 一份晨间早餐'
  if ((Read-Input '价格（元）') -ne '30.25') { throw 'The goal editor did not display the saved price.' }
  $null = Find-AppControl '恢复默认'
  'Native Windows UI displayed the migrated settings and pin, and opened the saved built-in goal in its editor.' |
    Set-Content -Encoding UTF8 (Join-Path $EvidenceDir 'app-ui-result.txt')
} catch {
  $_ | Out-String | Set-Content -Encoding UTF8 (Join-Path $EvidenceDir 'app-ui-result.txt')
  throw
}
