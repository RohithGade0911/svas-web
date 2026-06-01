# Svas — Regional Meal Planner (review build)

A tiny, fully-static website that:
1. **Meal Planner** — takes a user's details and generates a 7-day plan from Andhra, Telangana & Punjab home cooking, macro-balanced to their goal.
2. **Dish Database & Review** — lets a dietitian browse all 112 dishes (macros + ingredients + recipe), mark each **Pending / Approved / Needs fix** with notes (saved in the browser), and **export a review CSV**.

No backend, no build step, no dependencies — just static files, so it runs free on GitHub Pages.

## Files
| File | What |
|---|---|
| `index.html` · `styles.css` · `app.js` | the site (vanilla HTML/CSS/JS) |
| `data.js` | the whole food database bundled as `window.SVAS_DATA` (112 dishes) |
| `scripts/build_data.js` | dev tool — regenerates `data.js` from `../food-database/*.csv` |
| `.nojekyll` | tells GitHub Pages to serve files as-is |

## Run locally
Any static server works, e.g.:
```bash
cd svas-web
python3 -m http.server 4173
# open http://localhost:4173
```

## Update the data
If the dishes/macros change, regenerate the bundle and commit it:
```bash
node scripts/build_data.js   # rewrites data.js
```

## Deploy free on GitHub Pages
Deploy **only this folder** (the rest of the project has large PDFs/assets you don't want public).

```bash
cd svas-web
git init
git add .
git commit -m "Svas regional meal planner — review build"
git branch -M main
git remote add origin https://github.com/<your-username>/svas-web.git
git push -u origin main
```
Then on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `root` → Save.**

Your site goes live in ~1 minute at:
```
https://<your-username>.github.io/svas-web/
```
Share that link with the dietitian. Their review notes save in their own browser; they click **⬇ Export review CSV** to send their feedback back to you.

> Tip: with the GitHub CLI you can do it in one line — `gh repo create svas-web --public --source=. --push` — then enable Pages in Settings as above.
