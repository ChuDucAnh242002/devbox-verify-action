import { appendFileSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = ["devbox.json", "devbox.lock"];

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("Git verification failed; use a checked-out repository with a HEAD commit.");
  }
  return result.stdout.trim();
}

function check() {
  const baseline = process.env.INPUT_BASELINE_COMMIT || git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40,64}$/.test(baseline)) throw new Error("Invalid baseline commit.");
  if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== realpathSync(".")) {
    throw new Error("Run the action at the Git repository root.");
  }
  for (const file of files) {
    let regular = false;
    try {
      regular = lstatSync(file).isFile();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!regular) throw new Error(`${file} must exist and be a regular file, not a symlink.`);

    const committed = spawnSync("git", ["show", `${baseline}:${file}`]);
    if (committed.error || committed.status !== 0) {
      throw new Error(`${file} must be committed before verification.`);
    }
    if (!readFileSync(file).equals(committed.stdout)) {
      throw new Error(`${file} differs from the starting commit; commit intentional changes before verification.`);
    }
  }
  const staged = spawnSync("git", ["diff", "--cached", "--exit-code", baseline, "--", ...files]);
  if (staged.error || staged.status !== 0) {
    throw new Error("Devbox configuration has staged changes; commit them before verification.");
  }
}

function scriptName(value, optional = false) {
  if (optional && value === "") return;
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Script names must start with an alphanumeric character and contain only letters, digits, underscores or hyphens.");
  }
}

function preflight() {
  if (process.env.RUNNER_OS !== "Linux") {
    throw new Error("This action currently supports Linux runners only.");
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(process.env.INPUT_DEVBOX_VERSION ?? "")) {
    throw new Error("devbox-version must be an exact major.minor.patch version.");
  }
  const scripts = [
    [process.env.INPUT_DOCTOR_SCRIPT ?? "", false],
    [process.env.INPUT_SETUP_SCRIPT ?? "", true],
    [process.env.INPUT_TEST_SCRIPT ?? "", false],
  ];
  for (const [name, optional] of scripts) scriptName(name, optional);
  check();
  const config = JSON.parse(readFileSync("devbox.json", "utf8"));
  const lock = JSON.parse(readFileSync("devbox.lock", "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      !lock || typeof lock !== "object" || Array.isArray(lock)) {
    throw new Error("devbox.json and devbox.lock must contain JSON objects.");
  }
  for (const [name] of scripts) {
    if (name && !Object.hasOwn(config.shell?.scripts ?? {}, name)) {
      throw new Error("A requested script is not defined in devbox.json.");
    }
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
  appendFileSync(process.env.GITHUB_OUTPUT, `baseline=${git(["rev-parse", "HEAD"])}\nvalidated=true\n`);
}

function run() {
  const name = process.env.INPUT_SCRIPT ?? "";
  scriptName(name);
  const result = spawnSync("devbox", ["run", name], { stdio: "inherit" });
  if (result.error) throw new Error("Unable to start Devbox; check the installation step.");
  if (result.signal) throw new Error("Devbox script was terminated by a signal.");
  if (result.status !== 0) {
    process.exitCode = result.status;
    console.error(`Devbox script failed with exit code ${result.status}.`);
  }
}

try {
  switch (process.argv[2]) {
    case "preflight": preflight(); break;
    case "run": run(); break;
    case "check": check(); break;
    default: throw new Error("Expected preflight, run or check.");
  }
} catch (error) {
  // Do not print configuration contents or user-provided values into CI logs.
  const message = error instanceof SyntaxError ? "Invalid JSON in Devbox configuration." : error.message;
  console.error(`Devbox verification failed: ${message}`);
  process.exitCode = 1;
}
