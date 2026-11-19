# OCR accuracy benchmark

| Measured outcome | Tesseract 5.5.0 on macOS | React Native ExecuTorch 0.11.0 on Android |
| --- | --- | --- |
| Exact printed amounts, including sign and cents | 23/23 (100%) | 23/23 (100%) |
| Documents with exactly the expected flags | 8/8 (100%) | 8/8 (100%) |
| Expected flags detected | 3/3 (100%) | 3/3 (100%) |
| Raised flags that were correct | 3/3 (100%) | 3/3 (100%) |

The two discrepancies and the missing amount all reached review.
Whitespace differences in the raw OCR text did not change the parsed amounts.
This measures financial-field accuracy after the Sledge Review parser.
The Android measurement used an ARM64 Pixel emulator running API 37.
See the [per-document scores](results/metrics.json), [Tesseract transcripts](results/tesseract.json), and [Android transcripts](results/executorch.json).

The eight synthetic JPEGs were prepared for this comparison and are separate from the original extraction and review fixtures.
They contain printed change orders in two fonts with modest skew, JPEG compression and varying blur.
The reference labels in `truth.json` were written before running either engine.
The collection has 23 printed financial amounts and one blank field.

Both engines start with the same decoded RGB pixels.
Tesseract uses the app's image-preparation routine and page segmentation mode 6.
The Android benchmark uses PP-OCRv6 Small, the XNNPACK INT8 detector variant, and a confidence threshold of 0.5.
Each raw transcript goes into the same unmodified Sledge Review change-order field parser and review rules.
The comparison uses complete lines as returned by each engine without a custom layout repair step.

## Metrics

- Exact financial-field accuracy counts a match when one distinct parsed amount for the correct field equals the printed amount to the cent, including sign.
- Exact review accuracy counts documents whose entire field-and-reason flag set matches the labels, including clean documents.
- Flag recall measures expected flags recovered.
- Flag precision measures the fraction of raised flags that match an expected field and reason.

The intentionally blank amount is evaluated as a missing-field flag.
Its absence contributes nothing to the denominator of 23 printed values.
The documents use a single-column layout and contain no handwriting.
These results describe the bundled packet and do not establish accuracy on real jobsite documents.

## Reproduce

From the project root, prepare the scan inputs using the existing Python environment.

```sh
.venv/bin/python -m evaluation.ocr.prepare /tmp/fielddesk-rgb
```

The preparation step writes Tesseract's raw transcripts and exports an RGB file per scan plus image dimensions for the Android runner.
The independent native runner is in `android/index.js`.
Use a debug development build with Expo SDK 55, React Native 0.83.10, react-native-executorch 0.11.0, react-native-worklets 0.10.4, and react-native-blob-util 0.24.11.
Set the native build configuration to use XNNPACK and OpenCV.
The runner reads its input files from the app's private documents directory.
Place the exported RGB files, images.json, model.pte and charset.json there before launch.
The model and character set are from [Software Mansion's pinned model release](https://huggingface.co/software-mansion/PP-OCRv6-ExecuTorch/tree/91bd390053f7e743af8f5274de20a6bb985346bb).
Use `xnnpack/pp_ocrv6_xnnpack_int8.pte` as model.pte.
Copy the runner's ocr-results.json into results/executorch.json, then score both transcript files.

```sh
node evaluation/ocr/score.js
```

The separate `mixed-contract.pdf` regression exercises the embedded-text and OCR merge.
Its native layer supplies the $42,000 prior amount and its image supplies a $500 deduction and the printed $42,500 revised total.
The expected total is $41,500.
This PDF is outside the eight-image comparison.
