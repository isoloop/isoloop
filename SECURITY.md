# Security

**Only the latest release is supported.** The version on npm `latest` gets fixes. When a new minor takes `latest`, earlier versions get none; upgrade instead. Previews (`next`) are never supported.

## Reporting a vulnerability

Report it privately through GitHub's [private vulnerability reporting](https://github.com/isoloop/isoloop/security/advisories/new). Please don't open a public issue.

A fix ships in `latest`. For a bug in a version that is no longer supported, we publish a security advisory that names the affected range and the fixed version, and we `npm deprecate` that range with "Upgrade to latest".

Isolates run same-origin and aren't a security boundary; see [Limits](README.md#limits).
