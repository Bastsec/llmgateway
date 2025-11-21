# Git Synchronization Strategy

This repository tracks an upstream (`theopenco/llmgateway`) while we continue to ship custom changes from our fork (`Bastsec/llmgateway`). Follow the steps below whenever we need to pull in upstream work without losing local updates.

1. **Review and commit local work**
   - Run `git status -sb` to ensure you understand pending edits.
   - Commit staged work (or `git stash push -m "<desc>"`) so the branch is clean before syncing.

2. **Fetch upstream updates**

   ```bash
   git fetch upstream --prune
   ```

   This brings in all new branches/tags and removes stale references.

3. **Rebase our `main`**

   ```bash
   git checkout main
   git rebase upstream/main
   ```

   - Resolve conflicts file-by-file (`git status` lists them).
   - Prefer integrating upstream changes while preserving our enhancements (e.g., keep new provider support while adopting upstream fixes).
   - After each conflict batch: `git add <files>` → `git rebase --continue`.
   - If a conflicted file was deleted upstream and is safe to drop, use `git rm <file>` before continuing.

4. **Validate**
   - Run relevant quality gates (`pnpm lint`, `pnpm test:unit`, `pnpm build`) when time permits to ensure the rebased tree is healthy.

5. **Update our fork**

   ```bash
   git push origin main --force-with-lease
   ```

   Use `--force-with-lease` to avoid overwriting collaborators’ work accidentally.

6. **Re-apply any stashed changes (if used)**
   ```bash
   git stash pop
   ```
   Resolve any follow-up conflicts, test, and commit as needed.

Notes:

- Never run destructive commands such as `git reset --hard` unless explicitly required.
- Keep branch history linear via rebasing; only merge upstream if a non-linear history is preferred for a specific release.
- When conflicts touch shared files (e.g., payment flows), inspect upstream intent before choosing our version to avoid regressions.
