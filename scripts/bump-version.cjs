const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const packagePath = join(root, "package.json");
const lockPath = join(root, "package-lock.json");
const increment = process.env.VERSION_INCREMENT || "patch";
const packageJson = readJson(packagePath);
const before = packageJson.version;
const after = bumpVersion(before, increment);

packageJson.version = after;
writeJson(packagePath, packageJson);

if (existsSync(lockPath)) {
  const lockJson = readJson(lockPath);
  lockJson.version = after;

  if (lockJson.packages && lockJson.packages[""]) {
    lockJson.packages[""].version = after;
  }

  writeJson(lockPath, lockJson);
}

execFileSync("git", ["add", "package.json", "package-lock.json"], {
  cwd: root,
  stdio: "inherit",
});

console.log(`Version bumped from ${before} to ${after}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, type) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  const [major, minor, patch] = parts;

  if (type === "major") {
    return `${major + 1}.0.0`;
  }

  if (type === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  if (type === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }

  throw new Error(`Unsupported VERSION_INCREMENT: ${type}`);
}
