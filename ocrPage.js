const PDF = "PDF text";
const OCR = "ExecuTorch OCR";

function lineKey(line) {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
}

function mergePage(nativeText, detections) {
  const native = nativeText.trim() ? nativeText.trim().split(/\r\n|[\r\n]/) : [];
  const embedded = new Set(native.map(lineKey));
  // Keep different readings of the same field so review can flag the discrepancy.
  const extra = detections
    .map((line) => line.text.trim())
    .filter((line) => line && !embedded.has(lineKey(line)));
  if (!native.length) return { text: extra.join("\n"), method: OCR };
  if (!extra.length) return { text: native.join("\n"), method: PDF };
  return {
    text: [...native, ...extra].join("\n"),
    method: PDF + " + " + OCR,
    lineMethods: [...native.map(() => PDF), ...extra.map(() => OCR)],
  };
}

async function readPages(readPage, recognize, removeRaster) {
  const pages = [];
  let count = 1;
  for (let index = 0; index < count; index++) {
    const page = await readPage(index);
    count = page.count;
    let lines = [];
    if (page.uri) {
      try {
        lines = await recognize(page);
      } finally {
        await removeRaster(page.uri);
      }
    }
    pages.push(mergePage(page.text, lines));
  }
  if (!pages.some((page) => page.text.trim())) {
    throw Error("No readable text. Try a sharper scan.");
  }
  return pages;
}

module.exports = { mergePage, readPages };
