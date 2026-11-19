import ExpoModulesCore
import ImageIO
import PDFKit
import UIKit

public class FielddeskReader: Module {
  private func failure(_ message: String) -> NSError {
    NSError(domain: "FielddeskReader", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  public func definition() -> ModuleDefinition {
    Name("FielddeskReader")
    AsyncFunction("modelFiles") { () -> [String: String] in
      guard
        let url = Bundle.main.url(forResource: "FielddeskOCR", withExtension: "bundle")
          ?? Bundle(for: FielddeskReader.self).url(
            forResource: "FielddeskOCR", withExtension: "bundle"),
        let bundle = Bundle(url: url),
        let model = bundle.path(forResource: "model", ofType: "pte"),
        let charset = bundle.path(forResource: "charset", ofType: "json")
      else {
        throw self.failure("The OCR model is missing from this build.")
      }
      return ["modelPath": model, "charsetPath": charset]
    }
    AsyncFunction("readPage") { (uri: String, index: Int) -> [String: Any] in
      guard let url = URL(string: uri), url.isFileURL,
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
        (1...12 * 1024 * 1024).contains(size)
      else { throw self.failure("Choose a nonempty file up to 12 MB.") }
      let data = try Data(contentsOf: url, options: .mappedIfSafe)
      if data.prefix(1024).range(of: Data("%PDF-".utf8)) != nil {
        guard let pdf = PDFDocument(data: data), !pdf.isLocked else {
          throw self.failure("Choose a readable, unlocked PDF.")
        }
        try self.check(index, pdf.pageCount)
        guard let page = pdf.page(at: index) else { throw self.failure("Unreadable PDF page.") }
        let bounds = page.bounds(for: .cropBox)
        guard bounds.width > 0 && bounds.height > 0 else {
          throw self.failure("Invalid PDF page dimensions.")
        }
        let scale = min(2.5, 2400 / max(bounds.width, bounds.height))
        let thumbnail = page.thumbnail(
          of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .cropBox)
        guard let image = thumbnail.cgImage else {
          throw self.failure("Could not render the PDF page.")
        }
        return try self.raster(image, pdf.pageCount, page.string ?? "")
      }
      guard let src = CGImageSourceCreateWithData(data as CFData, nil) else {
        throw self.failure("Unsupported image.")
      }
      let count = CGImageSourceGetCount(src)
      try self.check(index, count)
      let info = CGImageSourceCopyPropertiesAtIndex(src, index, nil) as? [CFString: Any]
      guard let w = info?[kCGImagePropertyPixelWidth] as? Int,
        let h = info?[kCGImagePropertyPixelHeight] as? Int,
        w > 0 && h > 0 && w <= 24_000_000 / h
      else { throw self.failure("Use an image under 24 megapixels.") }
      let opts: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2400,
      ]
      guard let image = CGImageSourceCreateThumbnailAtIndex(src, index, opts as CFDictionary) else {
        throw self.failure("Unreadable image.")
      }
      return try self.raster(image, count, "")
    }
  }

  private func check(_ index: Int, _ count: Int) throws {
    guard (1...12).contains(count), (0..<count).contains(index) else {
      throw failure("Choose a document with 1 to 12 pages.")
    }
  }

  private func raster(_ image: CGImage, _ count: Int, _ text: String) throws -> [String: Any] {
    let w = image.width
    let h = image.height
    guard
      let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
      let pixels = ctx.data?.assumingMemoryBound(to: UInt8.self)
    else { throw failure("Could not prepare image pixels.") }
    let rect = CGRect(x: 0, y: 0, width: w, height: h)
    ctx.setFillColor(UIColor.white.cgColor)
    ctx.fill(rect)
    ctx.draw(image, in: rect)
    var rgb = Data(count: w * h * 3)
    rgb.withUnsafeMutableBytes { (out: UnsafeMutableRawBufferPointer) in
      for i in 0..<w * h { for c in 0..<3 { out[i * 3 + c] = pixels[i * 4 + c] } }
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString + ".rgb")
    try rgb.write(to: url, options: .atomic)
    return ["count": count, "text": text, "width": w, "height": h, "uri": url.absoluteString]
  }
}
