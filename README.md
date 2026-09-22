# Handout Archive (static / GitHub Pages version)

No server, no PHP, no database — just plain HTML/CSS/JS. It works because
"uploading" a file really means committing it straight into your GitHub
repo, and GitHub Pages just serves whatever's in the repo.

- `index.html` / `index.js` — the public page players see
- `admin.html` / `admin.js` — your admin page (add / edit / delete files)
- `style.css` — shared retro styling
- `data/files.json` — the list of all entries (auto-updated by the admin page)
- `files/` — the actual PDFs live here
- `icons/` — icon images live here

## One-time setup

1. **Create a GitHub repo** (public — GitHub Pages needs a public repo
   unless you're on a paid plan). Upload everything in this folder to it.
2. **Turn on GitHub Pages**: repo → Settings → Pages → set it to deploy
   from your main branch. GitHub gives you a URL like
   `https://yourusername.github.io/reponame/`.
3. **Create an access token** so the admin page is allowed to write to
   the repo: GitHub → Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → New token.
   - Repository access: only this one repo.
   - Permissions: **Contents → Read and write**. Nothing else needed.
   - Copy the token somewhere safe — GitHub only shows it once.
4. Visit `yoursite.com/admin.html`. It will usually guess your username
   and repo name automatically; paste in your token and hit Connect.
   The token is saved only in your own browser (`localStorage`) — it is
   never written into the site itself.
5. Start adding files. Each "Add file" click makes a real commit to your
   repo, so GitHub Pages picks it up automatically (usually live within
   about a minute).

## Important limits of this version, compared to a real server

- **The password is a soft UI hider, not real security.** Every file in
  a public GitHub repo has a public URL, whether it's linked from the
  page or not — password or no password. Locking a file just keeps it
  off the visible list until unlocked; it doesn't block anyone who
  already has or guesses the direct link. Fine for keeping casual
  players from stumbling onto GM content; not fine for anything you'd
  actually be upset to have leak.
- **Large PDFs**: GitHub's API caps a single file upload at 1MB when
  done this way. Most handout PDFs are well under that, but if you hit
  the limit, compress the PDF or split it.
- **The token is powerful**: anyone who gets hold of it can write to
  your repo. Don't paste it into a shared/public computer, and you can
  revoke and regenerate it any time from GitHub's token settings if
  you're ever unsure.

## Editing / removing files

On the admin page, click a file's name to expand it — change its name,
description, color, or password (or tick "remove existing password"),
then Save. Delete removes the file, its icon, and its entry in one go.
