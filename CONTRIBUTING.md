# Contributing to Kosmos

Kosmos uses a protected two-branch release workflow:

- `dev` is the integration branch and the base for contributor pull requests.
- `main` is the production branch used for signed release tags.
- Changes reach `main` only through a `dev` to `main` promotion pull request.

## Submit a change

1. Fork the repository and create a feature branch from the latest `dev`.
2. Make the change and add or update tests where applicable.
3. Open a pull request targeting `dev`.
4. Resolve review feedback and wait for the required build and test check.

Do not target `main` with feature pull requests. Direct pushes, force pushes, and
branch deletion are disabled for both protected branches.

## Release promotion

Maintainers promote a tested integration snapshot by opening a pull request from
`dev` into `main`. Release tags must point to commits already merged into `main`.
