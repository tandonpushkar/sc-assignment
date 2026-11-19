import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { registerRootComponent } from "expo";
import { File, Paths } from "expo-file-system";
import { createPaddleOcr } from "react-native-executorch";

function Runner() {
  const [status, setStatus] = useState("Loading OCR benchmark");
  useEffect(() => {
    async function run() {
      const file = (name) => new File(Paths.document, name);
      const localPath = (name) =>
        decodeURI(file(name).uri.replace("file://", ""));
      const engine = await createPaddleOcr({
        modelPath: localPath("model.pte"),
        charsetPath: localPath("charset.json"),
        modelOpts: { defaultConfidenceThreshold: 0.5 },
      });
      try {
        const results = {};
        for (const item of JSON.parse(await file("images.json").text())) {
          setStatus("Reading " + item.id);
          const pixels = await file(item.id + ".rgb").bytes();
          const lines = await engine.recognizeCharacters({
            data: pixels,
            width: item.width,
            height: item.height,
            format: "rgb",
            layout: "hwc",
          });
          results[item.id] = lines.map((line) => line.text).join("\n");
        }
        file("ocr-results.json").write(JSON.stringify(results, null, 2));
        setStatus("Completed " + Object.keys(results).length + " scans");
      } finally {
        engine.dispose();
      }
    }
    run().catch((e) => {
      console.error("Fielddesk benchmark", String(e));
      setStatus(String(e));
    });
  }, []);
  return <Text style={{ margin: 40 }}>{status}</Text>;
}
registerRootComponent(Runner);
