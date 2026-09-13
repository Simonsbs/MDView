Add-Type -AssemblyName System.Drawing
$assetDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets'))
[IO.Directory]::CreateDirectory($assetDirectory) | Out-Null
$bitmap = [Drawing.Bitmap]::new(256, 256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$background = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#35675b'))
$paper = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#fafaf8'))
$fold = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#afc9be'))
$rounded = [Drawing.Drawing2D.GraphicsPath]::new()
$rounded.AddArc(4, 4, 60, 60, 180, 90)
$rounded.AddArc(192, 4, 60, 60, 270, 90)
$rounded.AddArc(192, 192, 60, 60, 0, 90)
$rounded.AddArc(4, 192, 60, 60, 90, 90)
$rounded.CloseFigure()
$graphics.FillPath($background, $rounded)
$points = [Drawing.Point[]]@(
  [Drawing.Point]::new(65, 40), [Drawing.Point]::new(151, 40),
  [Drawing.Point]::new(193, 82), [Drawing.Point]::new(193, 214),
  [Drawing.Point]::new(65, 214)
)
$graphics.FillPolygon($paper, $points)
$graphics.FillPolygon($fold, [Drawing.Point[]]@(
  [Drawing.Point]::new(151, 40), [Drawing.Point]::new(151, 82), [Drawing.Point]::new(193, 82)
))
$font = [Drawing.Font]::new('Consolas', 51, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
$graphics.DrawString('M', $font, $background, [Drawing.PointF]::new(77, 109))
$pen = [Drawing.Pen]::new($background.Color, 7)
$pen.StartCap = [Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($pen, 148, 119, 148, 157)
$graphics.DrawLines($pen, [Drawing.Point[]]@(
  [Drawing.Point]::new(138, 148), [Drawing.Point]::new(148, 158), [Drawing.Point]::new(158, 148)
))
$graphics.DrawLine($pen, 87, 181, 170, 181)
$pngPath = Join-Path $assetDirectory 'icon.png'
$bitmap.Save($pngPath, [Drawing.Imaging.ImageFormat]::Png)
$png = [IO.File]::ReadAllBytes($pngPath)
$stream = [IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
$writer = [IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$png.Length)
$writer.Write([uint32]22)
$writer.Write($png)
$writer.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$rounded.Dispose()
$background.Dispose()
$paper.Dispose()
$fold.Dispose()
$font.Dispose()
$pen.Dispose()
Write-Output 'Created assets/icon.png and assets/icon.ico'
