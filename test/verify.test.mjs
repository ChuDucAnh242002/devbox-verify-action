import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../scripts/verify.mjs", import.meta.url));
const config = JSON.stringify({ packages: [], shell: { scripts: { doctor: "true", setup: "true", test: "true" } } });

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "devbox-verify-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  git("config", "user.name", "Action Tests");
  git("config", "user.email", "tests@example.invalid");
  writeFileSync(join(cwd, "devbox.json"), config);
  writeFileSync(join(cwd, "devbox.lock"), '{"lockfile_version":"1","packages":{}}\n');
  git("add", "devbox.json", "devbox.lock");
  git("commit", "-qm", "Test fixture");
  const env = {
    ...process.env,
    RUNNER_OS: "Linux",
    INPUT_DEVBOX_VERSION: "0.22.0",
    INPUT_DOCTOR_SCRIPT: "doctor",
    INPUT_SETUP_SCRIPT: "",
    INPUT_TEST_SCRIPT: "test",
    GITHUB_OUTPUT: join(cwd, "output"),
  };
  return {
    cwd, git, env,
    invoke: (command, overrides = {}) => spawnSync(process.execPath, [cli, command], {
      cwd, env: { ...env, ...overrides }, encoding: "utf8",
    }),
  };
}

test("preflight accepts optional setup and emits readiness only after validation", (t) => {
  const f = fixture(t);
  assert.equal(f.invoke("preflight").status, 0);
  assert.equal(f.invoke("preflight", { INPUT_SETUP_SCRIPT: "setup" }).status, 0);
  assert.match(readFileSync(f.env.GITHUB_OUTPUT, "utf8"), /^(baseline=[0-9a-f]{40,64}\nvalidated=true\n){2}$/);
  assert.equal(f.invoke("check").status, 0);
});

test("preflight rejects unsupported runners, floating versions and unsafe or missing script names", (t) => {
  const f = fixture(t);
  for (const input of [
    { RUNNER_OS: "Windows" },
    { INPUT_DEVBOX_VERSION: "latest" },
    { INPUT_DEVBOX_VERSION: "0.22.0\nINJECTED=true" },
    { INPUT_DOCTOR_SCRIPT: "" },
    { INPUT_SETUP_SCRIPT: "setup; touch injected" },
    { INPUT_TEST_SCRIPT: "--help" },
    { INPUT_TEST_SCRIPT: "test\nother" },
    { INPUT_TEST_SCRIPT: "not-defined" },
    { INPUT_TEST_SCRIPT: "toString" },
  ]) {
    const result = f.invoke("preflight", input);
    assert.equal(result.status, 1, JSON.stringify(input));
    assert.match(result.stderr, /Devbox verification failed/);
  }
  assert.throws(() => readFileSync(f.env.GITHUB_OUTPUT), { code: "ENOENT" });
});

test("checks detect modifications, deletion and symlink substitution in both configuration files", (t) => {
  const f = fixture(t);
  for (const name of ["devbox.json", "devbox.lock"]) {
    const path = join(f.cwd, name);
    const original = readFileSync(path);
    writeFileSync(path, Buffer.concat([original, Buffer.from(" ")]));
    assert.equal(f.invoke("check").status, 1);
    assert.equal(f.invoke("preflight").status, 1);
    rmSync(path);
    assert.equal(f.invoke("check").status, 1);
    const target = join(f.cwd, `${name}.copy`);
    writeFileSync(target, original);
    symlinkSync(target, path);
    assert.equal(f.invoke("check").status, 1);
    rmSync(path);
    writeFileSync(path, original);
  }
});

test("checks detect staged-only changes even when working files match HEAD", (t) => {
  const f = fixture(t);
  const path = join(f.cwd, "devbox.lock");
  const original = readFileSync(path);
  writeFileSync(path, '{}\n');
  f.git("add", "devbox.lock");
  writeFileSync(path, original);
  assert.equal(f.invoke("check").status, 1);
});

test("final check uses the starting commit even if a script commits its changes", (t) => {
  const f = fixture(t);
  assert.equal(f.invoke("preflight").status, 0);
  const baseline = readFileSync(f.env.GITHUB_OUTPUT, "utf8").split("\n")[0].slice("baseline=".length);
  writeFileSync(join(f.cwd, "devbox.lock"), '{}\n');
  f.git("add", "devbox.lock");
  f.git("commit", "-qm", "Change lock during verification");
  assert.equal(f.invoke("check", { INPUT_BASELINE_COMMIT: baseline }).status, 1);
});

test("checks do not overlook skip-worktree modifications or reject unrelated changes", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, "unrelated.txt"), "local work");
  assert.equal(f.invoke("check").status, 0);
  f.git("update-index", "--skip-worktree", "devbox.lock");
  writeFileSync(join(f.cwd, "devbox.lock"), '{}\n');
  assert.equal(f.invoke("check").status, 1);
});

test("preflight rejects uncommitted configuration and malformed committed JSON", (t) => {
  const f = fixture(t);
  f.git("rm", "--cached", "devbox.lock");
  f.git("commit", "-qm", "Remove tracked lock");
  assert.equal(f.invoke("preflight").status, 1);
  f.git("add", "devbox.lock");
  writeFileSync(join(f.cwd, "devbox.json"), "{not json");
  f.git("add", "devbox.json");
  f.git("commit", "-qm", "Malformed fixture");
  const result = f.invoke("preflight");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON/);
  assert.doesNotMatch(result.stderr, /not json/);
});

test("script runner passes one validated argument, preserves failures and never launches unsafe inputs", (t) => {
  const f = fixture(t);
  const bin = join(f.cwd, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "devbox"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\nexit "$FAKE_STATUS"\n', { mode: 0o755 });
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    CAPTURE: join(f.cwd, "arguments"),
    INPUT_SCRIPT: "setup-test",
    FAKE_STATUS: "0",
  };
  assert.equal(f.invoke("run", env).status, 0);
  assert.equal(readFileSync(env.CAPTURE, "utf8"), "run\nsetup-test\n");
  assert.equal(f.invoke("run", { ...env, FAKE_STATUS: "7" }).status, 7);
  rmSync(env.CAPTURE);
  assert.equal(f.invoke("run", { ...env, INPUT_SCRIPT: "test; touch injected" }).status, 1);
  assert.throws(() => readFileSync(env.CAPTURE), { code: "ENOENT" });
  assert.equal(f.invoke("run", { INPUT_SCRIPT: "test", PATH: bin + "/missing" }).status, 1);
});
