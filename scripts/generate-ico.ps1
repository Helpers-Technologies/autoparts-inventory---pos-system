$ErrorActionPreference = 'Stop'

# Generate a proper multi-size ICO from PNG.
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePng = Join-Path $repoRoot 'build\icon.png'
$outputIco = Join-Path $repoRoot 'build\icon.ico'

if (-not (Test-Path -LiteralPath $sourcePng)) {
    throw "Source icon was not found: $sourcePng"
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)

$sourceImage = [System.Drawing.Image]::FromFile($sourcePng)

# Create memory streams for each size.
$memStreams = @()
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($sourceImage, 0, 0, $size, $size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $memStreams += $ms
}
$sourceImage.Dispose()

# Build ICO file manually.
# ICO format: 6-byte header + 16-byte entry per image + image data.
$fs = [System.IO.File]::Create($outputIco)
$bw = New-Object System.IO.BinaryWriter($fs)

# Header.
$bw.Write([uint16]0)           # reserved
$bw.Write([uint16]1)           # type: 1 = ICO
$bw.Write([uint16]$sizes.Count) # count

# Calculate data offset: 6 (header) + 16*count (entries).
$dataOffset = 6 + 16 * $sizes.Count

# Write directory entries.
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = $sizes[$i]
    $ms = $memStreams[$i]
    $imgSize = [int]$ms.Length

    # PowerShell doesn't have ternary. Use if/else.
    $w = if ($dim -eq 256) { [byte]0 } else { [byte]$dim }
    $h = if ($dim -eq 256) { [byte]0 } else { [byte]$dim }

    $bw.Write($w)                                # width
    $bw.Write($h)                                # height
    $bw.Write([byte]0)                           # color count
    $bw.Write([byte]0)                           # reserved
    $bw.Write([uint16]1)                         # planes
    $bw.Write([uint16]32)                        # bit count
    $bw.Write([uint32]$imgSize)                  # size of image data
    $bw.Write([uint32]$dataOffset)               # offset of image data
    $dataOffset += $imgSize
}

# Write image data.
foreach ($ms in $memStreams) {
    $bw.Write($ms.ToArray())
    $ms.Dispose()
}

$bw.Close()
$fs.Close()

Write-Host "ICO generated successfully: $outputIco"
Write-Host "Sizes included: $($sizes -join ', ')"
