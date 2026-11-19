const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { extractPacket } = require("./scripts/extract-packet");
const { score, corpus } = require("./scripts/evaluate-corpus");
const labels = require("./evaluation/corpus/labels.json");
const manifest = require("./evaluation/corpus/manifest.json");
const results = extractPacket(path.join(corpus, "manifest.json"));

test("every corpus document reaches its hand-labeled outcome through the real reader", () => {
  const outcome = score(results, labels);
  assert.deepEqual(outcome.failures, []);
  assert.equal(outcome.flagsMissed, 0);
  assert.equal(outcome.unnecessaryFlags, 0);
  assert.equal(outcome.valuesCorrect, outcome.valuesTotal);
  assert.equal(outcome.exactFlagSets, outcome.records);
});

test("a flagged review is never silently replaced by a clean one: tolerant records stay safe", () => {
  for (const id of Object.keys(labels).filter((k) => labels[k].tolerant)) {
    const record = results.find((r) => r.id === id);
    const wrong = Object.entries(labels[id].values).some(([label, expected]) => {
      const values = [...new Set(record.fields.find((f) => f.label === label).evidence.map((e) => e.value))];
      return values.length !== 1 || values[0] !== expected;
    });
    assert.ok(!wrong || record.flags.length > 0, `${id} was misread without a flag`);
  }
});

test("the corpus covers every record kind, flag reason, source type and reading method", () => {
  const kinds = new Set(manifest.map((r) => r.kind));
  assert.deepEqual([...kinds].sort(), ["Change order", "Invoice", "Purchase order", "Receipt"]);
  const reasons = new Set(Object.values(labels).flatMap((l) => Object.values(l.flags)));
  assert.deepEqual([...reasons].sort(), ["Amount mismatch", "Check format", "Conflict", "Missing"]);
  for (const kind of kinds)
    assert.ok(manifest.some((r) => r.kind === kind && !Object.keys(labels[r.id].flags).length), `${kind} has no clean example`);
  const extensions = new Set(manifest.flatMap((r) => r.files.map((f) => path.extname(f))));
  for (const ext of [".pdf", ".jpg", ".png", ".tiff", ".txt"]) assert.ok(extensions.has(ext), ext);
  const methods = new Set(results.flatMap((r) => r.fields.flatMap((f) => f.evidence.map((e) => e.method))));
  for (const method of ["Text", "PDF text", "OCR"]) assert.ok(methods.has(method), method);
  assert.ok(manifest.some((r) => r.files.length > 1), "no multi-copy record");
  assert.ok(Object.values(labels).some((l) => l.tolerant), "no hard-input record");
  assert.ok(manifest.length >= 30);
});

test("every label in the corpus names a real field of its kind", () => {
  const { schemas } = require("./review");
  for (const r of manifest)
    for (const label of [...Object.keys(labels[r.id].flags), ...Object.keys(labels[r.id].values)])
      assert.ok(schemas[r.kind].includes(label), `${r.id}: ${label}`);
});
