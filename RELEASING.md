# Releasing

Steps in order. Stop if a check fails.

**Prerequisites:** `npm ci` done, `main` up to date, GitHub Actions enabled on the repo (forks have workflows disabled until enabled in the Actions tab).

1. **Test on Home Assistant.** Build (`npm run build`), copy `dist/apple-home-dashboard.js` to a test instance and hard refresh. Check the changed features and that the browser console shows no `APPLE HOME` errors.
2. **Verify locally.** `npx tsc --noEmit` prints nothing, `npm run build` compiles. Then `git checkout -- dist`: CI rebuilds `dist/` on `main`, so don't commit local builds.
3. **Docs.** Add a "What's New" entry to `README.md`.
4. **Bump the version.** `npx bump X.Y.Z package.json --commit "chore: release vX.Y.Z"`. The version only lives in `package.json`. Do not pass `--tag` or `--push`. `bump` appends the version to a custom commit message (`vX.Y.ZX.Y.Z`), so fix it with `git commit --amend`.
5. **Merge into `main`.** Either open a pull request and use *Create a merge commit* (keeps commits separate), or merge locally with `git merge --no-ff <branch> -F <message-file>` (`-F -` from stdin is not supported).
6. **Push `main`.** CI (`build.yml`) builds `dist/` and commits it as "Continuous Integration - Build Distribution". It only runs on a push to `main`: if Actions was just enabled, trigger it with an empty commit. Wait for that commit, then `git pull --ff-only origin main`.
7. **Check `dist/` before tagging.** `git show HEAD:dist/apple-home-dashboard.js | grep -c "<string only the new code has>"` must be above 0, and `package.json` must show the new version.
8. **Tag the CI commit** (the current `main` HEAD, not an earlier one): `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`. A tag placed before the CI commit makes HACS download a stale `dist/`.
9. **Publish the GitHub release** from that tag (Releases → new release → choose the tag). No assets needed: HACS reads `dist/` at the tag.
10. **Update in HACS** and hard refresh the browser. Only one copy of the integration can be installed: two copies define the same custom elements and the second is silently ignored.

**Rollback.** Remove the release and tag (`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`), and revert the merge with `git revert -m 1 <merge commit>`; CI rebuilds `dist/`.

**Notes.** `gh` is not installed on the maintainer machine, so pull requests and releases are done in the browser. The HACS validation workflow (`validate.yml`) runs on pushes to `main` and daily; it may flag missing repository topics or disabled Issues, which does not block installing as a custom repository.
