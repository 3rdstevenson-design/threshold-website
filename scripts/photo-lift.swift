// Subject lift with Apple's Vision framework (the same engine as "Lift subject" in Photos), all local.
// Usage: swift scripts/photo-lift.swift <in.jpg> <outDir> <name> [maxEdge]
// Used for the site photos (2026-11-14): the *-muted.jpg output is the "room grayed" look in public/photos.
// 2026-11-27 (no boxing gym photos): knee-exam, consult-before-session, smiling-athlete and knee-rehab are the -muted.jpg
// of Photos for Carousels treatment-4/knee-exam-hands-01, treatment-4/consult-before-treatment-01, misc/gym-smiling-athlete
// and misc/treatment-knee-table; hamstring-stretch-cutout.png is the -cutout.png of treatment-4/straight-leg-raise-03, trimmed to the people.
// Writes <name>-cutout.png (alpha), <name>-mask.png, <name>-onlight.jpg (subject on #F5F5F5),
// and <name>-muted.jpg (real room kept, background turned soft gray, subject in color).
import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import Vision

let args = CommandLine.arguments
let inURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let name = args[3]
let maxEdge = args.count > 4 ? CGFloat(Double(args[4]) ?? 2400) : 2400

guard var image = CIImage(contentsOf: inURL, options: [.applyOrientationProperty: true]) else {
  fatalError("could not load \(inURL.path)")
}
let scale = min(1, maxEdge / max(image.extent.width, image.extent.height))
if scale < 1 {
  let f = CIFilter.lanczosScaleTransform()
  f.inputImage = image
  f.scale = Float(scale)
  f.aspectRatio = 1
  image = f.outputImage!
}
image = image.transformed(by: CGAffineTransform(translationX: -image.extent.origin.x, y: -image.extent.origin.y))

let handler = VNImageRequestHandler(ciImage: image, options: [:])
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let result = request.results?.first else { fatalError("no subject found") }
print("instances:", result.allInstances.count)

let maskBuffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: maskBuffer)

let ctx = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let extent = image.extent

// 1. Cut-out with alpha.
let clear = CIImage(color: .clear).cropped(to: extent)
let cut = CIFilter.blendWithMask()
cut.inputImage = image
cut.backgroundImage = clear
cut.maskImage = mask
try ctx.writePNGRepresentation(of: cut.outputImage!.cropped(to: extent), to: outDir.appendingPathComponent("\(name)-cutout.png"), format: .RGBA8, colorSpace: srgb)
try ctx.writePNGRepresentation(of: mask.cropped(to: extent), to: outDir.appendingPathComponent("\(name)-mask.png"), format: .L8, colorSpace: CGColorSpace(name: CGColorSpace.linearGray)!)

// 2. Subject on Clinical White.
let paper = CIImage(color: CIColor(red: 245 / 255, green: 245 / 255, blue: 245 / 255)).cropped(to: extent)
let onLight = CIFilter.blendWithMask()
onLight.inputImage = image
onLight.backgroundImage = paper
onLight.maskImage = mask
try ctx.writeJPEGRepresentation(of: onLight.outputImage!.cropped(to: extent), to: outDir.appendingPathComponent("\(name)-onlight.jpg"), colorSpace: srgb, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.86])

// 3. Room kept, background muted: grayscale, softened, lifted toward white. Subject stays in color.
let gray = CIFilter.colorControls()
gray.inputImage = image
gray.saturation = 0
gray.contrast = 0.85
gray.brightness = 0.04
let blur = CIFilter.gaussianBlur()
blur.inputImage = gray.outputImage!.clampedToExtent()
blur.radius = Float(3 * (extent.width / 2400))
let veil = CIImage(color: CIColor(red: 1, green: 1, blue: 1, alpha: 0.38)).cropped(to: extent)
let lifted = veil.composited(over: blur.outputImage!.cropped(to: extent))
let muted = CIFilter.blendWithMask()
muted.inputImage = image
muted.backgroundImage = lifted
muted.maskImage = mask
try ctx.writeJPEGRepresentation(of: muted.outputImage!.cropped(to: extent), to: outDir.appendingPathComponent("\(name)-muted.jpg"), colorSpace: srgb, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.86])

print("wrote", name, Int(extent.width), "x", Int(extent.height))
