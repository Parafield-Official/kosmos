const { convertWithMarkItDown } = require("./markitdown.cjs");

describe("Microsoft MarkItDown bridge", () => {
  it("converts supported manuscript formats and preserves Markdown structure", async () => {
    const calls = [];
    const markdown = await convertWithMarkItDown({
      sourcePath: "/tmp/book.docx",
      resourcesPath: "/tmp/resources",
      appPath: "/tmp/app",
      env: {},
      resolveCommand: (input) => {
        calls.push(input);
        return "/tmp/markitdown";
      },
      run: async (command, args) => {
        expect(command).toBe("/tmp/markitdown");
        expect(args).toEqual(["/tmp/book.docx"]);
        return Buffer.from("# Chapter 1\n\nThe opening line.\n", "utf8");
      },
    });

    expect(markdown).toBe("# Chapter 1\n\nThe opening line.\n");
    expect(calls[0]).toMatchObject({ name: "markitdown", envVar: "MARKITDOWN_PATH", requireBundled: false });
  });

  it("does not invoke MarkItDown for plain text", async () => {
    let invoked = false;
    await expect(convertWithMarkItDown({
      sourcePath: "/tmp/book.txt",
      resolveCommand: () => {
        invoked = true;
        return "markitdown";
      },
      run: async () => Buffer.from("unexpected", "utf8"),
    })).resolves.toBeNull();
    expect(invoked).toBe(false);
  });

  it("falls back cleanly when the optional helper is unavailable", async () => {
    await expect(convertWithMarkItDown({
      sourcePath: "/tmp/book.pdf",
      resolveCommand: () => "markitdown",
      run: async () => { throw new Error("command not found"); },
    })).resolves.toBeNull();
  });
});
