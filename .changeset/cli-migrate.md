---
'isoloop': minor
---

Adds `isoloop migrate [version]`, which rewrites a project's source for an Isoloop release that changed an API. It starts from the installed `@isoloop/*` version (or `--from`) and runs each release's step up to the target, by default the newest the CLI knows. It prints the changes as a diff and writes nothing unless `--write` is given. It changes only the code it rewrites, so formatting and comments stay, and code it can't rewrite safely gets a `// isoloop-migrate:` comment. The `0.2` step changes no code. See [Upgrading](https://isoloop.dev/docs/getting-started/#upgrading).
