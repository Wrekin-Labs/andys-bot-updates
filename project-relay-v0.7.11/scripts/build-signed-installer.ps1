param(
    [string]$OutputDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "dist"),
    [string]$CertificateThumbprint = $env:PROJECT_RELAY_SIGNING_THUMBPRINT,
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$source = @'
using System;
using System.Diagnostics;
using System.IO;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        string baseDir = AppContext.BaseDirectory;
        string script = Path.Combine(baseDir, "scripts", "install-customer.ps1");
        if (!File.Exists(script))
        {
            Console.Error.WriteLine("Project Relay installer files are incomplete.");
            return 2;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"",
            WorkingDirectory = baseDir,
            UseShellExecute = true
        };

        using (var process = Process.Start(psi))
        {
            if (process == null) return 3;
            process.WaitForExit();
            return process.ExitCode;
        }
    }
}
'@

$out = Join-Path $OutputDir "ProjectRelayInstaller.exe"
if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $out -OutputType ConsoleApplication
if (-not (Test-Path $out)) { throw "Installer launcher build failed." }

if ($CertificateThumbprint) {
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if (-not $signtool) {
        $kits = @(
            "$env:ProgramFiles(x86)\Windows Kits\10\bin",
            "$env:ProgramFiles\Windows Kits\10\bin"
        )
        $candidate = Get-ChildItem $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
        if ($candidate) { $signtool = $candidate }
    }
    if (-not $signtool) { throw "signtool.exe was not found. Install the Windows SDK signing tools." }

    & $signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $out
    if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed." }

    & $signtool verify /pa /v $out
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed." }
    Write-Host "Signed installer: $out"
} else {
    Write-Warning "PROJECT_RELAY_SIGNING_THUMBPRINT is not set. Built an unsigned installer for QA only."
    Write-Host "Unsigned installer: $out"
}

Get-FileHash $out -Algorithm SHA256 | Format-List Path,Hash
