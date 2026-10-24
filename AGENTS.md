# Agent Guidelines & Git Flow Protocols — OwnTheGlass

## 🛡️ Critical Safety Directive: Main Branch Protection

The `main` branch of this repository is directly wired to **Cloudflare Pages production**. Any commit pushed to `origin/main` automatically triggers a live edge build and deploys immediately to **https://owntheglass.org**.

**NEVER commit or push directly to `main`.**

---

## 🌿 Mandatory Git Flow Workflow

Before making any file edits or starting work on a new feature, bug fix, or refactor, the agent **MUST** follow this git flow:

### 1. Ensure `main` is Clean & Up to Date
Before branching, check working directory status and sync with remote:
```bash
git checkout main
git pull origin main
```

### 2. Create a Dedicated Feature or Fix Branch
Always create a new branch from `main` before modifying any files:
- **Features**: `git checkout -b feat/<descriptive-name>` (e.g., `feat/model-comparison`, `feat/samsung-adapter`)
- **Bug Fixes**: `git checkout -b fix/<descriptive-name>` (e.g., `fix/turnstile-reset`, `fix/route-404`)
- **Refactoring / Performance**: `git checkout -b refactor/<descriptive-name>`
- **Documentation / Chores**: `git checkout -b docs/<descriptive-name>` or `chore/<descriptive-name>`

### 3. Local Verification Before Staging
Before committing any changes on your branch, you **must** verify:
1. **Type & SSR Build Check**: Run `npm run build` to confirm Astro SSR entrypoints, client assets, and static routes compile with zero errors.
2. **Automated Test Suite**: Run `npm test` to ensure all validation and double opt-in tests pass (currently 35/35 passing).
3. **Local Dev Test (when applicable)**: Run `npx wrangler dev` to verify local Worker runtime and D1 bindings if touching endpoints or Cloudflare bindings.

### 4. Committing Changes
Use Conventional Commits formatting:
```bash
git add <specific-files>
git commit -m "<type>(<scope>): <clear, concise summary of change>"
```
Examples:
- `feat(models): add brand filter dropdown for OLED displays`
- `fix(seo): ensure sitemap XML escapes ampersands in query parameters`
- `refactor(db): optimize subscription lookup indexing`

### 5. Pushing & Pull Requests
Push only the feature/fix branch to `origin`:
```bash
git push -u origin <branch-name>
```
- Cloudflare Pages will generate an isolated **Preview Deployment** for the branch without touching production.
- Only merge into `main` after preview verification and explicit confirmation from the user.

---

## 🚫 Strictly Forbidden Actions
- **DO NOT** run `git push origin main` or commit directly while on `main`.
- **DO NOT** use `git push --force` or `--force-with-lease` on `main`.
- **DO NOT** modify the live production database (`--remote`) without explicit instruction and confirmation.
- **DO NOT** add `noindex` directives, `X-Robots-Tag: noindex`, or robots disallow rules blocking Googlebot.
