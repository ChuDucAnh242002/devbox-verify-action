# Devbox Verify Action

A small composite GitHub Action that installs pinned Devbox, runs named scripts,
and fails if the committed `devbox.json` or `devbox.lock` changes or disappears.
Application tests stay in the consuming repository's Devbox scripts.

## Usage

Requires a Linux runner with Bash, Git and Node.js 22 or newer on `PATH`, and
a checked-out repository with both Devbox files committed at its root.
Subdirectory projects and Windows/macOS runners are not supported yet.

```yaml
permissions:
  contents: read

jobs:
  devbox-smoke:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      # Replace FULL_COMMIT_SHA with a reviewed commit from this repository.
      - uses: ChuDucAnh242002/devbox-verify-action@FULL_COMMIT_SHA
        with:
          devbox-version: '0.22.0'
          setup-script: setup
```

There is no stable release yet. Use a reviewed full commit SHA while piloting;
do not use a moving branch reference in production.

| Input | Default | Meaning |
| --- | --- | --- |
| `devbox-version` | `0.22.0` | Exact CLI version; no `latest`, ranges or prerelease identifiers |
| `doctor-script` | `doctor` | Required named diagnostic script |
| `setup-script` | empty | Optional named setup script; empty skips it |
| `test-script` | `test` | Required named test script |

Script names must start with a letter or digit and contain only letters,
digits, hyphens or underscores. Each requested name must exist in
`shell.scripts` in `devbox.json`. Inputs are names, not shell command strings.
The action exposes no outputs and requires no secrets or GitHub API access.

## Behaviour

1. Validate inputs, script existence and clean, regular Devbox files against HEAD.
   Record that starting commit for the final check.
2. Delegate installation to the SHA-pinned Jetify installer.
3. Run doctor, optional setup, then tests. A failure skips subsequent scripts.
4. Check both files again, including staged changes, even after installation or
   a script fails. Unrelated repository changes do not fail verification.

The action does not generate lockfiles, repair configuration, retry failed tests,
or approve changes. Commit intentional Devbox changes before invoking it.
Job timeouts are the caller's responsibility.

Full Nix-store caching and installer CLI-cache reuse are disabled. Nix GitHub
token injection is disabled. The installer can still download tools and packages,
install Nix using privileged operations, and execute Devbox initialization hooks.
This is version pinning, not a hermetic or fully checksum-verified installation:
the upstream installer uses a network bootstrap and has its own dependencies.

## Trust and maintenance

Devbox scripts and hooks are repository code, not a sandbox. Do not run untrusted
pull-request code with secrets, write permissions, privileged workflow triggers,
or on a persistent self-hosted runner. Prefer disposable GitHub-hosted runners.
The caller controls token permissions; this action cannot restrict them.

Review changes to this action, its pinned installer and transitive dependencies
before upgrading. Dependabot proposes GitHub Actions dependency updates weekly;
updates are not automatically merged. The Devbox CLI default is updated manually
and must pass integration tests before release.

Before releasing: run CI, review dependency changes and logs, update the
changelog, and create a version tag pointing to the tested commit. Consumers
should still pin full commit SHAs. Choose a license before distributing a release.

## Development

```sh
npm run check
npm test
```

No npm dependencies or install step are needed. Tests create isolated temporary
Git repositories and a fake Devbox executable; they never change an application
checkout or install Nix. GitHub CI also exercises `uses: ./` with real Devbox/Nix
and a package-free consumer fixture, including optional setup, failure at each
script stage, and lockfile deletion. They assert script ordering and early exit.
These smoke tests do not certify application package sets.

See [SECURITY.md](SECURITY.md) for reporting guidance and
[CHANGELOG.md](CHANGELOG.md) for changes.