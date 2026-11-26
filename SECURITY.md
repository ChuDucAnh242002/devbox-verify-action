# Security

Until a stable release, only the latest reviewed development commit receives
fixes. No security audit or sandbox guarantee is claimed.

Do not post credentials, private repository content or exploit details in public
issues. Use GitHub's private vulnerability reporting on this repository when
available. Otherwise, contact the maintainer on GitHub to arrange a private
reporting channel before sharing details.

Include the affected action commit, runner type, a minimal reproduction with
synthetic data, and the expected versus actual behaviour.

This action executes the caller's Devbox scripts and hooks. The caller must
isolate untrusted code and limit workflow permissions and secrets. Dependency
pinning does not make an unsafe caller workflow safe.
