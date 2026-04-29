const { chmodSync, existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const root = join(__dirname, "..");

if (process.env.CI || !existsSync(join(root, ".git"))) {
  process.exit(0);
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: root,
  stdio: "inherit",
});

try {
  chmodSync(join(root, ".githooks", "pre-commit"), 0o755);
} catch {
  // Windows can ignore Unix executable bits.
}
