# Kosmos website

Static pages for authors and narrators. No build step. The
`feat/kosmos-website` branch deploys this directory to the organization's
GitHub Pages project site.

Open `site/index.html` in a browser, or from the repo root:

```sh
python3 -m http.server 4173 --directory site
```

Then visit `http://127.0.0.1:4173/`.

| File | Page |
|---|---|
| `index.html` | First viewport — cinematic landing |
| `about.html` | What Kosmos is, and is not |
| `features.html` | Record, Proofread, and Sound features |
| `compare.html` | One-project workflow versus separate tools |
| `faq.html` | Honest limits |
| `download.html` | Mac and Windows downloads, GitHub source |

Downloads point at the current GitHub Release. People on the first public installer should download once; later versions then install in the app. Source: <https://github.com/Parafield-Official/kosmos>.

GitHub Pages deployment is handled by `.github/workflows/pages.yml`. The site
is kept private with the repository until the public release.
