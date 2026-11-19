const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { review, flagged } = require("../review");
const root = path.resolve(__dirname, "..");
function extractPacket(manifest) {
  const reader = spawnSync(
    path.join(root, ".venv", "bin", "python"),
    ["-m", "service.read_packet", path.resolve(manifest)],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (reader.error) throw reader.error;
  if (reader.status !== 0)
    throw Error(reader.stderr.trim() || "Document reader failed.");
  return JSON.parse(reader.stdout).map((record) => {
    const fields = review(record);
    return {
      id: record.id,
      title: record.title,
      kind: record.kind,
      fields,
      flags: fields
        .filter(flagged)
        .map((f) => ({ label: f.label, reason: f.status })),
    };
  });
}
if (require.main === module) {
  try {
    console.log(
      JSON.stringify(
        extractPacket(
          process.argv[2] || path.join(root, "fixtures", "manifest.json"),
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { extractPacket };
