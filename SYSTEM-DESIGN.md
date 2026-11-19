# Sledge Review system design

A site administrator needs to decide which value to enter when two copies of an invoice disagree.
The app keeps both candidates visible during review and in the resolved record.

## Packet results

Seven synthetic files represent five construction transactions.
The batch command reads the original bytes and runs the same field rules used by the mobile app.

| Record | Extracted result | Reviewer action |
| --- | --- | --- |
| Aggregate delivery, INV-1048 | Invoice PDF, page 1 line 8, shows $1,250.00. The accounts scan, page 1 line 9, reads $1,205.00. | Confirm the payable amount against the originals. |
| Aggregate purchase, PO-221 | North Quarry Supply, 25 tons of graded aggregate, $1,250.00. | Ready. |
| Fuel receipt | Haulway Fuel, November 8, 2026, total $86.40. The tax label is blank. | Supply the tax from independent evidence or leave the flag open. |
| Rebar delivery, RB-073 | The yard copy lists $4,088.00 and the office copy lists $4,880.00. Both totals appear on line 6. The separate $2,088.00 is a balance due. | Resolve the discrepancy between the two invoice totals. |
| Temporary shoring credit, CO-014 | Prior contract $250,000 less a $12,500 deduction gives $237,500. The printed revised contract is $262,500. | Inspect all three cited lines under **Amount mismatch**. |

The fresh packet yields two conflicting totals, one missing tax, and one inconsistent revised contract amount.
Tap **Review desk → Conflicts** to compare amounts and citations, or **Missing** to inspect absent values.
Saving a correction moves the exception into **Reviewed** and retains its underlying reason.
The screen uses the gold accent, near-black surfaces, and Work Sans heading treatment from the [Sledge homepage](https://www.getsledge.com/).

## Components and data flow

| Stage | Implementation | Output |
| --- | --- | --- |
| Intake | Expo Document Picker or pasted text. The reviewer selects invoice, purchase order, receipt, or change order and groups copies of one transaction. | A new record or a source attached to an existing record. |
| Read | TXT is decoded on the phone. Android reads PDF text with PDFBox, renders sparse or image-bearing PDF pages with PdfRenderer, and decodes photographs and TIFF frames. The local Expo module supplies one RGB raster at a time. React Native ExecuTorch runs bundled PP-OCRv6 Small on the CPU using XNNPACK. | Ordered text with page and line provenance. Distinct native and OCR readings remain available for review. |
| Extract | A JavaScript schema recognizes field labels, including common synonyms, a single garbled letter, and layouts with no colon or with the value on the next line. It retains the raw value, filename, page, and line. | Candidates scoped to one record and field. |
| Compare | The engine compares normalized USD decimals, ISO dates, identifiers without punctuation, or case-folded names. | Extracted, Missing, Conflict, Check format, or Amount mismatch. |
| Review | React Native shows flags first. The reviewer chooses evidence or types a valid correction. | A timestamped decision alongside the original evidence. |
| Persist | Expo SQLite key-value storage saves the register after import or review. | Records and decisions reopen on the same device. |

For command-line packet processing and repeatable comparison, Node calls a Python reader using PDFium and Tesseract.
The CLI and mobile app share the JavaScript field parser and review rules.

## Rules

Amounts use decimal strings so equivalent USD formatting compares exactly.
The reader keeps a missing tax distinct from a recorded zero.
Locale-ambiguous dates require human review, and a numeric date is accepted only when one part exceeds 12.
A value the engine cannot read exactly is flagged and never repaired by guessing, so `$1O` needs review and is not read as `$10`.
Records are grouped explicitly so totals on unrelated documents never compete.
Importing an identical name and page payload into the same record is idempotent.
Adding new evidence reopens that record's decisions so a stale approval cannot hide a new discrepancy.

## Verification

Run `npm test` after installing the dependencies in the README.
The CLI end-to-end test rereads all seven files from the manifest, runs OCR on the scanned copy, and asserts the complete expected exception list.
A second end-to-end corpus of 32 generated documents covers every record kind and flag reason through PDFs, scans, photographs, a multipage TIFF, and text in several encodings.
Its labels were written from the document designs before any run, and a meta-test fails if the corpus stops covering a kind, reason, file type, or reading method.
The parser tables check every field label, 35 accepted and 31 rejected money formats, 21 accepted and 18 rejected dates, 26 layouts, and signed change-order arithmetic.
Python reader tests cover each image format and color mode, sideways and tilted photographs, transparent screenshots, encodings, damaged or locked PDFs, limits, and the HTTP error contract.
Each fix was checked by disabling it and confirming a test failed.
The Android screenshot shows the open rebar conflict on a device where the aggregate invoice has already been reviewed.

## Evaluation and AI use

A separate five-record packet has manually assigned field and reason labels for four expected exceptions.
Running `npm run evaluate` through the document reader and extraction engine caught all four, missed zero, and raised zero unnecessary flags.
These counts measure review routing on synthetic examples and do not estimate general field accuracy.
The fixtures were available during development.

`npm run evaluate:corpus` scores the larger corpus.
It caught all 10 expected flags, raised no unnecessary flag, and read all 27 labeled values exactly.
Three of its 32 records are deliberately hard inputs, namely a 330 px thumbnail, a 700 px photograph, and a slashed-zero font.
For those, success means every value was read correctly or the record was flagged for review.
Separately, 88 degraded readings of eight labeled change-order scans (rotation, tilt, blur, noise, low light, low resolution) never let a wrong amount through without a flag.
The previous Tesseract preprocessing pipeline got 50 of those 88 documents wrong and the current Tesseract pipeline gets 13 wrong, and all 13 are flagged.
These percentages measure synthetic, single-column printed documents and do not establish accuracy on real jobsite photographs.

Majority voting across three OCR scales was measured and not adopted.
It lifted exact amounts from 92.1% to 92.9% on the degraded set at three times the OCR cost, and no single scale won on every variant.

The app uses local OCR and deterministic extraction without a hosted AI service.
The change-order rule adds signed amounts in integer cents within a single source, skips incomplete or ambiguous equations, and preserves the printed evidence when a reviewer enters a correction.
For unfamiliar layouts, evaluate a server-side model fallback on previously unseen labeled documents, measuring exact field matches and review outcomes alongside latency and cost.
Keep arithmetic validation and human review downstream of any proposed model value.

## Scope and production considerations

The exercise uses synthetic English-language documents with labeled fields, USD values, and a single-item purchase order.
Arbitrary tables, handwriting, and tax inference fall outside the implemented extractor.
OCR can still misread a single digit on a low-quality photograph.
Change orders catch this through the arithmetic check, other amounts are caught only when a second copy disagrees, and a clean-looking single copy of an invoice or receipt is not independently verified.
Mobile imports process up to 12 MB and 12 pages sequentially, then discard temporary RGB rasters.
The app retains extracted text and decisions locally.
Its on-device model adds roughly 23 MiB before APK compression.
The Android comparison covers eight labeled scans; the larger degraded-image study above measures the headless Tesseract reader.
A production deployment should authenticate uploads, store immutable document versions, process pages as retryable jobs, and check the source revision when accepting a review decision.
Replace the single-device snapshot with per-record transactions and a durable review history before supporting concurrent reviewers.

The [OCR benchmark](evaluation/ocr/README.md) compares Tesseract with an actual Android ExecuTorch run on eight synthetic change-order scans.
Both pipelines matched all 23 printed amounts and produced exactly the expected flags on all eight documents.
