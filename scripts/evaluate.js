const { extractPacket } = require("./extract-packet");
const path = require("node:path");
const labels = require("../evaluation/labels.json");
function score(results, truth) {
  const actual = new Map(
    results.map((r) => [
      r.id,
      new Map(r.flags.map((f) => [f.label, f.reason])),
    ]),
  );
  if (
    actual.size !== Object.keys(truth).length ||
    Object.keys(truth).some((id) => !actual.has(id))
  )
    throw Error("Evaluation record IDs do not match.");
  let caught = 0,
    missed = 0,
    unnecessary = 0;
  for (const [id, expected] of Object.entries(truth)) {
    const flags = actual.get(id);
    for (const [field, reason] of Object.entries(expected)) {
      if (flags.get(field) === reason) caught++;
      else missed++;
    }
    for (const [field, reason] of flags)
      if (expected[field] !== reason) unnecessary++;
  }
  return { records: results.length, caught, missed, unnecessary };
}
if (require.main === module) {
  console.log(
    JSON.stringify(
      score(
        extractPacket(path.join(__dirname, "../evaluation/manifest.json")),
        labels,
      ),
      null,
      2,
    ),
  );
}
module.exports = { score };
