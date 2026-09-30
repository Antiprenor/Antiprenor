# Handout Archive (static / GitHub Pages version)

No server, no PHP, no database — just plain HTML/CSS/JS. It works because
"uploading" a file really means committing it straight into your GitHub
repo, and GitHub Pages just serves whatever's in the repo.

The public page and admin panel are in Swedish. The setup docs below stay
in English since they're for you, not players.

- `index.html` / `index.js` — the public page players see
- `admin.html` / `admin.js` — your admin page (add / edit / delete files,
  manage categories)
- `style.css` — shared retro styling
- `assets/logo.png` — your logo, shown at the top of both pages
- `data/files.json` — the list of all entries (auto-updated by the admin page)
- `data/categories.json` — the list of categories (auto-updated by the admin page)
- `files/` — the actual PDFs live here
- `icons/` — icon images live here (including the three built-in presets)

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
4. Visit `yoursite.com/admin.html` directly — there's no link to it from
   the public page, so it's only reachable if you know (or bookmark) the
   address. It will usually guess your username and repo name
   automatically; paste in your token and hit "Anslut" (Connect). The
   token is saved only in your own browser (`localStorage`) — it is
   never written into the site itself.
5. Start adding files. Each "Lägg till fil" click makes a real commit to
   your repo, so GitHub Pages picks it up automatically (usually live
   within about a minute).

## Categories

The admin page has a "Hantera kategorier" (manage categories) panel where
you can add, rename, or delete categories — it ships with three to start:
"For SL", "For players", and "Karaktärsblad" (feel free to rename any of
them, including adding the missing "ö"/"ä" if you'd rather). Every file's
add/edit form has a Category dropdown to assign one — including files you
already uploaded before this feature existed. On the public page, visitors
get a row of tab buttons to flip between categories; "Alla" (All) shows
everything, and files with no matching category show up under
"Okategoriserat" if any exist.

Renaming a category updates everywhere it's used automatically. Deleting
one doesn't touch the files that had it — they just become uncategorized.

## Important limits of this version, compared to a real server

- **The password is a soft UI hider, not real security.** Every file in
  a public GitHub repo has a public URL, whether it's linked from the
  page or not — password or no password. Locking a file just keeps it
  off the visible list until unlocked; it doesn't block anyone who
  already has or guesses the direct link. Fine for keeping casual
  players from stumbling onto GM content; not fine for anything you'd
  actually be upset to have leak.
- **File size**: uploads go through GitHub's Git Data API, so there's no
  1MB ceiling — GitHub's own general limit is around 100MB per file, but
  keep PDFs well under that for the browser's sake (large files take a
  while to base64-encode and upload from the page).
- **The admin link is hidden, not secret.** Removing it from the public
  page keeps casual visitors from noticing it, but `admin.html` is still
  a real, unauthenticated page — anyone who knows or guesses the URL can
  open it (they just can't do anything there without also having your
  GitHub token). If you want it truly hard to stumble on, you could
  rename the file to something less obvious (e.g. `admin-x7k2.html`) and
  bookmark that instead.
- **The token is powerful**: anyone who gets hold of it can write to
  your repo. Don't paste it into a shared/public computer, and you can
  revoke and regenerate it any time from GitHub's token settings if
  you're ever unsure.

## Icons

Each file can have an icon: pick one of three built-in presets (zombie
fist, map, question mark), or upload your own image.

- Shown at **48×48px**, so keep it **square** — a non-square image gets
  cropped to fit, not squished.
- **256×256px is plenty**; anything much bigger is wasted detail at that
  display size and just makes the repo heavier.
- PNG, JPG, or SVG all work. SVG is a nice choice for simple flat icons
  since it's tiny and stays crisp; use PNG/JPG for photos or anything
  with detail.
- Keep it small — a few KB to maybe 100KB. There's no hard enforced
  limit, but these get committed to your repo like everything else, so
  there's no reason for an icon to be several MB.

## "Resource not accessible by personal access token"

This means the token doesn't actually have write access, for one of a
few reasons:

- Its **Contents** permission is set to "Read-only" instead of
  "Read and write" — check this on the token's settings page.
- "Repository access" wasn't narrowed to your repo specifically —
  picking "Public repositories" only gives read access, never write.
- If the repo belongs to an **organization**, the org owner has to
  approve the token before it works (org Settings → Personal access
  tokens → pending requests).
- The repo has **no commits yet** — fine-grained tokens are known to
  fail on a totally empty repo. Make sure it has at least one commit
  (e.g. tick "Add a README" when creating it) before connecting.

If none of that resolves it, the reliable fallback is a **classic**
token instead: GitHub → Settings → Developer settings → Personal
access tokens → Tokens (classic) → generate one with the `repo` scope.
Classic tokens don't have the edge cases above — the trade-off is
broader access (all your repos, not just this one), which is a
reasonable trade for a personal project like this.

## Editing / removing files

On the admin page, click a file's name to expand it — change its name,
description, color, category, icon, or password (or tick "remove
existing password"), then save. Delete removes the file, its icon (if
custom — the three presets are shared and never deleted this way), and
its entry in one go.

## "X does not match Y" when saving

This is GitHub briefly returning a stale version right after a write —
not a real conflict, just its API catching up with itself. The admin
page now retries automatically a few times when it sees this, so it
should resolve itself; if you still see it after a few tries, wait a
moment and try again.

## Updating an already-deployed site

This update changes just two files: `index.html` (removes the admin
link) and `admin.js` (fixes the category-delete error). Upload/overwrite
those in your repo the same way as before.

**Do not overwrite `data/files.json` or `data/categories.json`** — those
hold your real, live data.
