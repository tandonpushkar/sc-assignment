const test = require("node:test");
const assert = require("node:assert/strict");
const { mergePage, readPages } = require("./ocrPage");
const { review } = require("./review");

test("mixed-page duplicate lines collapse and differing amounts keep their source", () => {
  const page = mergePage("Vendor: Test Yard\nTotal: $120.00", [
    { text: " VENDOR:  Test Yard " },
    { text: "Total: $102.00" },
    { text: " " },
  ]);
  assert.deepEqual(page.lineMethods, ["PDF text", "PDF text", "ExecuTorch OCR"]);
  const fields = review({ kind: "Invoice", docs: [{ name: "mixed.pdf", pages: [page] }], decisions: {} });
  const total = fields.find((field) => field.label === "Total (USD)");
  assert.equal(total.status, "Conflict");
  assert.deepEqual(total.evidence.map((candidate) => candidate.method), ["PDF text", "ExecuTorch OCR"]);
});

test("reader preserves page order and releases each raster before starting the next page", async () => {
  const calls = [];
  const inputs = [{ text: "Header", count: 3 }, { text: "", uri: "scan", count: 3 }, { text: "", count: 3 }];
  const pages = await readPages(
    async (i) => { calls.push(i); return inputs[i]; },
    async (page) => { calls.push(page.uri); return [{ text: "Tax: $0.00" }]; },
    (uri) => calls.push("delete " + uri),
  );
  assert.deepEqual(calls, [0, 1, "scan", "delete scan", 2]);
  assert.deepEqual(pages.map((page) => page.text), ["Header", "Tax: $0.00", ""]);
  assert.equal(pages[1].method, "ExecuTorch OCR");
});

test("an inference failure removes its raster and aborts the import", async () => {
  const deleted = [];
  await assert.rejects(readPages(
    () => ({ count: 2, text: "", uri: "page" }),
    () => { throw Error("model failed"); },
    (uri) => deleted.push(uri),
  ), /model failed/);
  assert.deepEqual(deleted, ["page"]);
});

test("a blank scan asks for another image", async () => {
  await assert.rejects(readPages(() => ({ count: 1, text: "", uri: "blank" }), () => [], () => {}), /No readable text/);
});
