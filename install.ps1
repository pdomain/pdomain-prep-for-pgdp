# pgdp-prep installer (Windows PowerShell)
#
# Usage:
#   irm https://raw.githubusercontent.com/ConcaveTrillion/pd-prep-for-pgdp/main/install.ps1 | iex
#
# Downloads the prebuilt wheel attached to the latest GitHub Release and
# runs `uv tool install` against it. The wheel ships with the React SPA
# already bundled, so end users do NOT need Node, npm, or a JavaScript
# toolchain — only `uv` (which this script will install for you).

$ErrorActionPreference = "Stop"

$repo = "ConcaveTrillion/pd-prep-for-pgdp"

function Test-Command {
    param([string]$Name)
    return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

# 1. Install uv if missing.
#
# Security (F-017 Option B): download from a pinned, immutable GitHub Release
# asset URL rather than piping https://astral.sh/uv/install.ps1 into
# Invoke-Expression. GitHub Release assets at tagged URLs are immutable once
# published; TLS to github.com provides transport integrity. Upstream
# (astral-sh/uv) does not publish a checksum for the installer script itself
# (sha256.sum covers binary tarballs only), so the pinned-tag approach is the
# pragmatic baseline. To upgrade: update $uvVer below.
$uvVer = "0.11.16"
if (-not (Test-Command -Name "uv")) {
    Write-Host "uv not found — installing uv $uvVer from GitHub Releases..."
    $uvInstallerUrl = "https://github.com/astral-sh/uv/releases/download/$uvVer/uv-installer.ps1"
    $uvInstallerTmp = Join-Path ([System.IO.Path]::GetTempPath()) "uv-installer-$([System.Guid]::NewGuid()).ps1"
    Invoke-WebRequest -Uri $uvInstallerUrl -OutFile $uvInstallerTmp -UseBasicParsing
    try { & powershell -NoProfile -ExecutionPolicy Bypass -File $uvInstallerTmp }
    finally { Remove-Item $uvInstallerTmp -ErrorAction SilentlyContinue }
    $env:Path = "$HOME\.local\bin;" + $env:Path
}

# 2. Detect NVIDIA GPU
$extraIndex = ""
$extras = ""
if (Test-Command -Name "nvidia-smi") {
    try {
        $smiOutput = & nvidia-smi 2>$null | Out-String
        if ($smiOutput -match 'CUDA Version:\s+([0-9]+)\.([0-9]+)') {
            $cudaTag = "cu$($Matches[1])$($Matches[2])"
            $extraIndex = "https://download.pytorch.org/whl/$cudaTag"
            $extras = "[cuda]"
            Write-Host "Detected CUDA $($Matches[1]).$($Matches[2]) — installing with $cudaTag + CuPy."
        }
    } catch {
        Write-Host "nvidia-smi failed — falling back to CPU."
    }
} else {
    Write-Host "No NVIDIA GPU detected — installing CPU-only build."
}

# 3. Resolve latest published release from the GitHub API.
#    `/releases/latest` returns the most recent *published* release
#    (ignoring drafts/prereleases) and embeds asset URLs directly.
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" `
        -Headers @{ Accept = "application/vnd.github+json" }
} catch {
    throw "Could not fetch latest release from https://api.github.com/repos/$repo/releases/latest : $_"
}
if (-not ($release -and $release.tag_name)) {
    throw "Could not resolve the latest release tag from GitHub."
}
$latestTag = $release.tag_name
Write-Host "Installing pgdp-prep $latestTag..."

# 4. Find the wheel asset attached to the GitHub Release for this tag.
$wheelAsset = $null
if ($release.assets) {
    $wheelAsset = $release.assets | Where-Object { $_.name -like "*.whl" } | Select-Object -First 1
}
if (-not $wheelAsset) {
    # Hard-fail rather than fall back to `git+...`. The git+ path requires
    # Node + npm on the user's machine to build the React SPA at install
    # time — exactly the requirement this script is designed to avoid.
    throw @"
No .whl asset attached to release $latestTag.
Expected a wheel uploaded by .github/workflows/release.yml.
Check https://github.com/$repo/releases/tag/$latestTag — the release
workflow may have failed, or this is an older tag from before wheel
publishing was wired up.
"@
}

# 5. Download the wheel to a temp dir and install it as a uv tool.
$tmpDir = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString()))
try {
    $wheelFile = Join-Path $tmpDir.FullName $wheelAsset.name
    Write-Host "Downloading $($wheelAsset.browser_download_url)..."
    Invoke-WebRequest -Uri $wheelAsset.browser_download_url -OutFile $wheelFile -UseBasicParsing

    $installTarget = "$wheelFile$extras"
    if ($extraIndex) {
        & uv tool install --reinstall $installTarget --extra-index-url $extraIndex
    } else {
        & uv tool install --reinstall $installTarget
    }
} finally {
    Remove-Item -Recurse -Force $tmpDir.FullName -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Done! Run: pgdp-prep"
Write-Host "If 'pgdp-prep' is not found, add uv's tool bin to your PATH:"
Write-Host "  `$env:Path = `"`$HOME\.local\bin;`" + `$env:Path"
