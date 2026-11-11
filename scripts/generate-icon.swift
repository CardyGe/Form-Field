// macOS, CPU only: swift scripts/generate-icon.swift
// Then: iconutil -c icns build/icon.iconset -o build/icon.icns
import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

let fileManager = FileManager.default
try fileManager.createDirectory(atPath: "build/icon.iconset", withIntermediateDirectories: true)

let font = CTFontCreateWithName("Georgia-Italic" as CFString, 650, nil)
var character: UniChar = 102
var glyph = CGGlyph()
guard CTFontGetGlyphsForCharacters(font, &character, &glyph, 1),
      let letter = CTFontCreatePathForGlyph(font, glyph, nil) else {
    fatalError("The native Georgia Italic monogram could not be outlined.")
}

func value(_ number: CGFloat) -> String { String(format: "%.3f", Double(number)) }
func coordinate(_ point: CGPoint) -> String { "\(value(point.x)) \(value(point.y))" }
var elements: [String] = []
letter.applyWithBlock { pointer in
    let element = pointer.pointee
    switch element.type {
    case .moveToPoint: elements.append("M\(coordinate(element.points[0]))")
    case .addLineToPoint: elements.append("L\(coordinate(element.points[0]))")
    case .addQuadCurveToPoint: elements.append("Q\(coordinate(element.points[0])) \(coordinate(element.points[1]))")
    case .addCurveToPoint: elements.append("C\(coordinate(element.points[0])) \(coordinate(element.points[1])) \(coordinate(element.points[2]))")
    case .closeSubpath: elements.append("Z")
    @unknown default: fatalError("Unsupported glyph path element.")
    }
}

let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title description">
  <title id="title">Form &amp; Field</title>
  <desc id="description">An italic, interlocking ff monogram in soft lime on charcoal.</desc>
  <defs>
    <linearGradient id="charcoal" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#20251b"/><stop offset="1" stop-color="#131610"/>
    </linearGradient>
    <path id="f" d="\(elements.joined(separator: " "))"/>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#charcoal)" stroke="#3b4433" stroke-width="2"/>
  <g fill="#d4ec9e">
    <use href="#f" transform="translate(500 735) scale(1 -1)" opacity=".55"/>
    <use href="#f" transform="translate(320 665) scale(1 -1)"/>
  </g>
</svg>
"""
try svg.write(toFile: "build/icon.svg", atomically: true, encoding: .utf8)

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [red / 255, green / 255, blue / 255, alpha])!
}
func canvas(_ size: Int) -> CGContext {
    guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else {
        fatalError("Could not allocate icon bitmap.")
    }
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    return context
}

let context = canvas(1024)
let background = CGPath(roundedRect: CGRect(x: 64, y: 64, width: 896, height: 896), cornerWidth: 200, cornerHeight: 200, transform: nil)
context.saveGState()
context.addPath(background); context.clip()
let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                          colors: [color(32, 37, 27), color(19, 22, 16)] as CFArray,
                          locations: [0, 1])!
context.drawLinearGradient(gradient, start: CGPoint(x: 512, y: 960), end: CGPoint(x: 512, y: 64), options: [])
context.restoreGState()
context.addPath(background); context.setStrokeColor(color(59, 68, 51)); context.setLineWidth(2); context.strokePath()

func drawLetter(x: CGFloat, baseline: CGFloat, opacity: CGFloat) {
    context.saveGState()
    context.translateBy(x: x, y: 1024 - baseline)
    context.addPath(letter); context.setFillColor(color(212, 236, 158, opacity)); context.fillPath()
    context.restoreGState()
}
drawLetter(x: 500, baseline: 735, opacity: 0.55)
drawLetter(x: 320, baseline: 665, opacity: 1)
guard let original = context.makeImage() else { fatalError("Could not create the icon image.") }

func writePNG(_ image: CGImage, path: String) {
    guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Could not write \(path).")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Could not finish \(path).") }
}
writePNG(original, path: "build/icon-preview.png")
let sizes: [(String, Int)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]
for (filename, size) in sizes {
    let small = canvas(size); small.interpolationQuality = .high
    small.draw(original, in: CGRect(x: 0, y: 0, width: size, height: size))
    writePNG(small.makeImage()!, path: "build/icon.iconset/\(filename)")
}
print("Wrote build/icon.svg, build/icon-preview.png and build/icon.iconset using \(CTFontCopyPostScriptName(font)).")
