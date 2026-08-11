# AGENTS.md

## Working directory

This is the project workspace: `C:\Users\rafaj\Documents\development\workspaces\opencode\catalog_ia`.
Always run commands from this directory (e.g. use `workdir` = this folder). Do not use or reference
the sibling `thep2pexperience` folder.

## Commands

- Backend typecheck: `cmd /c "npx tsc --noEmit"` in `backend/`
- Backend tests: `cmd /c "npx jest --silent"` in `backend/` (jest config roots: `backend/src` + root `test/`)
- Frontend typecheck: `cmd /c "npx tsc --noEmit"` in `frontend/`
- Frontend tests: `cmd /c "npx jest --silent"` in `frontend/`

PowerShell blocks `npx` without `cmd /c "..."`.

After finishing a task, commit and push to `origin/main`.
