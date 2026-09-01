param(
  [string]$Source = (Join-Path $PSScriptRoot "..\pentablocks_logo_v2.png")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourcePath = [System.IO.Path]::GetFullPath($Source)

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Logo source was not found: $sourcePath"
}

function Get-VisibleBounds {
  param([System.Drawing.Bitmap]$Bitmap)

  $minX = $Bitmap.Width
  $minY = $Bitmap.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $Bitmap.Height; $y++) {
    for ($x = 0; $x -lt $Bitmap.Width; $x++) {
      if ($Bitmap.GetPixel($x, $y).A -le 5) {
        continue
      }

      $minX = [Math]::Min($minX, $x)
      $minY = [Math]::Min($minY, $y)
      $maxX = [Math]::Max($maxX, $x)
      $maxY = [Math]::Max($maxY, $y)
    }
  }

  if ($maxX -lt $minX -or $maxY -lt $minY) {
    throw "The source logo has no visible pixels."
  }

  return [System.Drawing.Rectangle]::FromLTRB($minX, $minY, $maxX + 1, $maxY + 1)
}

function Export-LogoAsset {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [System.Drawing.Rectangle]$VisibleBounds,
    [string]$Destination,
    [int]$Size,
    [double]$ContentScale,
    [System.Drawing.Color]$Background = [System.Drawing.Color]::Transparent
  )

  $destinationPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Destination))
  $destinationDirectory = [System.IO.Path]::GetDirectoryName($destinationPath)
  [System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null

  $canvas = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)

  try {
    $graphics.Clear($Background)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $maxContent = [Math]::Floor($Size * $ContentScale)
    $ratio = [Math]::Min($maxContent / $VisibleBounds.Width, $maxContent / $VisibleBounds.Height)
    $drawWidth = [Math]::Round($VisibleBounds.Width * $ratio)
    $drawHeight = [Math]::Round($VisibleBounds.Height * $ratio)
    $drawX = [Math]::Round(($Size - $drawWidth) / 2)
    $drawY = [Math]::Round(($Size - $drawHeight) / 2)
    $destinationRect = New-Object System.Drawing.Rectangle($drawX, $drawY, $drawWidth, $drawHeight)

    $graphics.DrawImage(
      $Bitmap,
      $destinationRect,
      $VisibleBounds.X,
      $VisibleBounds.Y,
      $VisibleBounds.Width,
      $VisibleBounds.Height,
      [System.Drawing.GraphicsUnit]::Pixel
    )

    $canvas.Save($destinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $canvas.Dispose()
  }
}

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($sourcePath)

try {
  $visibleBounds = Get-VisibleBounds -Bitmap $sourceBitmap
  $navy = [System.Drawing.Color]::FromArgb(255, 5, 13, 27)

  # Brand assets keep transparency; platform icons receive safe padding.
  Export-LogoAsset $sourceBitmap $visibleBounds "public\pentablocks-logo.png" 768 0.92
  Export-LogoAsset $sourceBitmap $visibleBounds "public\icon-512.png" 512 0.78 $navy
  Export-LogoAsset $sourceBitmap $visibleBounds "public\icon-maskable-512.png" 512 0.60 $navy
  Export-LogoAsset $sourceBitmap $visibleBounds "mobile\assets\pentablocks-logo.png" 768 0.92
  Export-LogoAsset $sourceBitmap $visibleBounds "mobile\assets\icon.png" 1024 0.78 $navy
  Export-LogoAsset $sourceBitmap $visibleBounds "mobile\assets\adaptive-icon.png" 1024 0.58
  Export-LogoAsset $sourceBitmap $visibleBounds "mobile\assets\splash-icon.png" 1024 0.48
  Export-LogoAsset $sourceBitmap $visibleBounds "mobile\assets\favicon.png" 256 0.78 $navy
}
finally {
  $sourceBitmap.Dispose()
}

Write-Host "PentaBlocks logo assets generated from $sourcePath"
