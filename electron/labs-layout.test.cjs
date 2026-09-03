const { readFileSync } = require("node:fs");
const path = require("node:path");

describe("shipping pronunciation layout", () => {
  it("allocates grip, word, guide, and action columns for reorderable rows", () => {
    const css = readFileSync(
      path.join(__dirname, "../labs/next/src/main-app/main-app.css"),
      "utf8",
    );
    const rule = css.match(/\.ma-glossary-list li\s*\{([^}]+)\}/u)?.[1] ?? "";
    expect(rule).toMatch(
      /grid-template-columns:\s*auto\s+minmax\(5\.5rem,\s*10rem\)\s+var\(--ma-guide-field,\s*6\.25rem\)\s+auto/u,
    );
    expect(css).toMatch(/\.ma-glossary-list li:not\(:has\(\.ma-block-grip\)\)/u);
  });
});
