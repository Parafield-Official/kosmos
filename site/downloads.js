(() => {
  const allowedPrefix = "https://github.com/Parafield-Official/kosmos/releases/download/";

  fetch("updates/downloads.json", {
    cache: "no-store",
    credentials: "omit",
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Update manifest returned ${response.status}`);
      return response.json();
    })
    .then((downloads) => {
      for (const platform of ["mac", "windows"]) {
        const url = downloads[platform];
        if (typeof url !== "string" || !url.startsWith(allowedPrefix)) continue;
        const link = document.querySelector(`[data-kosmos-download="${platform}"]`);
        if (link) link.href = url;
      }
      if (typeof downloads.version === "string" && /^\d+\.\d+\.\d+/.test(downloads.version)) {
        document.querySelectorAll("[data-kosmos-version]").forEach((node) => {
          node.textContent = downloads.version;
        });
      }
    })
    .catch(() => {
      // Keep the release link embedded in the page as an offline-safe fallback.
    });
})();
