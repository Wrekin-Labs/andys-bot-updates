$ErrorActionPreference = "Stop"
$taskNames = @(
    "Project Relay Cloud Agent",
    "Project Relay Cloud Watchdog",
    "Project Relay MCP Watchdog"
)

foreach ($taskName in $taskNames) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed scheduled task: $taskName"
    } else {
        Write-Host "Scheduled task not installed: $taskName"
    }
}
