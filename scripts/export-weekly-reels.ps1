# Generate several ready-to-post Reels (no audio) into D:\communication\reels-instagram.
# Run 1-2x per week: post one file, keep the rest for later.
param(
    [string]$CommunicationDir = "D:\communication"
)

$ErrorActionPreference = "Stop"
$build = Join-Path $PSScriptRoot "build-instagram-reel.ps1"
if (-not (Test-Path $build)) { throw "Manquant : $build" }

if (-not (Test-Path -LiteralPath $CommunicationDir)) {
    throw "Dossier introuvable : $CommunicationDir"
}

function Get-VideoCount {
    param([string]$Dir)
    (Get-ChildItem -LiteralPath $Dir -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.(mp4|mov|m4v)$' }).Count
}

$n = Get-VideoCount -Dir $CommunicationDir
if ($n -lt 1) { throw "Aucune video sous $CommunicationDir" }

Write-Host "Videos trouvees : $n"

$outRoot = Join-Path $CommunicationDir "reels-instagram"
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null

$half = [Math]::Max(0, [int][Math]::Floor($n / 2) - 2)
$tail = [Math]::Max(0, $n - 5)

$recipes = @(
    @{ OutputName = "sabine-reel-01-court-20s.mp4"; StartClipIndex = 0; MaxClips = 4; ClipDurationSec = 5; SkipStartFirstClipSec = 1 },
    @{ OutputName = "sabine-reel-02-standard-30s.mp4"; StartClipIndex = 0; MaxClips = 5; ClipDurationSec = 6; SkipStartFirstClipSec = 1 },
    @{ OutputName = "sabine-reel-03-variation-24s.mp4"; StartClipIndex = 2; MaxClips = 4; ClipDurationSec = 6; SkipStartFirstClipSec = 0 },
    @{ OutputName = "sabine-reel-04-mix-25s.mp4"; StartClipIndex = 1; MaxClips = 5; ClipDurationSec = 5; SkipStartFirstClipSec = 0 },
    @{ OutputName = "sabine-reel-05-milieu-24s.mp4"; StartClipIndex = $half; MaxClips = 4; ClipDurationSec = 6; SkipStartFirstClipSec = 1 },
    @{ OutputName = "sabine-reel-06-fin-parcours-24s.mp4"; StartClipIndex = $tail; MaxClips = 4; ClipDurationSec = 6; SkipStartFirstClipSec = 0 }
)

foreach ($r in $recipes) {
    Write-Host ""
    Write-Host "=== $($r.OutputName) ===" -ForegroundColor Cyan
    & $build `
        -CommunicationDir $CommunicationDir `
        -OutputDir $outRoot `
        -OutputName $r.OutputName `
        -StartClipIndex $r.StartClipIndex `
        -MaxClips $r.MaxClips `
        -ClipDurationSec $r.ClipDurationSec `
        -SkipStartFirstClipSec $r.SkipStartFirstClipSec
}

Write-Host ""
Write-Host "Termine. Fichiers dans : $outRoot" -ForegroundColor Green
