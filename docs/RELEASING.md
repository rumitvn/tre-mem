# CI/CD & releasing — a beginner's guide

This repo has two GitHub Actions workflows. You don't run them by hand — GitHub
runs them automatically when something happens.

## 1. CI (`.github/workflows/ci.yml`)

**When:** every push to `main` and every pull request.

**What:** on a clean Ubuntu machine, it installs deps and runs
`format:check → lint → typecheck → test → build` on Node 20 and 22. If anything
fails, you get a red ✗ on the commit/PR. It also uploads the compiled `dist/`
as a downloadable artifact.

Think of it as a robot that re-checks your work on a clean machine, so "works on
my laptop" problems get caught before they reach `main`.

You don't need to do anything to enable it — it's active the moment this file is
on `main`. Watch runs under the repo's **Actions** tab.

## 2. Release (`.github/workflows/release.yml`)

**When:** you push a git tag that starts with `v` (e.g. `v0.2.0`).

**What:** it builds + tests, then:

1. checks the tag matches the `version` in `package.json` (guards against typos),
2. creates a **GitHub Release** with auto-generated notes and the packed
   `.tgz` attached,
3. **publishes to npm only if** you've added an `NPM_TOKEN` secret (see below).
   No secret → it just makes the GitHub Release and skips npm.

### Cutting a release

```bash
# 1. make sure package.json version is what you want (e.g. 0.2.0)
# 2. commit everything, then:
git tag v0.2.0
git push origin v0.2.0
```

That's it. The workflow does the rest. Watch it under **Actions**.

### Pre-releases (alpha/beta)

If the version has a hyphen, it's treated as a pre-release:

- `package.json` version `0.2.0-alpha.0`, tag `v0.2.0-alpha.0`
- the GitHub Release is marked "pre-release"
- the npm publish (if enabled) uses the `alpha` dist-tag, so a plain
  `npm i tre-mem` never installs it — only `npm i tre-mem@alpha` does.

## Publishing to npm (optional)

The package is only public on npm if **you** choose to publish it. To enable the
npm step:

1. Create an npm account and an **automation access token** at
   npmjs.com → Access Tokens.
2. In this repo: **Settings → Secrets and variables → Actions → New repository
   secret**, name it `NPM_TOKEN`, paste the token.
3. Push a version tag (above). The workflow now publishes.

**Things to know before you publish to npm:**

- npm packages are **public and effectively permanent** — the name `tre-mem` is
  claimed forever, and unpublishing is heavily restricted after 72 hours.
- Your repo can stay **private** while the npm package is public; they're
  independent.

If you'd rather not use npm yet, do nothing — the Release workflow still gives
you a versioned GitHub Release with a downloadable tarball.
