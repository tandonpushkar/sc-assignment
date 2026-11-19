import { requireNativeModule } from "expo";
import { File } from "expo-file-system";
import { createPaddleOcr } from "react-native-executorch";
import { readPages } from "./ocrPage";

const reader = requireNativeModule("FielddeskReader");

export async function readDocument(uri) {
  let engine;
  async function recognize(page) {
    if (!engine) {
      const paths = await reader.modelFiles();
      engine = await createPaddleOcr({
        ...paths,
        modelOpts: { defaultConfidenceThreshold: 0.5 },
      });
    }
    return engine.recognizeCharacters({
      data: await new File(page.uri).bytes(),
      width: page.width,
      height: page.height,
      format: "rgb",
      layout: "hwc",
    });
  }
  try {
    return await readPages(
      (index) => reader.readPage(uri, index),
      recognize,
      (path) => new File(path).delete(),
    );
  } finally {
    engine?.dispose();
  }
}
