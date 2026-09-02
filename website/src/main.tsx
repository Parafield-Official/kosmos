import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FadersIcon } from "@phosphor-icons/react/dist/csr/Faders";
import { FileAudioIcon } from "@phosphor-icons/react/dist/csr/FileAudio";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import "./index.css";

type Page = "home" | "about" | "features" | "workflow" | "faq" | "download";

const page = (document.documentElement.dataset.page ?? "home") as Page;
// The render plays forward and then returns to its opening frame, so the
// browser's native loop restarts without a visible cut.
const BACKGROUND_VIDEO = "kosmos-loop.mp4";
const RAINBOW = "https://soft-zoom-63098134.figma.site/_assets/v11/8d520a7515d06cbfc403d0125e3d05b1a7ccd29c.png";
const CLOUD = "https://soft-zoom-63098134.figma.site/_assets/v11/0d6dfd3f90b930f21726f2ed56a3320d79b7a797.png";
const REPO = "https://github.com/Parafield-Official/kosmos";
const RELEASES_PAGE = `${REPO}/releases/latest`;

type ReleaseDownloads = { mac: string; windows: string };

const fallbackDownloads: ReleaseDownloads = {
  mac: RELEASES_PAGE,
  windows: RELEASES_PAGE,
};

const navigation: Array<{ label: string; route: Page }> = [
  { label: "About", route: "about" },
  { label: "Features", route: "features" },
  { label: "Workflow", route: "workflow" },
  { label: "FAQ", route: "faq" },
];

function route(target: Page, fragment = "") {
  const href = target === "home" ? "" : `${target}/`;
  return `${page === "home" ? "./" : "../"}${href}${fragment}`;
}

function asset(name: string) {
  return `${page === "home" ? "./" : "../"}${name}`;
}

function isReleaseDownloads(value: unknown): value is ReleaseDownloads {
  if (!value || typeof value !== "object") return false;
  const downloads = value as Record<string, unknown>;
  return typeof downloads.mac === "string" && typeof downloads.windows === "string";
}

