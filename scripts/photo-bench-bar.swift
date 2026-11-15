// One-off for public/photos/coaching-bench-spot.jpg (Lars asked for the bar highlighted, 2026-11-14).
// Usage: swift scripts/photo-bench-bar.swift "<Photos for Carousels>/misc/gym-bench-spot-03.jpg" <outDir>
// Re-renders the grayed-room bench photo with the whole barbell (bar, sleeves, both plates) in color.
// People: Vision foreground mask on the full frame. Plates: Vision foreground mask on a tight crop around each.
// Bar: a stroked line along the bar's centre. Coordinates are in the 1602x2400 frame, origin top-left.
import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import Vision

let inURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outDir = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)

var image = CIImage(contentsOf: inURL, options: [.applyOrientationProperty: true])!
let s = 2400 / max(image.extent.width, image.extent.height)
let f = CIFilter.lanczosScaleTransform(); f.inputImage = image; f.scale = Float(s); f.aspectRatio = 1
image = f.outputImage!
image = image.transformed(by: CGAffineTransform(translationX: -image.extent.origin.x, y: -image.extent.origin.y))
let W = image.extent.width, H = image.extent.height
print("frame", Int(W), "x", Int(H))

func foregroundMask(_ img: CIImage) throws -> CIImage? {
  let handler = VNImageRequestHandler(ciImage: img, options: [:])
  let req = VNGenerateForegroundInstanceMaskRequest()
  try handler.perform([req])
  guard let r = req.results?.first else { return nil }
  let buf = try r.generateScaledMaskForImage(forInstances: r.allInstances, from: handler)
  return CIImage(cvPixelBuffer: buf)
}

// Top-left rect -> CoreImage rect (origin bottom-left).
func ciRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect { CGRect(x: x, y: H - y - h, width: w, height: h) }

let black = CIImage(color: .black).cropped(to: image.extent)
var mask = try foregroundMask(image)!.cropped(to: image.extent)

// Plates: run Vision on a crop around each, then place the crop's mask back where it came from.
let plateCrops = [ciRect(150, 800, 340, 420), ciRect(1262, 840, 210, 500)]
for (i, r) in plateCrops.enumerated() {
  let crop = image.cropped(to: r).transformed(by: CGAffineTransform(translationX: -r.origin.x, y: -r.origin.y))
  if let m = try foregroundMask(crop) {
    let placed = m.transformed(by: CGAffineTransform(translationX: r.origin.x, y: r.origin.y))
    let maxed = CIFilter.maximumCompositing(); maxed.inputImage = placed.composited(over: black); maxed.backgroundImage = mask
    mask = maxed.outputImage!.cropped(to: image.extent)
    print("plate", i, "masked")
  } else {
    print("plate", i, "NOT found")
  }
}

// Bar: a 22 px stroke along its centre line, feathered 1.5 px.
let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
ctx.setFillColor(gray: 0, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
ctx.setStrokeColor(gray: 1, alpha: 1); ctx.setLineWidth(22); ctx.setLineCap(.round)
ctx.move(to: CGPoint(x: 77, y: H - 987)); ctx.addLine(to: CGPoint(x: 1602, y: H - 1101)); ctx.strokePath()
let bar = CIImage(cgImage: ctx.makeImage()!)
let soft = CIFilter.gaussianBlur(); soft.inputImage = bar.clampedToExtent(); soft.radius = 1.5
let maxed = CIFilter.maximumCompositing(); maxed.inputImage = soft.outputImage!.cropped(to: image.extent); maxed.backgroundImage = mask
mask = maxed.outputImage!.cropped(to: image.extent)

// Same grayed-room recipe as scripts/photo-lift.swift.
let gray = CIFilter.colorControls(); gray.inputImage = image; gray.saturation = 0; gray.contrast = 0.85; gray.brightness = 0.04
let blur = CIFilter.gaussianBlur(); blur.inputImage = gray.outputImage!.clampedToExtent(); blur.radius = Float(3 * (W / 2400))
let veil = CIImage(color: CIColor(red: 1, green: 1, blue: 1, alpha: 0.38)).cropped(to: image.extent)
let lifted = veil.composited(over: blur.outputImage!.cropped(to: image.extent))
let out = CIFilter.blendWithMask(); out.inputImage = image; out.backgroundImage = lifted; out.maskImage = mask

let c = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
try c.writeJPEGRepresentation(of: out.outputImage!.cropped(to: image.extent), to: outDir.appendingPathComponent("bench-bar-muted.jpg"), colorSpace: srgb, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.86])
try c.writePNGRepresentation(of: mask, to: outDir.appendingPathComponent("bench-bar-mask.png"), format: .L8, colorSpace: CGColorSpace(name: CGColorSpace.linearGray)!)
print("done")
