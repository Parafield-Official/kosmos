import { useState } from "react";
import {
  COMMUNITY_HEADING,
  COMMUNITY_POINT_1_BODY,
  COMMUNITY_POINT_1_TITLE,
  COMMUNITY_POINT_2_BODY,
  COMMUNITY_POINT_2_TITLE,
  INTRO_DISCORD,
  INTRO_DISCORD_APP,
  INTRO_GITHUB,
} from "./flow";

const POINTS = [
  { title: COMMUNITY_POINT_1_TITLE, body: COMMUNITY_POINT_1_BODY },
  { title: COMMUNITY_POINT_2_TITLE, body: COMMUNITY_POINT_2_BODY },
];

export function CommunityScreen({ onComplete }: { onComplete: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyGithubLink() {
    try {
      await navigator.clipboard.writeText(INTRO_GITHUB);
    } catch {
      const input = document.createElement("textarea");
      input.value = INTRO_GITHUB;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="intro flow-screen community-screen" aria-label="Community">
      <div className="community-stack">
        <h2 className="community-heading">{COMMUNITY_HEADING}</h2>

        <ul className="community-points">
          {POINTS.map((point) => (
            <li key={point.title} className="community-point">
              <div className="community-point-panel">
                <div className="community-point-head">
                  <span className="community-point-title">{point.title}</span>
                  <CommunityPointMark />
                </div>
                <div className="community-point-body">
                  <div className="community-point-body-inner">
                    <p className="community-point-copy">{point.body}</p>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="community-actions">
          <button
            type="button"
            className="community-action community-action-discord"
            onClick={() => void openDiscord()}
          >
            <span className="community-action-icon" aria-hidden="true">
              <DiscordIcon />
            </span>
            <span className="community-action-label">Let&rsquo;s go!</span>
          </button>

          <button
            type="button"
            className={copied ? "community-action community-action-github copied" : "community-action community-action-github"}
            aria-label={copied ? "GitHub link copied" : "Copy GitHub repository link"}
            onClick={() => void copyGithubLink()}
          >
            <span className="community-action-icon community-action-icon-github" aria-hidden="true" />
            <span className="community-action-label">{copied ? "Copied!" : "Copy link"}</span>
          </button>
        </div>

        <div className="community-foot">
          <span className="community-foot-line" aria-hidden="true" />
          <button type="button" className="community-continue" onClick={onComplete}>
            Continue
          </button>
          <span className="community-foot-line" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

async function openDiscord() {
  const open = window.kosmosNext?.openDiscord;
  if (open) {
    await open({ appUrl: INTRO_DISCORD_APP, webUrl: INTRO_DISCORD });
    return;
  }

  let leftPage = false;
  const markHidden = () => {
    if (document.hidden) {
      leftPage = true;
    }
  };
  document.addEventListener("visibilitychange", markHidden);
  const probe = document.createElement("a");
  probe.href = INTRO_DISCORD_APP;
  probe.style.display = "none";
  document.body.appendChild(probe);
  probe.click();
  probe.remove();
  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", markHidden);
    if (!leftPage && !document.hidden) {
      window.open(INTRO_DISCORD, "_blank", "noopener,noreferrer");
    }
  }, 900);
}

function CommunityPointMark() {
  return (
    <span className="community-point-mark" aria-hidden="true">
      <svg className="community-point-mark-plus" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <svg className="community-point-mark-minus" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
