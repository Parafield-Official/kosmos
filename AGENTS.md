# Kosmos agent instructions

Setup: [README.md](README.md). Branches, pull requests and releases: [CONTRIBUTING.md](CONTRIBUTING.md).

## Org rules

Parafield-Official org members also follow the rules shared by every org repo, in [`org/rules.md` in Parafield-Official/vault](https://github.com/Parafield-Official/vault/blob/main/org/rules.md) (private). This file and [CONTRIBUTING.md](CONTRIBUTING.md) win where they are more specific.

Claude Code loads that file by itself only inside the hub folder. Anywhere else (Codex, CI, cloud sessions, a standalone clone), read it before the first commit: `gh api -H 'Accept: application/vnd.github.raw' repos/Parafield-Official/vault/contents/org/rules.md`.