function useReleaseDownloads() {
  const [downloads, setDownloads] = useState<ReleaseDownloads>(fallbackDownloads);

  useEffect(() => {
    let current = true;
    void fetch(asset("updates/downloads.json"), { cache: "no-store" })
      .then((response) => response.ok ? response.json() : undefined)
      .then((value: unknown) => {
        if (current && isReleaseDownloads(value)) setDownloads(value);
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, []);

  return downloads;
}

function Button({ href, children, dark = false, className = "", external = false }: { href: string; children: ReactNode; dark?: boolean; className?: string; external?: boolean }) {
  return (
    <a href={href} className={`${dark ? "glass-button" : "light-button"} ${className}`} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

function BrandMark() {
  return (
    <a className="brand-mark" href={route("home")} aria-label="Kosmos home">
      <span className="brand-mark-content">
        <img className="brand-mark-logo" src={asset("kosmos-mark.png")} alt="" />
        <span className="brand-mark-name">Kosmos</span>
      </span>
    </a>
  );
}

function Navbar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 py-4 md:px-8 md:py-5">
      <div className="nav-float">
        <BrandMark />
        <button type="button" className={`menu-button ${open ? "is-open" : ""}`} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((value) => !value)}>
          <span /><span /><span />
        </button>
      </div>
      <div id="mobile-menu" className={`mobile-menu ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <div className="mt-28 flex h-[calc(100%-7rem)] flex-col px-8 pb-8">
          <p className="eyebrow mb-6">Navigate</p>
          {navigation.map((item, index) => (
            <a className="mobile-link" href={route(item.route)} key={item.label} style={{ transitionDelay: open ? `${150 + index * 75}ms` : "0ms" }}>{item.label}</a>
          ))}
          <Button href={route("download")} className="mt-auto w-full">Download</Button>
        </div>
      </div>
    </header>
  );
}

function AppleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.79 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.09M12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25" /></svg>;
}

function WindowsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.1 10.5 4v7.2H3V5.1Zm8.4-1.25L21 2.5v8.7h-9.6V3.85ZM3 12.1h7.5v7.2L3 18.2v-6.1Zm8.4 0H21v8.7l-9.6-1.35V12.1Z" /></svg>;
}

function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0608]">
      <video className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline preload="auto"><source src={asset(BACKGROUND_VIDEO)} type="video/mp4" /></video>
      <div className="absolute inset-0 bg-black/35" />
      <div className="hero-vignette absolute inset-0" />
      <div className="relative z-10 -mt-20 flex max-w-6xl flex-col items-center px-6 text-center md:-mt-28">
        <p className="eyebrow mb-6">A human audiobook studio</p>
        <h1 className="font-instrument text-glow text-[50px] leading-[0.9] tracking-tight text-white sm:text-6xl md:text-8xl lg:text-[108px]">
          Record. Proofread. Master.<br /><em className="font-normal">One app.</em>
        </h1>
        <p className="mt-7 max-w-2xl text-sm leading-6 text-white/70 md:text-base md:leading-7">
          A free desktop studio with a built-in teleprompter that follows your voice. Record, proofread, master, and export every audiobook.
        </p>
        <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row">
          <Button href={route("download", "#mac")} className="flex-1"><AppleIcon /><span>Mac</span></Button>
          <Button href={route("download", "#windows")} dark className="flex-1"><WindowsIcon /><span>Windows</span></Button>
        </div>
        <Button href={REPO} dark external className="github-button mt-3">
          <GithubLogoIcon weight="fill" aria-hidden="true" />
          <span>View Kosmos on GitHub</span>
        </Button>
      </div>
      <div className="absolute bottom-8 right-8 hidden gap-8 text-xs uppercase tracking-[0.18em] text-white/50 md:flex"><span>Local</span><span>Open source</span><span>$0</span></div>
    </section>
  );
}

function QuoteSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const rainbowRef = useRef<HTMLImageElement>(null);
  const leftRef = useRef<HTMLImageElement>(null);
  const rightRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let rainbowY = 120;
    let leftX = -200;
    let rightX = 200;
    let cloudY = 0;
    const lerp = (current: number, target: number, factor: number) => current + (target - current) * factor;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));

    const animate = () => {
      const section = sectionRef.current;
      if (section) {
        const rect = section.getBoundingClientRect();
        const progress = clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height));
        const reveal = clamp((progress - .12) / .8);
        const targetLeft = -200 + reveal * 255;
        const targetRight = 200 - reveal * 255;
        rainbowY = lerp(rainbowY, 120 + progress * -280, .06);
        leftX = lerp(leftX, targetLeft, .04);
        rightX = lerp(rightX, targetRight, .04);
        cloudY = lerp(cloudY, progress * -50, .04);
        if (rainbowRef.current) rainbowRef.current.style.transform = `translate3d(0, ${rainbowY}px, 0)`;
        if (leftRef.current) {
          leftRef.current.style.transform = `translate3d(${leftX}px, ${cloudY}px, 0)`;
          leftRef.current.style.opacity = String(clamp(1 - Math.abs(leftX - 55) / 255));
        }
        if (rightRef.current) {
          rightRef.current.style.transform = `translate3d(${rightX}px, ${cloudY}px, 0) scaleX(-1)`;
          rightRef.current.style.opacity = String(clamp(1 - Math.abs(rightX + 55) / 255));
        }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section ref={sectionRef} className="quote-section relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-32">
      <img ref={rainbowRef} className="pointer-events-none absolute inset-x-0 top-0 z-30 w-full will-change-transform" src={RAINBOW} alt="" />
      <img ref={leftRef} className="cloud cloud-left pointer-events-none absolute bottom-[8%] left-0 z-10 hidden w-[500px] opacity-0 will-change-transform sm:block md:w-[650px]" src={CLOUD} alt="" />
      <img ref={rightRef} className="cloud cloud-right pointer-events-none absolute bottom-[14%] right-0 z-10 hidden w-[500px] opacity-0 will-change-transform sm:block md:w-[650px]" src={CLOUD} alt="" />
      <div className="relative z-20 max-w-4xl text-center">
        <p className="eyebrow mb-8 text-white/65">From manuscript to audiobook</p>
        <h2 className="font-instrument text-2xl font-normal leading-[1.45] text-white sm:text-3xl md:text-4xl md:leading-[1.5] lg:text-[42px]">
          Every story deserves to be heard exactly as you imagined it. Record with confidence, catch mistakes before listeners do, polish every chapter, and turn your manuscript into an audiobook you’re proud to share.
        </h2>
        <p className="mt-8 text-sm tracking-wide text-white/75 md:text-base">Kosmos · Your story, ready to be heard</p>
      </div>
    </section>
  );
}

function PageBackdrop() {
  return (
    <div className="page-backdrop" aria-hidden="true">
      <video autoPlay muted loop playsInline preload="metadata"><source src={asset(BACKGROUND_VIDEO)} type="video/mp4" /></video>
      <span className="page-backdrop-shade" />
      <img className="page-backdrop-rainbow" src={RAINBOW} alt="" />
      <img className="page-backdrop-cloud page-backdrop-cloud-left" src={CLOUD} alt="" />
      <img className="page-backdrop-cloud page-backdrop-cloud-right" src={CLOUD} alt="" />
    </div>
  );
}

function PageHero({ kicker, title, lead }: { kicker: string; title: ReactNode; lead: string }) {
  return (
    <header className="page-hero">
      <p className="eyebrow mb-6">{kicker}</p>
      <h1 className="font-instrument page-title text-glow">{title}</h1>
      <p className="page-lead">{lead}</p>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <a className="footer-brand font-script" href={route("home")}>Kosmos</a>
      <p>Free · local · open source · human-made</p>
      <div><a href={REPO} target="_blank" rel="noreferrer">GitHub</a><a href={route("download")}>Download</a></div>
    </footer>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return <div className="site-page"><Navbar /><PageBackdrop /><main className="page-wrap">{children}</main><Footer /></div>;
}

const notItems = [
  ["Not a multitrack production desk", "Kosmos records chapters and punches, and it can import audio from the editor you already use. It is built around the audiobook workflow, not open-ended music production."],
  ["Not a substitute for your ears", "Proofreading checks the words and Sound checks delivery specs. You still make the final call on acting, character, pacing, and listening quality."],
  ["Not an AI narrator", "It will not read the book or clone a voice. This is for a human recording."],
];

const aboutStages = [
  { name: "Record with the teleprompter", copy: "The built-in teleprompter follows your voice and lights the current word, with room check, chapter takes, and line punches.", Icon: FileAudioIcon },
  { name: "Proofread", copy: "Every mismatch stays connected to its place on the page and its audio, so each pickup is easy to review.", Icon: FileTextIcon },
  { name: "Sound", copy: "Master, listen, check delivery specs, and prepare the finished audiobook pack.", Icon: FadersIcon },
];

function AboutPage() {
  return (
    <PageShell>
      <PageHero kicker="About" title={<>One free app<br /><em>for your audiobooks.</em></>} lead="Import the manuscript. Record with a built-in teleprompter that follows your voice, or bring audio you already have. Kosmos proofreads the words, masters the sound, and packs the finished title for ACX." />
      <section className="editorial-grid">
        <article className="content-card liquid-glass editorial-intro">
          <p className="eyebrow">What you use it for</p>
          <h2 className="font-instrument">The whole audiobook workflow, held together.</h2>
          <p>Kosmos keeps every chapter in one clear place. Read from the built-in teleprompter as it follows your voice, review every flagged line with its audio, then polish the sound for delivery.</p>
          <p>You can punch a line without starting the chapter again, import an existing take, and export a named delivery pack when the title is ready. Authors and narrators can also work from the same project.</p>
        </article>
        <div className="stage-stack">
          {aboutStages.map(({ name, copy, Icon }) => (
            <article className="stage-card liquid-glass" key={name}>
              <div className="stage-copy"><h3>{name}</h3><p>{copy}</p></div>
              <span className="stage-mark" aria-hidden="true"><Icon weight="regular" /></span>
            </article>
          ))}
        </div>
      </section>
      <section className="section-block">
        <p className="eyebrow">What Kosmos is not</p>
        <div className="card-grid three">{notItems.map(([title, copy]) => <article className="content-card liquid-glass not-card" key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>
      <ClosingPanel />
    </PageShell>
  );
}

const narratorFeatures = [
  ["A teleprompter that follows your voice", "Read the book as written, including italics, bold, and highlights. The current word lights up as you speak, and you can always scroll by hand."],
  ["Proofread against the manuscript", "Skip, add, or swap a word and Kosmos flags the line. Review every mismatch after the take, with its audio and place on the page."],
  ["Fix a line without restarting the chapter", "Punch the flagged line inside Kosmos, or export markers for the audio editor you already use."],
  ["Check the room before chapter one", "Record a few seconds of silence. Kosmos tells you if the room will pass after loudness before you record the whole book."],
  ["Master for delivery", "See the loudness, true peak, noise floor, format, and room-tone result for every chapter. Export named files, credit slots, and a retail sample when the title is ready."],
  ["Two voices, one story", "Each person keeps their own seat. Record the bed, then the other voice, and fix only your lines. Either record in Kosmos or bring takes from another editor."],
];

const authorFeatures = [
  ["The book, split into chapters", "Import the manuscript. Split, merge, and rename. You are not scrolling a 400-page PDF."],
  ["How to say the names", "A draft list of the hard words. You keep, cut, and merge it. Record a short clip for anything a stranger would misread. The narrator hears you, not a guess."],
  ["Did they say your book?", "Each missed word shows the page, what was heard, and Play. Mark it done, needs a fix, or ignore. Leave a note on the line."],
  ["Work the same book, no marketplace", "Save a name and a role. Send a live invite. The other person can join from hotel Wi-Fi or a phone hotspot. No store in the middle."],
  ["The book stays here", "No account. No upload of the unpublished book. What you share goes only to the person you invited."],
  ["Credits and a retail sample", "The export has slots for opening, closing, and a sample that starts on the story. You record those. Kosmos keeps them in the pack."],
];

function FeatureColumn({ title, features }: { title: string; features: string[][] }) {
  return <section><h2 className="font-instrument column-title">{title}</h2><div className="feature-list">{features.map(([name, copy], index) => <article className="feature-row" key={name}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{name}</h3><p>{copy}</p></div></article>)}</div></section>;
}

function FeaturesPage() {
  return (
    <PageShell>
      <PageHero kicker="Features" title={<>For narrators<br /><em>and authors.</em></>} lead="Read from a built-in teleprompter that follows your voice, record or import existing audio, and move from manuscript to mastered chapters in one free desktop app." />
      <div className="feature-columns"><FeatureColumn title="For narrators" features={narratorFeatures} /><FeatureColumn title="For authors" features={authorFeatures} /></div>
      <p className="honesty-note">Proofread checks the words. Sound checks measurable delivery specs and applies bounded cleanup. A human still listens for performance and anything automation misses.</p>
      <ClosingPanel />
    </PageShell>
  );
}

const workflowRows = [
  ["Prepare the manuscript", "Import once, then split, merge, rename, and keep rich text", "Reformat or upload the script again for each service"],
  ["Record the chapter", "Built-in voice-following teleprompter, room check, chapter takes, and punches", "Record elsewhere and move files between apps"],
  ["Bring existing audio", "Import a finished take and continue with Proofread", "Depends on each tool’s handoff format"],
  ["Proofread and fix", "Flags stay attached to the line, audio, notes, and pickup", "Move timestamps and notes between services"],
  ["Master and deliver", "Check ACX or EBU, master, listen, and export the title pack", "Meter, process, rename, and pack in separate steps"],
];

function WorkflowPage() {
  return (
    <PageShell>
      <PageHero kicker="Workflow" title={<>Your whole library.<br /><em>One continuous workflow.</em></>} lead="Import the manuscript, read from the built-in teleprompter, proofread, master, and export without rebuilding the title in a different service at every step." />
      <section className="price-panel liquid-glass"><strong className="font-instrument">$0</strong><div><p className="eyebrow">Free and open source</p><p>Kosmos is built for local projects. No account, subscription, or per-finished-hour meter.</p></div></section>
      <section className="workflow-table liquid-glass" aria-label="Workflow comparison">
        <div className="workflow-row workflow-head"><span>The step</span><span>In Kosmos</span><span>With separate tools</span></div>
        {workflowRows.map((row, index) => <div className={`workflow-row ${index === 3 ? "is-highlighted" : ""}`} key={row[0]}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>)}
      </section>
      <p className="honesty-note">Kosmos includes an audiobook-focused recorder and accepts audio from another editor. It is not a general-purpose multitrack music workstation.</p>
      <ClosingPanel />
    </PageShell>
  );
}

const faqs = [
  ["Is Kosmos free?", "Yes. $0. MIT license. No account, no trial clock, no per-finished-hour meter. Download the Mac or Windows build, or clone the source."],
  ["Does my book leave this computer?", "Manuscript prep, the teleprompter, proofreading, delivery checks, mastering, and export all run locally. There is no sign-in and no cloud copy of the manuscript. Live together is an invite between two desks you choose, including hotel Wi-Fi and a phone hotspot. It is not a store or an upload."],
  ["Is this an AI narrator?", "No. Kosmos never reads the book and never clones a voice. It is a desk for a human take against a human manuscript."],
  ["Does Kosmos include a teleprompter?", "Yes. The built-in teleprompter follows your voice and highlights the current word as you speak, while keeping the manuscript’s formatting on screen. You can pause, resume, or scroll by hand at any time."],
  ["Can I record in Kosmos?", "Yes. Each chapter has a recorder, voice-following teleprompter, room check, take controls, and line punches. You can also import audio recorded in Reaper, Audition, or another editor. Kosmos is an audiobook studio, not a general-purpose multitrack music workstation."],
  ["What will it catch?", "Proofread flags words that do not match the page and long mid-sentence pauses. Sound measures delivery specs such as loudness, true peak, noise floor, format, and room tone, then applies bounded cleanup and mastering. A human still listens for performance and anything automation misses."],
  ["How do an author and a narrator share a book?", "Save a name and a role. Create an invite with a code plus three spoken words. The other desk joins with the reply. You work the same project: notes, pickups, names, takes. No zip pack required for the live path. If a network blocks the live link, you can still hand the project folder across."],
  ["What happens during first-time setup?", "Kosmos asks for microphone access and a project-folder location, then checks that its local proofreading tool is ready. Release builds include the required tools; if a model is missing, setup downloads it once. After setup, recording, proofreading, mastering, and export run locally."],
  ["Mac or Windows?", "Both. The Apple silicon Mac release is signed and notarized by Apple. The 64-bit Windows installer is currently unsigned, so SmartScreen may require More info, then Run anyway."],
  ["How do I get a new version?", "Installed copies check GitHub for a later release and download it in the background. Restart when you are not recording. Your book folders are unchanged."],
];

function FaqPage() {
  return (
    <PageShell>
      <PageHero kicker="FAQ" title={<>Straight answers<br /><em>for the booth.</em></>} lead="Kosmos gives human narrators a built-in voice-following teleprompter, recording, proofreading, and mastering. Everything runs locally, with the final creative judgment left to you." />
      <section className="faq-list">{faqs.map(([question, answer], index) => <details className="faq-item liquid-glass" key={question} open={index === 0}><summary><span>{question}</span><i aria-hidden="true" /></summary><p>{answer}</p></details>)}</section>
      <div className="page-actions"><Button href={`${REPO}/issues`} dark external>Open an issue</Button><Button href={route("download")}>Download</Button></div>
    </PageShell>
  );
}

function DownloadCard({ id, title, label, copy, href, icon }: { id: string; title: string; label: string; copy: string; href: string; icon: ReactNode }) {
  return (
    <article className="download-card liquid-glass" id={id}>
      <div className="platform-mark">{icon}</div><p className="eyebrow">{label}</p><h2 className="font-instrument">{title}</h2><p>{copy}</p>
      <Button href={href} className="w-full"><span>Download</span></Button>
    </article>
  );
}

function DownloadPage({ downloads }: { downloads: ReleaseDownloads }) {
  return (
    <PageShell>
      <PageHero kicker="For narrators" title={<>Set up Kosmos.<br /><em>Start your next chapter.</em></>} lead="Choose your computer, bring in your manuscript, and settle into a quiet local space for recording. Your teleprompter follows your voice, while your book and takes stay on your desk." />
      <section className="download-grid">
        <DownloadCard id="mac" label="macOS" title="Download for Mac" copy="Apple silicon. Open the download and drag Kosmos to Applications. This release is signed and notarized by Apple." href={downloads.mac} icon={<AppleIcon />} />
        <DownloadCard id="windows" label="Windows" title="Download for Windows" copy="64-bit Windows 10 or later. The installer is currently unsigned, so SmartScreen may require More info, then Run anyway." href={downloads.windows} icon={<WindowsIcon />} />
      </section>
      <section className="source-panel liquid-glass"><div><p className="eyebrow">Before your first take</p><h2 className="font-instrument">Get comfortable, then press Record.</h2><p>Kosmos keeps your script, takes, notes, and audio files local. Allow microphone access, choose a quiet room, and record your first chapter when you are ready.</p></div><Button href={route("features")} dark>Explore narrator tools</Button></section>
      <section className="section-block"><p className="eyebrow">Your first recording</p><div className="card-grid three">{[["Bring in your manuscript", "Choose your audiobook manuscript and a local folder. Kosmos splits it into chapters and keeps your work together."], ["Set up for your first take", "Allow microphone access, choose a chapter, and let the voice-following teleprompter keep your place while you read."], ["Review, then finish the chapter", "Listen back, correct a line if you need to, then proofread and master once you are happy with the take."]].map(([title, copy]) => <article className="content-card liquid-glass" key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    </PageShell>
  );
}

function ClosingPanel() {
  return <section className="closing-panel"><div><p className="eyebrow">Free · local · human-made</p><h2 className="font-instrument">Record. Proofread. Master.<br /><em>One app.</em></h2></div><div className="page-actions"><Button href={route("download")}>Download</Button><Button href={REPO} dark external>View on GitHub</Button></div></section>;
}

function App() {
  const downloads = useReleaseDownloads();
  if (page === "home") return <div className="bg-[#0a0608]"><Navbar /><Hero /><QuoteSection /><Footer /></div>;
  if (page === "about") return <AboutPage />;
  if (page === "features") return <FeaturesPage />;
  if (page === "workflow") return <WorkflowPage />;
  if (page === "faq") return <FaqPage />;
  return <DownloadPage downloads={downloads} />;
}

createRoot(document.getElementById("root")!).render(<App />);
