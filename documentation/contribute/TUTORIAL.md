# Connect a contributor's repo to your GitHub

*For the repository's GitHub admin. About 10 minutes. The contributor needs no GitHub account, and you keep control of every step.*

**What you'll have at the end:** a GitHub Action in your repo that, about once an hour, copies the contributor's `release` branch from their own forge into a `contributor` branch of yours. Nothing reaches your main branch until you review and merge it.

**Before you start:** the contributor sends you the URL of their release repo. Try it on a test repo first if you like; the steps are the same.

## 1. Add the secret

**Settings → Secrets and variables → Actions → New repository secret.**
- Name: `UPSTREAM_URL`
- Value: the release-repo URL the contributor sent you

It's a secret so the URL stays out of your public files.

## 2. Add the workflow

Create `.github/workflows/pull-contributor.yml` **on your default branch** with the contents of [`pull-contributor.yml`](pull-contributor.yml). Scheduled workflows run only from the default branch. Read it first: it's about 25 lines, and it:
- fetches the contributor's `release` branch from `UPSTREAM_URL`;
- **stops** if the contributor's commits add, change or delete anything under `.github/`, so nothing from outside can touch a workflow. Your own workflows are fine: it compares their commits with the history you share. If you share none (a fresh release), any `.github/` content is refused;
- updates your `contributor` branch **without force-pushing**, so if their history is ever rewritten, the run fails and waits for you.

## 3. Run it once

**Actions → Pull contributor → Run workflow.** When it turns green, you'll see a new `contributor` branch under **Code → Branches**.
If the push step fails with a permission error, check **Settings → Actions → General → Workflow permissions**, or your organization's Actions policy.

## 4. Protect your main branch

**Settings → Rules → Rulesets → New branch ruleset**, targeting your default branch:
- **Require a pull request before merging**, with at least one approval;
- **Block force pushes.**

(Or use **Settings → Branches → Add branch protection rule** with the same two settings.) Don't restrict pushes to `contributor` itself, because the Action has to update it.

## 5. Review and merge

**Pull requests → New pull request**, base: your main branch, compare: `contributor`. Review it like any outside contribution, and merge when you're happy. If the pull request stays open, it updates itself each time the Action brings new commits.

## Good to know

- **Turn it off:** delete the file, or use **Actions → Pull contributor → ⋯ → Disable workflow**.
- **A red run** means the Action refused something (a change under `.github/`, or a rewritten history). Nothing was changed. Tell the contributor.
- **"Entirely different commit histories":** the release was made fresh, as a new project. Ask the contributor to base it on your main branch, or use it as the start of a new repo.
- **Quiet repos:** GitHub pauses scheduled workflows in a public repo after 60 days with no activity. Re-enable it under **Actions**.
- **Please don't** download the code and re-upload it by hand. It's slower, and it breaks the link to the source.
- **Check the guard yourself:** `bash test-pull-contributor.sh` (next to this file) runs the workflow's exact lines against throwaway local repos, with no network, and shows what it accepts and refuses.
