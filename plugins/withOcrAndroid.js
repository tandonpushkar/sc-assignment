const { withDangerousMod, withProjectBuildGradle } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = function withOcrAndroid(config) {
  config = withProjectBuildGradle(config, (mod) => {
    const include = "apply from: rootProject.file('../plugins/worklets-compat.gradle')";
    if (!mod.modResults.contents.includes(include)) {
      mod.modResults.contents += "\n" + include + "\n";
    }
    return mod;
  });
  // SDK 55's RN Gradle plugin uses a toolchain resolver compatible with Gradle 8.
  return withDangerousMod(config, ["android", async (mod) => {
    const file = path.join(mod.modRequest.platformProjectRoot, "gradle/wrapper/gradle-wrapper.properties");
    const wrapper = await fs.readFile(file, "utf8");
    await fs.writeFile(file, wrapper.replace(/gradle-[\d.]+-bin\.zip/, "gradle-8.14.3-bin.zip"));
    return mod;
  }]);
};
