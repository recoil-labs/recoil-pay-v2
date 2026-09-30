# Releasing the @recoilpay intent packages

`@recoilpay/intent-core`, `@recoilpay/intent-react` and `@recoilpay/intent-widget` are released together with [Changesets](https://github.com/changesets/changesets). They always share one version number, so partners never have to work out which versions go together.

## One-time setup

1. **Create the npm organization.** On [npmjs.com](https://www.npmjs.com), create the free organization `recoilpay` (Add Organization → free plan for public packages). Add the people who may publish.
2. **Create a publish token.** On npmjs.com, go to Access Tokens → Generate New Token → **Granular Access Token**, with *Read and write* on the `@recoilpay` scope. Set an expiry and note it somewhere, because the release job fails once the token expires.
3. **Add the token to GitHub.** In `recoil-labs/recoil-pay-v2`, go to Settings → Secrets and variables → Actions, and add a repository secret named **`NPM_TOKEN`**.
4. **Let Actions open PRs.** Go to Settings → Actions → General → Workflow permissions, and enable **"Allow GitHub Actions to create and approve pull requests"**. The release workflow needs it for the "Version Packages" PR.

The repository is private, so packages are published **without** npm provenance. npm only issues provenance for public source repositories.

## The first release (0.1.0)

No changeset is needed. The packages are already at `0.1.0`, and `changeset publish` publishes any version that isn't on npm yet. Once the setup above is done:

- **Merging the intent-kit PR into `main`** runs the release workflow and publishes all three packages at `0.1.0`.
- **If the PR was merged before `NPM_TOKEN` existed**, that run failed at the publish step. Add the secret, then run it again from Actions → **intent-kit release** → *Run workflow*.

Then check:

- https://www.npmjs.com/package/@recoilpay/intent-core (and `-react`, `-widget`)
- https://cdn.jsdelivr.net/npm/@recoilpay/intent-widget@0.1/dist/recoilpay-intent-widget.js loads. It's the URL the docs give partners.
- Remove the **"Availability"** note from `linkiswap-core/docs-site/docs/integrate/drop-in-ui.md` and deploy the docs.

## Every change after that

1. In the PR that changes a package, run this from `recoilpay-intent-kit/`:

   ```sh
   npx changeset
   ```

   Pick the bump and write one or two sentences **for partners**. Those sentences become the changelog entry. Commit the generated `.changeset/*.md` file with the PR.

   | Bump | When |
   |---|---|
   | `patch` | Fixes, with nothing a partner has to change |
   | `minor` | New props, attributes or features, still backwards compatible |
   | `major` | Anything a partner must change in their code. While on `0.x`, use `minor` for these and say so in the changeset |

2. **Merge the PR.** The release workflow opens (or updates) a PR called **"chore(intent-kit): version packages"**, which bumps versions and updates each `CHANGELOG.md`.
3. **Merge that PR when you want to release.** The workflow publishes the new versions to npm.

A PR that doesn't change package behaviour (tests, docs, CI) doesn't need a changeset.

## What runs where

| Workflow | When | Does |
|---|---|---|
| `.github/workflows/intent-kit-ci.yml` | PRs and pushes to `main` touching `recoilpay-intent-kit/` | `npm ci`, typecheck, tests, build |
| `.github/workflows/intent-kit-release.yml` | Pushes to `main` touching `recoilpay-intent-kit/`, or run by hand | Typecheck and tests, then either open the Version Packages PR or publish |

## Publishing by hand (emergency only)

```sh
cd recoilpay-intent-kit
npm ci && npm run typecheck && npm test
npm login                 # an account in the recoilpay org
npm run release           # builds, then publishes versions not yet on npm
```

Prefer the workflow: publishing by hand skips review, and it's easy to publish from a dirty working tree.

## Checking a build before it ships

```sh
npm run build
npm publish --dry-run -w packages/core      # lists exactly what would be uploaded
npx publint packages/core                   # manifest and exports sanity
npx @arethetypeswrong/cli --pack packages/react --exclude-entrypoints styles.css
```
