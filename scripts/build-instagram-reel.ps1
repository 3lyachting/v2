# Build a vertical 9:16 MP4 from drone clips for Instagram Reels.
# Default media root: D:\communication. Audio stripped - add music in Instagram.
# Default output: D:\communication\reels-instagram (never your web server / repo).
param(
    [string]$CommunicationDir = "D:\communication",
    [string]$OutputName = "sabine-reel-9x16-brouillon-01.mp4",
    [string]$OutputDir = "",
    [int]$StartClipIndex = 0,
    [int]$MaxClips = 6,
    [double]$ClipDurationSec = 6,
    [double]$SkipStartFirstClipSec = 1
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $root "client"))) {
    throw "Dossier client introuvable depuis $PSScriptRoot"
}

$fallbackPhotos = Join-Path $root "client\public\photos site"

function Find-FFmpeg {
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $pkgRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $found = Get-ChildItem -Path $pkgRoot -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "ffmpeg-.*full_build\\bin\\ffmpeg\.exe$" } |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "ffmpeg introuvable. Installez-le : winget install Gyan.FFmpeg -e"
}

function Get-CommunicationVideos {
    param([string]$Dir)
    if (-not (Test-Path $Dir)) { return @() }
    Get-ChildItem -LiteralPath $Dir -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.(mp4|mov|m4v)$' } |
        Sort-Object { $_.FullName } |
        Select-Object -ExpandProperty FullName
}

function Resolve-DefaultOutputDir {
    param([string]$CommDir, [string]$Explicit, [bool]$UsedProjectFallback)
    if ($Explicit) { return $Explicit }
    if (Test-Path -LiteralPath $CommDir) {
        return (Join-Path $CommDir "reels-instagram")
    }
    if ($UsedProjectFallback) {
        $v = Join-Path $env:USERPROFILE "Videos\Sabine-reels-instagram"
        return $v
    }
    return (Join-Path $root "reels-export")
}

$ff = Find-FFmpeg
$sourceDir = $null
$videos = @()
$usedFallback = $false

if (Test-Path -LiteralPath $CommunicationDir) {
    $sourceDir = $CommunicationDir
    $videos = @(Get-CommunicationVideos -Dir $CommunicationDir)
}

if ($videos.Count -eq 0) {
    Write-Host "Dossier absent ou sans video : $CommunicationDir"
    Write-Host "Repli sur : $fallbackPhotos"
    $sourceDir = $fallbackPhotos
    $usedFallback = $true
    if (-not (Test-Path -LiteralPath $fallbackPhotos)) {
        throw "Aucune source video : creez $CommunicationDir avec des .mp4/.mov ou gardez des rushs dans client\public\photos site"
    }
    $videos = @(Get-CommunicationVideos -Dir $fallbackPhotos)
}

if ($videos.Count -eq 0) {
    throw "Aucun fichier .mp4 / .mov trouve sous : $sourceDir"
}

$start = [Math]::Max(0, $StartClipIndex)
$clips = @($videos | Select-Object -Skip $start -First $MaxClips)
if ($clips.Count -eq 0) {
    $clips = @($videos | Select-Object -First $MaxClips)
    Write-Host "StartClipIndex hors plage, repli sur les premiers clips."
}

$outDir = Resolve-DefaultOutputDir -CommDir $CommunicationDir -Explicit $OutputDir -UsedProjectFallback $usedFallback
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir $OutputName

Write-Host "Source : $sourceDir ($($clips.Count) clip(s), ~$([math]::Round($ClipDurationSec * $clips.Count, 1))s cible)"
$clips | ForEach-Object { Write-Host "  - $_" }

$cropScale = "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos,fps=30,format=yuv420p,setsar=1"
$trimDur = ($ClipDurationSec -replace ',', '.') -as [string]

$filterParts = [System.Collections.Generic.List[string]]::new()
$labels = [System.Collections.Generic.List[string]]::new()

for ($i = 0; $i -lt $clips.Count; $i++) {
    $label = "vc$i"
    if ($i -eq 0 -and $SkipStartFirstClipSec -gt 0) {
        $skip = ($SkipStartFirstClipSec -replace ',', '.') -as [string]
        $filterParts.Add("[$($i):v]trim=start=$skip`:duration=$trimDur,setpts=PTS-STARTPTS,$cropScale[$label]")
    }
    else {
        $filterParts.Add("[$($i):v]trim=start=0:duration=$trimDur,setpts=PTS-STARTPTS,$cropScale[$label]")
    }
    $labels.Add("[$label]")
}

$concatIn = $labels -join ""
$n = $clips.Count
$filterParts.Add("${concatIn}concat=n=${n}:v=1:a=0[outv]")
$filterComplex = ($filterParts -join ";")

$args = @("-y", "-hide_banner", "-loglevel", "warning")
foreach ($c in $clips) {
    $args += "-fflags"
    $args += "+genpts"
    $args += "-err_detect"
    $args += "ignore_err"
    $args += "-i"
    $args += $c
}
$args += @("-filter_complex", $filterComplex, "-map", "[outv]", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", $out)

Write-Host "ffmpeg: $ff"
Write-Host "Sortie : $out"

& $ff @args
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg a echoue (code $LASTEXITCODE) pour : $out"
}

Write-Host "OK - $out"
