# Manuscript import audit — September 7, 2026

The supplied `rene-descartes_philosophical-works_john-veitch.epub` reproduced the reported problem. Before the fix, the active upload pipeline produced one `Chapter 1` with 97,604 words. The book's text was extracted, but all chapter boundaries were lost.

## Cause

`src/core/manuscript/import.ts` previously stripped EPUB XHTML tags and concatenated reading-order documents into one plain string. It discarded headings, section IDs, file boundaries, and navigation links. `labs/next/src/main-app/analyze.ts` then sent that flattened string to the text heuristic, which recognized a narrow, hard-coded set of labels such as `Chapter`, `Prologue`, and `Epilogue`. It did not understand this book's nested Parts, Meditations, or Roman-numbered sections. The single-chapter result was the fallback for unrecognized structure, not a one-chapter limit or a special case for this book.

The shipped entry point is `electron/labs.cjs`. Its EPUB and DOCX uploads use the local TypeScript parser, not MarkItDown. PDFs use the MarkItDown bridge with a `pdftotext` fallback. The older `electron/main.cjs` path did prefer MarkItDown for EPUB/DOCX; that path now also uses the structured parser so behavior does not depend on whether the converter is installed.

## Changes

- EPUB import retains publisher-defined navigation targets and offsets through chapter creation. It reads EPUB 3 navigation and EPUB 2 NCX, resolves encoded paths and fragment IDs, follows the OPF spine, and falls back to heading hierarchy or document boundaries where navigation is absent. Heading groups keep subtitles with their titles. Parent titles are retained in the next script instead of discarded as empty chapters. Nested links to numbered sections remain available as separate sections.
- Partial or broken navigation can fall back to document headings. Missing supported documents in the spine now produce an error instead of a silently incomplete import. Namespaced markup and extensionless manifest documents are supported.
- DOCX import reads outline/heading styles, including custom inherited styles, keeps lower-level subheadings inside chapters, preserves run emphasis in the teleprompter, and excludes field instructions/deleted revisions. Text-box paragraphs are read once.
- Text fallback recognizes Parts, Meditations, and isolated Roman headings. Contents-list detection requires supporting evidence, so three short real chapters are no longer collapsed. Chapter-shaped ordinary prose is less likely to become a false heading. UTF-16 BOMs are supported.
- Rich-format prose is escaped as text rather than interpreted again as Markdown, preserving literal asterisks and underscores. Entity decoding happens once.
- Fresh-file import and saved-book re-analysis use the same structured byte path. The legacy browser/desktop importers use the same splitting helper.
- Metadata and cover previews no longer expand the entire archive. Selected entries are bounded before decompression; the existing manuscript archive budgets remain enforced. `@xmldom/xmldom`, already present as a transitive development dependency, is now pinned as a production dependency for the shared local DOM parser.
- New chapter script files are saved before publishing their chapter IDs. Desktop failure responses and hosted storage errors now propagate instead of reporting a successful import with missing scripts. Existing chapter metadata remains intact if script saving fails.

The structural EPUB behavior follows the [W3C EPUB navigation and reading-order model](https://www.w3.org/TR/epub-33/). No book title, author name, or expected chapter count is embedded in production detection logic.

## Verification

The actual supplied EPUB now produces **148 navigable sections**, including all six Discourse Parts, all six Meditations, the 124 numbered Principles sections, introductory material, and back matter. Titles/subtitles with no independent body attach to the following section.

- All **97,604 source words** are retained.
- Reconstructing chapter ranges reproduces the entire extracted source in order, allowing whitespace normalization only.
- Concatenating the final teleprompter HTML reproduces the same source text under that same whitespace normalization. This checks headings and body text, not just matching word counts.
- Fresh uploads and stored-byte re-analysis produce identical titles, word counts, and script HTML.
- Focused import/analysis/metadata/save suite: **53 tests passed**.
- Full suite: **1,070 tests passed across 143 files**.
- Production build, TypeScript checking, and `git diff --check` passed. Vite still reports its existing chunk-size/dynamic-import warnings.

Reproduce against any local EPUB without creating or altering a project:

```sh
npx jiti scripts/verify-manuscript.ts /path/to/book.epub
```

The regression fixtures contain invented text and publisher-like structure. The user's EPUB was read locally for verification and was not added to the repository or uploaded elsewhere.

## Delivery and limits

The fixes are in the workspace and the production build has been generated. No installer was published and no existing customer project was rewritten. Previously imported single-chapter projects need to be imported or re-analyzed using a build containing this change; the existing re-analysis confirmation warns about replacing chapter state and recordings.

Unstructured TXT and extracted PDF text still require heuristics. A book with no usable headings or structural metadata can legitimately remain one section. Image-only PDFs still need OCR before this pipeline can read them. EPUB sections are derived from the publisher's navigation; deeply subdivided books can consequently expose more sections than their top-level literary chapters.
