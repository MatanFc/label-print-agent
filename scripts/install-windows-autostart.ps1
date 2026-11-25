# Starts the agent hidden at every logon of the current user, logging to agent.log in the project folder.
#   Install:   powershell -ExecutionPolicy Bypass -File scripts\install-windows-autostart.ps1
#   Uninstall: powershell -ExecutionPolicy Bypass -File scripts\install-windows-autostart.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$taskName = 'LabelPrintAgent'

if ($Uninstall) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -like '*src\server.js*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Host "Removed scheduled task $taskName and stopped the agent."
    return
}

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root '.env'))) {
    throw "Create $root\.env from .env.example first."
}
$node = (Get-Command node.exe).Source

$command = "Set-Location -LiteralPath '$root'; & '$node' --env-file=.env src\server.js *>> agent.log"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Label print agent (website -> label printer)' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed $taskName. It starts at logon; it is starting now."
Write-Host "Open http://127.0.0.1:<PORT>/ to check it. Log: $root\agent.log"
