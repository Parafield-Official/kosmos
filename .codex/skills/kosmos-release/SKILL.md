---
name: kosmos-release
description: Release the Audiobooth/Kosmos desktop app through its protected dev-to-main promotion, immutable version tag, signed installer, notarization, and update-feed workflow.
---

# Kosmos Release

Use this skill only in the Kosmos repository. Read `CONTRIBUTING.md`,
`.github/workflows/ci.yml`, and `.github/workflows/release.yml` before each
release; their current contents are the source of truth.

## Release path

- Feature and release-integration pull requests target protected `dev`.
- `main` accepts only a `dev` promotion pull request. Do not use a feature branch
  as the head of a `main` pull request.
- Tags use `vX.Y.Z` and must match the version in `package.json`. The release
  workflow rejects a tag whose commit is not already an ancestor of `main`.
- The tag-triggered workflow creates the signed macOS installer, Windows
  installer, GitHub Release, and Pages update feed. Do not create a separate
  GitHub Release by hand.

For a normal release, merge the release work into `dev`, wait for its checks,
promote `dev` to `main`, wait for that promotion's checks, fetch `origin/main`,
then create and push an annotated tag on that exact merge commit.

## Validation

The CI gate builds the application, runs `npm test`, and runs
`node scripts/verify-acx-pipeline.cjs`. Run the relevant local equivalents before
the promotion when the environment supports them. `npm run verify` is a broader
preflight; its proof check needs macOS speech and audio tooling, so run it
outside a restricted sandbox when available.

## Release workflow behavior

The workflow packages macOS arm64, macOS x64 (Intel), and Windows x64, verifies the staged native
runtime, submits the macOS app for notarization, then publishes installers and
the update feed after Apple accepts the submission. It permits one notarization
pipeline at a time, so another release can wait by design.

A native-runtime cache miss rebuilds MarkItDown and the WhisperX/faster-whisper
runtime. The Windows build can take materially longer than ordinary CI. Treat a
long-running package job as a failure only when GitHub reports one; inspect its
completed log before changing the workflow. Do not blame manuscript parsing or
package metadata for a cache miss unless the cache key shows that dependency.

Native caches made by a tag are scoped to that tag and cannot warm later tags.
Pushes to `main` automatically build and verify the native runtime and save a
cache available to later tags without signing, publishing, or changing a release. Wait for this run
to succeed before creating a tag that needs the new runtime cache.

Monitor the release with increasing intervals: check when it starts, after each
package transition, and then every few minutes during native builds or Apple
notarization. Report state changes rather than repeated unchanged polls. For
requested background updates after the task ends, create a quiet thread heartbeat
that reports only completion, failure, or required user action.

Use GitHub's documented rerun on the tagged workflow only for a verified
transient failure. Do not delete, move, or recreate a release tag automatically.
