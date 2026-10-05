# AGENTS.md

## Working directory

This is the project workspace: `C:\Users\rafaj\Documents\development\workspaces\opencode\catalog_ai`.
Always run commands from this directory (e.g. use `workdir` = this folder). Do not use or reference
the sibling `thep2pexperience` folder.

## Version management

- The **root `package.json` `version` field is the single source of truth**. To change the app
  version, edit ONLY that field and run `npm run sync:version` from the root (or just build: the
  root `prebuild` hook runs it automatically). The script propagates the version to
  `backend/package.json`, `frontend/package.json`, the app entries of the three `package-lock.json`
  files and the version tokens in `docs/API.*` / `docs/DEPLOYMENT.*`. Never edit those by hand.
- The runtime reads the version from the root `package.json` (`backend/src/app.ts` imports
  `../../package.json`), so `/api/status` and the header badge always report the root version.
- `CHANGELOG.md` entries are prose and stay manual (historical versions are never rewritten).

## Git workflow

- `main` is **protected**: it can only be changed through a pull request, force pushes and branch
  deletion are blocked, and admin bypass is disabled. A direct `git push origin main` is rejected.
- After finishing a task, create or reuse a feature branch, commit there and push that branch, then
  open (or update) a pull request to `main`. Never try to push to `main` directly.
- Commit messages are written in Spanish, in the imperative, explaining the reason of the change and
  not just the list of files touched.

## Commands

- Backend typecheck: `cmd /c "npx tsc --noEmit"` in `backend/`
- Backend tests: `cmd /c "npx jest --silent"` in `backend/` (jest config roots: `backend/src` + root `test/`)
- Frontend typecheck: `cmd /c "npx tsc --noEmit"` in `frontend/`
- Frontend tests: `cmd /c "npx vitest run"` in `frontend/`

PowerShell blocks `npx` without `cmd /c "..."`.
