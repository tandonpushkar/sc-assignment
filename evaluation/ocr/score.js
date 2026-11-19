const fs = require("node:fs");
const path = require("node:path");
const { review, flagged } = require("../../review");
const truth = require("./truth.json");
const labels = [
  "Prior contract (USD)",
  "Change (USD)",
  "Revised contract (USD)",
];

function measure(texts) {
  const pages = [];
  for (const [id, target] of Object.entries(truth)) {
    if (typeof texts[id] !== "string") throw Error("Incomplete OCR run: " + id);
    const fields = review({
      kind: "Change order",
      decisions: {},
      docs: [{ name: id, pages: [{ method: "OCR", text: texts[id] }] }],
    });
    const predicted = labels.map((label) => {
      const values = [
        ...new Set(
          fields
            .find((f) => f.label === label)
            .evidence.map((e) => e.value)
            .filter((v) => v !== null),
        ),
      ];
      return values.length === 1 ? values[0] : null;
    });
    const flags = fields.filter(flagged).map((f) => f.label + "|" + f.status);
    const expected = target.flags;
    pages.push({
      id,
      predicted,
      correctPrinted: target.amounts.filter(
        (v, i) => v !== null && v === predicted[i],
      ).length,
      printed: target.amounts.filter((v) => v !== null).length,
      flags,
      caught: expected.filter((f) => flags.includes(f)).length,
      missed: expected.filter((f) => !flags.includes(f)).length,
      extra: flags.filter((f) => !expected.includes(f)).length,
    });
  }
  const sum = (k) => pages.reduce((a, p) => a + p[k], 0);
  const ratio = (n, d) => ({
    correct: n,
    total: d,
    percent: d ? Number(((n / d) * 100).toFixed(1)) : null,
  });
  const caught = sum("caught");
  return {
    exactFinancialFields: ratio(sum("correctPrinted"), sum("printed")),
    exactFlagSet: ratio(
      pages.filter((p) => !p.missed && !p.extra).length,
      pages.length,
    ),
    flagRecall: ratio(caught, caught + sum("missed")),
    flagPrecision: ratio(caught, caught + sum("extra")),
    pages,
  };
}
if (require.main === module) {
  const out = {};
  for (const engine of ["tesseract", "executorch"]) {
    out[engine] = measure(
      JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "results", engine + ".json"),
          "utf8",
        ),
      ),
    );
  }
  console.log(JSON.stringify(out, null, 2));
}
module.exports = { measure };
