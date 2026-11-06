param([Parameter(Mandatory)][string]$Installer,[Parameter(Mandatory)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable runner required' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing,System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeQA {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int L,T,R,B;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int z,uint f);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int index);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
}
'@
$evidence=(New-Item -ItemType Directory -Force $EvidenceDir).FullName
$installer=(Resolve-Path $Installer).Path
$install=Join-Path $env:RUNNER_TEMP 'ShangBan-Published'
$exe=Join-Path $install 'shang-ban-gu-li-qi.exe'
$db=Join-Path $env:LOCALAPPDATA 'com.shangbanguliqi.desktop/earnings.sqlite3'
$u=[System.Windows.Automation.AutomationElement]
$scope=[System.Windows.Automation.TreeScope]::Descendants
$script:app=$null
$script:root=$null
$results=New-Object System.Collections.Generic.List[object]
function Profile([string]$action,[string]$value='') {
 $output=& node tests/published-profile.mjs "$db" $action $value
 if ($LASTEXITCODE -ne 0) { throw "SQLite fixture operation failed: $action" }
 if ($action -eq 'read') { return ($output | ConvertFrom-Json) }
}
function Start-App {
 $script:app=Start-Process -FilePath $exe -PassThru
 for($i=0;$i -lt 60;$i++) {
  Start-Sleep -Milliseconds 150
  $script:app.Refresh()
  if($script:app.HasExited) {throw 'App exited at startup'}
  if($script:app.MainWindowHandle -ne 0) {break}
 }
 if($script:app.MainWindowHandle -eq 0) {throw 'No native app window'}
 for($i=0;$i -lt 120;$i++) {
  $script:app.Refresh()
  if($script:app.HasExited){throw 'App exited before database initialization'}
  $ready=& node tests/published-profile.mjs "$db" ready
  if($ready -eq 'ready'){break}
  Start-Sleep -Milliseconds 500
 }
 if($ready -ne 'ready'){throw 'The installed EXE did not initialize its database within 60 seconds'}
 $script:root=$u::FromHandle($script:app.MainWindowHandle)
 $null=[NativeQA]::SetForegroundWindow($script:app.MainWindowHandle)
}
function Stop-App {
 if($script:app -and !$script:app.HasExited) {
  Stop-Process -Id $script:app.Id
  $null=$script:app.WaitForExit(5000)
 }
}
function Find-UI([string]$pattern,[string]$kind='', [bool]$optional=$false) {
 for($i=0;$i -lt 35;$i++) {
  $all=$script:root.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)
  foreach($node in $all) {
   if($node.Current.Name -match $pattern -and (!$kind -or $node.Current.ControlType.ProgrammaticName -eq "ControlType.$kind")) {return $node}
  }
  if($optional) {return $null}
  Start-Sleep -Milliseconds 100
 }
 throw "Native control missing: $pattern ($kind)"
}
function Open-UI([string]$pattern,[string]$kind='Button') {
 $node=Find-UI $pattern $kind
 try {$node.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()}catch{}
 $pat=$null
 if($node.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pat)) {$pat.Invoke()}
 elseif($node.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pat)) {$pat.Expand()}
 else {$node.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction()}
 Start-Sleep -Milliseconds 120
}
function Input-UI([string]$name,[string]$value) {
 $node=Find-UI ("^"+[regex]::Escape($name)+"$") 'Edit'
 $null=[NativeQA]::SetForegroundWindow($script:app.MainWindowHandle)
 $node.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait('^a')
 [System.Windows.Forms.SendKeys]::SendWait($value)
 Start-Sleep -Milliseconds 100
}
function Capture([string]$name) {
 Start-Sleep -Milliseconds 250
 $h=$script:app.MainWindowHandle
 $null=[NativeQA]::SetForegroundWindow($h)
 $r=New-Object NativeQA+Rect
 if(![NativeQA]::GetWindowRect($h,[ref]$r)) {throw 'No screenshot bounds'}
 $bitmap=New-Object System.Drawing.Bitmap(($r.R-$r.L),($r.B-$r.T))
 $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
 try {
  $dc=$graphics.GetHdc()
  try {$ok=[NativeQA]::PrintWindow($h,$dc,2)}finally{$graphics.ReleaseHdc($dc)}
  if(!$ok) {throw 'Native screenshot failed'}
  $bitmap.Save((Join-Path $evidence "$name.png"),[System.Drawing.Imaging.ImageFormat]::Png)
 } finally {$graphics.Dispose();$bitmap.Dispose()}
 $all=$script:root.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)
 @($all | ForEach-Object {$_.Current.ControlType.ProgrammaticName+' | '+$_.Current.Name}) |
  Set-Content -Encoding UTF8 (Join-Path $evidence "$name-uia.txt")
}
function Case([string]$name,[scriptblock]$run) {
 try {
  & $run
  $results.Add(@{item=$name;status='通过'})
 }catch{
  $results.Add(@{item=$name;status='未通过';error=$_.Exception.Message})
  try{Capture ("failure-"+($results.Count))}catch{}
  $_ | Out-String | Write-Output
 }
 $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $evidence 'results.json')
}
function Save-Panel {Open-UI '^保存修改$';$null=Find-UI '^设置$' 'Text'}
function Open-Income {Open-UI '^工资与发薪'}
function Set-Time([string]$label,[string]$hour,[string]$minute='0') {
 Open-UI ("^"+$label+" ")
 $node=Find-UI '^时$' 'Spinner'
 $node.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
 if([int]$hour -gt 0){[System.Windows.Forms.SendKeys]::SendWait("{DOWN $hour}")}
 $node=Find-UI '^分$' 'Spinner'
 $node.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
 if([int]$minute -gt 0){[System.Windows.Forms.SendKeys]::SendWait("{DOWN $minute}")}
 Open-UI '^确认$'
}
try {
 if(Test-Path $db) {throw 'Expected a new disposable app profile'}
 $p=Start-Process $installer -ArgumentList '/S',"/D=$install" -Wait -PassThru
 if($p.ExitCode -ne 0 -or !(Test-Path $exe)) {throw 'Public EXE installation failed'}
 Start-App
 Case '首次引导' {
  $node=Find-UI '^每月税后工资（元）$' 'Edit'
  if($node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -ne ''){throw 'Initial salary was not blank'}
  Capture '01-first-launch'
  Input-UI '每月税后工资（元）' '500'
  Open-UI '^继续$';Open-UI '^继续$';Open-UI '^开始使用$'
  $null=Find-UI '^设置$' 'Button'
 }
 Stop-App
 Profile 'base'
 Start-App
 Case '五个设置入口与二级页' {
  Open-UI '^设置$'
  foreach($name in @('工资与发薪','作息安排','激励目标','启动与驻留','数据与工具')) {$null=Find-UI ("^"+$name) 'Button'}
  if(Find-UI '^税后月薪（元）$' 'Edit' $true) {throw 'Income form was present in settings root'}
  if(Find-UI '^窗口置顶$' '' $true) {throw 'Duplicate pin setting'}
  Capture '02-settings-hub'
  Open-UI '^启动与驻留';Capture '03-startup';Open-UI '^返回$'
  Open-UI '^数据与工具';Capture '04-data';Open-UI '^返回$'
 }
 Case '工资满勤与发薪保存和取消' {
  Open-Income
  Input-UI '税后月薪（元）' '6000'
  Input-UI '满勤奖金（元）' '500'
  Open-UI '^每个月 10 日$'
  $node=Find-UI '^日$' 'Spinner';$node.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{DOWN 2}')
  Open-UI '^确认$'
  Capture '05-income-edited'
  Save-Panel
  $saved=Profile 'read'
  if($saved.settings.salaryCents -ne 600000 -or $saved.settings.attendanceCents -ne 50000 -or $saved.settings.payday -ne 12){throw 'SQLite does not match income fields'}
  Open-Income;Input-UI '税后月薪（元）' '7000';Open-UI '^取消$'
  if((Profile 'read').settings.salaryCents -ne 600000){throw 'Cancel wrote salary'}
 }
 Case '保存失败留在二级页' {
  Open-Income;Input-UI '税后月薪（元）' '6500'
  Profile 'fail-on'
  try {
   Open-UI '^保存修改$'
   $null=Find-UI '无法保存本地数据'
   Capture '06-save-failure'
   if((Profile 'read').settings.salaryCents -ne 600000){throw 'Failed write changed the profile'}
  }finally{Profile 'fail-off'}
  Open-UI '^取消$'
 }
 Case '作息保存' {
  Open-UI '^作息安排'
  Set-Time '上班' '8';Set-Time '下班' '19';Set-Time '午休结束' '14'
  Capture '07-schedule'
  Save-Panel
  $saved=Profile 'read'
  if($saved.settings.shiftStart -ne '08:00' -or $saved.settings.shiftEnd -ne '19:00' -or $saved.settings.lunchEnd -ne '14:00'){throw 'SQLite did not retain schedule'}
 }
 Case '30项原生目标清单' {
  Open-UI '^激励目标'
  $catalog=(Get-Content data/motivations.json -Raw -Encoding UTF8 | ConvertFrom-Json).targets
  if($catalog.Count -ne 30 -or @($catalog|Where-Object category -eq 'alcohol').Count -ne 7){throw 'Expected 30 defaults and 7 alcohol items'}
  foreach($goal in $catalog){$null=Find-UI ("^编辑 "+[regex]::Escape($goal.name)+"$") 'Button';$null=Find-UI ("^移除 "+[regex]::Escape($goal.name)+"$") 'Button'}
  Capture '08-goals-top'
 }
 Case '目标添加编辑移除恢复' {
  Open-UI '^添加目标$';Input-UI '目标名称' 'QA New Goal';Input-UI '价格（元）' '80.01';Open-UI '^保存$'
  if(@((Profile 'read').customGoals|Where-Object name -eq 'QA New Goal').Count -ne 1){throw 'Custom goal was not saved'}
  Open-UI '^移除 QA New Goal$';Open-UI '^确认移除$'
  if(@((Profile 'read').customGoals|Where-Object name -eq 'QA New Goal').Count -ne 0){throw 'Custom goal was not removed'}
  Open-UI '^编辑 一瓶青岛绿瓶啤酒$'
  Input-UI '目标名称' 'QA Edited';Input-UI '价格（元）' '9.99';Open-UI '^保存$'
  Open-UI '^移除 QA Edited$';Open-UI '^确认移除$'
  if((Profile 'read').hiddenBuiltInGoalIds -notcontains 'builtin:tsingtao_green_bottle'){throw 'Built-in removal was not saved'}
  Open-UI '^已移除目标' ''
  Capture '09-removed-goal'
  Open-UI '^恢复$'
  if((Profile 'read').hiddenBuiltInGoalIds -contains 'builtin:tsingtao_green_bottle'){throw 'Built-in restore was not saved'}
  Open-UI '^返回$';Open-UI '^返回$'
 }
 Case '退出重启与覆盖安装保留设置' {
  Stop-App
  $before=Profile 'read' | ConvertTo-Json -Depth 12 -Compress
  $p=Start-Process $installer -ArgumentList '/S',"/D=$install" -Wait -PassThru
  if($p.ExitCode -ne 0){throw 'Reinstall failed'}
  Start-App;Open-UI '^设置$';Open-Income
  Capture '10-restarted-income'
  $after=Profile 'read' | ConvertTo-Json -Depth 12 -Compress
  if($before -ne $after){throw 'Profile changed across restart and reinstall'}
  Open-UI '^返回$';Open-UI '^返回$'
 }
 Case '窗口置顶主题最小化关闭恢复' {
  Open-UI '^置顶窗口$'
  if(([NativeQA]::GetWindowLong($script:app.MainWindowHandle,-20) -band 8) -eq 0){throw 'Native topmost style was not set'}
  Open-UI '^切换到深色主题$'
  if((Profile 'read').theme -ne 'dark'){throw 'Theme was not saved'}
  Open-UI '^最小化$'
  if(![NativeQA]::IsIconic($script:app.MainWindowHandle)){throw 'Window was not minimized'}
  $null=[NativeQA]::ShowWindow($script:app.MainWindowHandle,9)
  Open-UI '^关闭窗口$'
  if($script:app.HasExited -or [NativeQA]::IsWindowVisible($script:app.MainWindowHandle)){throw 'Close did not keep the app hidden in its process'}
  $reopen=Start-Process $exe -PassThru
  Start-Sleep -Seconds 1
  if(![NativeQA]::IsWindowVisible($script:app.MainWindowHandle)){throw 'Single-instance relaunch did not restore the window'}
  Capture '11-window-restored'
 }
 Stop-App
 Case '旧目标升级兼容' {
  Profile 'upgrade';Start-App;Open-UI '^设置$';Open-UI '^激励目标'
  $null=Find-UI '^编辑 QA Legacy Goal$' 'Button';$null=Find-UI '^编辑 QA Custom$' 'Button'
  Capture '12-legacy-goals'
  $saved=Profile 'read'
  if($saved.customGoals[0].priceCents -ne 8001 -or $saved.builtInGoalOverrides.'builtin:breakfast'.priceCents -ne 3025){throw 'Legacy overrides changed'}
  Stop-App
 }
 Case '五组金额和三种窗口宽度' {
  foreach($value in @('0.6039','47.6190','159.4443','999.9999','1000.0000')) {
   Profile 'amount' $value
   Start-App
   $pieces=$value.Split('.')
   $whole='¥'+([int]$pieces[0]).ToString('N0')
   $null=Find-UI ("^"+[regex]::Escape($whole)+"$")
   $null=Find-UI ("^"+$pieces[1]+"$")
   foreach($width in @(400,448,560)){
    $dpi=[NativeQA]::GetDpiForWindow($script:app.MainWindowHandle)/96.0
    $null=[NativeQA]::SetWindowPos($script:app.MainWindowHandle,[IntPtr]::Zero,120,80,[int]($width*$dpi),[int](650*$dpi),0x0004)
    Capture ("amount-"+$value+"-"+$width)
   }
   Stop-App
  }
 }
 Profile 'check'
}finally{
 Stop-App
 $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $evidence 'results.json')
}
if(@($results|Where-Object status -eq '未通过').Count -gt 0){exit 1}
