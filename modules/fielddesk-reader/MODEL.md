# Bundled OCR model

Fielddesk bundles Software Mansion's PP-OCRv6 Small XNNPACK INT8 export and character set.
The model release declares the Apache License 2.0, included with the assets in the application.
The original model family is PaddleOCR. [Pinned model release](https://huggingface.co/software-mansion/PP-OCRv6-ExecuTorch/tree/91bd390053f7e743af8f5274de20a6bb985346bb)

| Bundled file | Upstream file | SHA-256 |
| --- | --- | --- |
| model.pte | xnnpack/pp_ocrv6_xnnpack_int8.pte | 726d414858606c890e3909ce89d639e6bc70898b155f7042722fd13c3c2ea913 |
| charset.json | charset.json | d8a5fa55a186d9d49846da3297a5b5cef4f49791d7bc0624d82ef984b22ea5bf |

Recognition uses the CPU and a line confidence threshold of 0.5.
Both resources load from the installed app on first scan.
