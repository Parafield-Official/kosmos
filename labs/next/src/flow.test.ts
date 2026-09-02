import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, CONTACT_MAILTO, INTRO_DISCORD } from "./flow";

describe("community links", () => {
  it("keeps the public Discord invite on the onboarding join", () => {
    expect(INTRO_DISCORD).toBe("https://discord.gg/g4aVz59mQ9");
  });

  it("exposes Justin's email only as a settings mailto", () => {
    expect(CONTACT_EMAIL).toBe("justin@parafield.ai");
    expect(CONTACT_MAILTO).toBe("mailto:justin@parafield.ai");
  });
});
