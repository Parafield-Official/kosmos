# Kosmos website

Static pages for authors and narrators. No build step.

Open `site/index.html` in a browser, or from the repo root:

```sh
python3 -m http.server 4173 --directory site
```

Then visit `http://127.0.0.1:4173/`.

| File | Page |
|---|---|
| `index.html` | First viewport — cinematic landing |
| `about.html` | What Kosmos is, and is not |
| `features.html` | Narrator and author jobs |
| `compare.html` | PromptVO / Pozotron / chapterpass / Hindenburg |
| `faq.html` | Honest limits |
| `download.html` | Mac `.dmg`, Windows `.exe`, GitHub |

GitHub Pages serves the website and the small, checksummed update feed. Download buttons and installed copies use that feed to retrieve the current installers from GitHub Release assets. The source repository can remain private during development; downloads become public when the repository is opened for launch. Source: <https://github.com/Parafield-Official/kosmos>.
