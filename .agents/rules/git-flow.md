---
description: Mandatory Git Flow and main branch protection protocols
globs: *
alwaysApply: true
---

# Git Flow & Branch Protection Protocol

The `main` branch of this repository is directly wired to Cloudflare Pages production (`https://owntheglass.org`).
Direct commits or direct pushes to `main` are strictly forbidden.

## Mandatory Workflow
1. **Branching**: Before editing code or starting any task, create and checkout a new branch from `main`:
   - `feat/<name>` for new features
   - `fix/<name>` for bug fixes
   - `refactor/<name>`, `docs/<name>`, or `chore/<name>`
2. **Local Testing**: Always run `npm run build` and `npm test` before committing.
3. **Commit Messages**: Use Conventional Commits (`feat: ...`, `fix: ...`, etc.).
4. **Pushing**: Push only feature/fix branches with `git push -u origin <branch-name>` so Cloudflare creates preview deployments. Never push directly to `main`.
