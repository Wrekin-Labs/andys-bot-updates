#Requires -RunAsAdministrator
<#
Enables only Windows Sandbox and its required Windows components.
Never restarts Windows or stops applications.
Run locally after reviewing the administrator (UAC) prompt.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$statusPath = Join-Path $PSScriptRoot 'sandbox-feature-status.json'
$logPath = Join-Path $PSScriptRoot 'sandbox-feature-dism.log'
function Save-Status([string]$Phase, [string]$State, [bool]$RestartNeeded, [string]$Message) {
    $status = [ordered]@{
        phase = $Phase
        feature = 'Containers-DisposableClientVM'
        state = $State
        restart_needed = $RestartNeeded
        message = $Message
        updated_at = (Get-Date).ToUniversalTime().ToString('o')
    }
    $json = $status | ConvertTo-Json
    [System.IO.File]::WriteAllText($statusPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}
try {
    Save-Status 'checking' '' $false 'Checking Windows Sandbox. No automatic restart will occur.'
    $feature = Get-WindowsOptionalFeature -Online -FeatureName 'Containers-DisposableClientVM'
    $restartNeeded = $feature.State -eq 'EnablePending'
    if ($feature.State -notin @('Enabled', 'EnablePending')) {
        Save-Status 'enabling' ([string]$feature.State) $false 'Enabling Windows Sandbox with -NoRestart.'
        $result = Enable-WindowsOptionalFeature -Online -FeatureName 'Containers-DisposableClientVM' -All -NoRestart -LogPath $logPath
        $restartNeeded = [bool]$result.RestartNeeded
        $feature = Get-WindowsOptionalFeature -Online -FeatureName 'Containers-DisposableClientVM'
    }
    $restartNeeded = $restartNeeded -or $feature.State -eq 'EnablePending'
    Save-Status 'complete' ([string]$feature.State) $restartNeeded 'Feature setup finished. No restart was requested by this script.'
    Write-Host "Windows Sandbox state: $($feature.State)"
    if ($restartNeeded) {
        Write-Host 'A restart is needed. Leave the trading bot running until you choose a suitable restart time.'
    } else {
        Write-Host 'Windows did not request a restart.'
    }
}
catch {
    Save-Status 'failed' '' $false $_.Exception.Message
    Write-Error $_.Exception.Message
    exit 1
}
