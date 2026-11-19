import * as Picker from "expo-document-picker";
import { File } from "expo-file-system";
import { readDocument } from "./mobileOcr";

export async function pickDocument() {
  const result = await Picker.getDocumentAsync({
    type: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/tiff",
      "image/webp",
      "text/plain",
    ],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  if (file.size > 12 * 1024 * 1024)
    throw Error("Choose a file smaller than 12 MB.");
  const mime =
    asset.mimeType ||
    (asset.name.toLowerCase().endsWith(".txt")
      ? "text/plain"
      : "application/octet-stream");
  if (mime.startsWith("text/")) {
    const text = await file.text();
    if (!text.trim()) throw Error("The text file is empty.");
    return { name: asset.name, pages: [{ text, method: "Text" }] };
  }
  return { name: asset.name, pages: await readDocument(asset.uri) };
}
