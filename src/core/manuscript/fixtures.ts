import { strToU8, zipSync } from "fflate";

/** Small, invented books exercising publisher structures without customer text. */
export function epubFixture(files: Record<string, string>, options: {
  spine?: string[];
  nav?: string;
  ncx?: string;
} = {}): Uint8Array {
  const names = Object.keys(files);
  const manifest = names.map((name, index) =>
    `<item id="item${index}" href="${encodeURI(name)}" media-type="${name.endsWith('.html') ? 'text/html' : 'application/xhtml+xml'}"/>`,
  ).join("");
  return zipSync(Object.fromEntries(Object.entries({
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    "OPS/book.opf": `<package><manifest>${manifest}
      ${options.nav ? '<item id="nav" href="navigation.xhtml" properties="nav" media-type="application/xhtml+xml"/>' : ''}
      ${options.ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}
      </manifest><spine toc="ncx">${(options.spine ?? names).map(name => `<itemref idref="item${names.indexOf(name)}"/>`).join('')}</spine></package>`,
    ...Object.fromEntries(Object.entries(files).map(([name, text]) => [`OPS/${name}`, text])),
    ...(options.nav ? { "OPS/navigation.xhtml": `<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc">${options.nav}</nav></body></html>` } : {}),
    ...(options.ncx ? { "OPS/toc.ncx": `<ncx><navMap>${options.ncx}</navMap></ncx>` } : {}),
  }).map(([name, text]) => [name, strToU8(text)])));
}

export function philosophyFixture(): Uint8Array {
  return epubFixture({
    "works.xhtml": `<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
      <section id="discourse"><h2>Discourse on the Method</h2>
        <section id="preface"><h3>Prefatory Note</h3><p>This introduction explains the method.</p></section>
        <section id="part-1"><h4><span>Part</span>\n <span>I</span></h4><p>Reason begins with a careful question.</p></section>
        <section id="part-2"><h4>Part II</h4><p>Inquiry continues with another question.</p></section>
      </section>
      <section id="meditations"><h2>Meditations on the First Philosophy</h2>
        <section id="meditation-1"><hgroup><h4><span>Meditation</span>\n <span>I</span></h4><p epub:type="subtitle">Of Doubt</p></hgroup><p>The first meditation examines our beliefs.</p></section>
        <section id="meditation-2"><h4>Meditation II</h4><p>The second meditation examines the mind.</p></section>
      </section></body></html>`,
    "appendix.xhtml": '<html><body><h2>Appendix</h2><p>Here is the final passage.</p></body></html>',
  }, { nav: '<ol><li><a href="works.xhtml#discourse">Discourse on the Method</a><ol><li><a href="works.xhtml#preface">Prefatory Note</a></li><li><a href="works.xhtml#part-1">Part I</a></li><li><a href="works.xhtml#part-2">Part II</a></li></ol></li><li><a href="works.xhtml#meditations">Meditations on the First Philosophy</a><ol><li><a href="works.xhtml#meditation-1">Meditation I: Of Doubt</a></li><li><a href="works.xhtml#meditation-2">Meditation II</a></li></ol></li><li><a href="appendix.xhtml">Appendix</a></li></ol>' });
}
