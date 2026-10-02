$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$python = $null
try {
    $candidate = (& py -3.12 -c "import sys; print(sys.executable)" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $candidate) { $python = $candidate.Trim() }
} catch {}

if (-not $python) {
    $cadbridgePython = "C:\CADBridge\cadbridge-ai-v1.0.0rc2\.conda\python.exe"
    if (Test-Path $cadbridgePython) { $python = $cadbridgePython }
}

if (-not $python) {
    throw "Python 3.12 was not found. Install Python 3.12 or point the installer at a Python 3.12 executable."
}

Write-Host "Using Python: $python"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    & $python -m venv .venv
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
& .\.venv\Scripts\python.exe -m pytest -q
Write-Host "Project Relay v0.3.5 installed. No physical device action was enabled."
