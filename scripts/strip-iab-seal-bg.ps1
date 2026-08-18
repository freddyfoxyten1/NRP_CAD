Add-Type -AssemblyName System.Drawing

$publicDir = Join-Path $PSScriptRoot '..\artifacts\dojrp\public'
$src = Join-Path $publicDir 'iab-seal.src.png'
$out = Join-Path $publicDir 'iab-seal.png'
$tmp = Join-Path $publicDir 'iab-seal.tmp.png'
$target = 597

$orig = [System.Drawing.Bitmap]::FromFile($src)
$bmp = New-Object System.Drawing.Bitmap $orig.Width, $orig.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($orig, 0, 0)
$g.Dispose()
$orig.Dispose()

$cx = $bmp.Width / 2.0
$cy = $bmp.Height / 2.0
$radius = [Math]::Min($bmp.Width, $bmp.Height) / 2.0 * 0.998

$minX = $bmp.Width
$minY = $bmp.Height
$maxX = 0
$maxY = 0

for ($y = 0; $y -lt $bmp.Height; $y++) {
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $c = $bmp.GetPixel($x, $y)
    $dx = $x - $cx
    $dy = $y - $cy
    $dist = [Math]::Sqrt($dx * $dx + $dy * $dy)
    if ($dist -gt $radius -or ($c.R -lt 45 -and $c.G -lt 45 -and $c.B -lt 45)) {
      $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
      continue
    }
    if ($c.A -gt 10) {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}

$cropW = $maxX - $minX + 1
$cropH = $maxY - $minY + 1
$side = [Math]::Max($cropW, $cropH)
$padX = [Math]::Floor(($side - $cropW) / 2)
$padY = [Math]::Floor(($side - $cropH) / 2)

$cropped = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$cg = [System.Drawing.Graphics]::FromImage($cropped)
$cg.Clear([System.Drawing.Color]::Transparent)
$cg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$cg.DrawImage($bmp, (0 - $minX + $padX), (0 - $minY + $padY))
$cg.Dispose()
$bmp.Dispose()

$scaleSide = [Math]::Max($side, $target)
$final = New-Object System.Drawing.Bitmap $scaleSide, $scaleSide, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$fg = [System.Drawing.Graphics]::FromImage($final)
$fg.Clear([System.Drawing.Color]::Transparent)
$fg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$fg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$fg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$fg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$fg.DrawImage($cropped, 0, 0, $scaleSide, $scaleSide)
$fg.Dispose()
$cropped.Dispose()

if ($scaleSide -ne $target) {
  $outBmp = New-Object System.Drawing.Bitmap $target, $target, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($outBmp)
  $og.Clear([System.Drawing.Color]::Transparent)
  $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $og.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $og.DrawImage($final, 0, 0, $target, $target)
  $og.Dispose()
  $final.Dispose()
  $final = $outBmp
}

$final.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$final.Dispose()
Move-Item -Force $tmp $out
Write-Output "done ${target}x${target}"
