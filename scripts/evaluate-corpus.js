const path = require("node:path");
const { extractPacket } = require("./extract-packet");
const corpus = path.join(__dirname, "../evaluation/corpus");
const labels = require("../evaluation/corpus/labels.json");

// One distinct normalized value across a field's evidence, or null when absent or ambiguous.
function distinctValue(field) {
  const values = [...new Set(field.evidence.map((e) => e.value).filter((v) => v !== null))];
  return values.length === 1 ? values[0] : null;
}

function score(results, truth) {
  const ids = results.map((r) => r.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(truth).sort()))
    throw Error("Corpus record IDs do not match the labels.");
  const out = { records: results.length, exactFlagSets: 0, flagsCaught: 0, flagsMissed: 0, unnecessaryFlags: 0,
    valuesCorrect: 0, valuesTotal: 0, failures: [] };
  for (const r of results) {
    const want = truth[r.id];
    const got = Object.fromEntries(r.flags.map((f) => [f.label, f.reason]));
    const problems = [];
    for (const [label, reason] of Object.entries(want.flags)) {
      if (got[label] === reason) out.flagsCaught++;
      else { out.flagsMissed++; problems.push(`missed ${label}|${reason} (got ${got[label] ?? "no flag"})`); }
    }
    for (const [label, reason] of Object.entries(got))
      if (want.flags[label] !== reason) { out.unnecessaryFlags++; problems.push(`unnecessary ${label}|${reason}`); }
    for (const [label, expected] of Object.entries(want.values)) {
      out.valuesTotal++;
      const actual = distinctValue(r.fields.find((f) => f.label === label));
      if (actual === expected) out.valuesCorrect++;
      else problems.push(`value ${label}: expected ${expected}, got ${actual}`);
    }
    // Tolerant records pass when the document is flagged or every expected value was read correctly.
    const safe = want.tolerant && (r.flags.length > 0 || !problems.some((p) => p.startsWith("value")));
    if (!problems.length || safe) {
      out.exactFlagSets++;
      if (want.tolerant) out.tolerantPassed = (out.tolerantPassed || 0) + 1;
      if (safe && problems.length) {
        // Unnecessary flags on tolerant records are the safe outcome, not a precision loss.
        out.unnecessaryFlags -= problems.filter((p) => p.startsWith("unnecessary")).length;
      }
    } else out.failures.push({ id: r.id, problems });
  }
  const pct = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : null);
  out.percent = {
    recordsFullyCorrect: pct(out.exactFlagSets, out.records),
    flagRecall: pct(out.flagsCaught, out.flagsCaught + out.flagsMissed),
    flagPrecision: pct(out.flagsCaught, out.flagsCaught + out.unnecessaryFlags),
    values: pct(out.valuesCorrect, out.valuesTotal),
  };
  return out;
}
if (require.main === module)
  console.log(JSON.stringify(score(extractPacket(path.join(corpus, "manifest.json")), labels), null, 2));
module.exports = { score, corpus };
