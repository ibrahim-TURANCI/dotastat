/**
 * GET /api/release
 *
 * "Masaustu surumunu indir" butonunun arkasindaki uc. En son GitHub
 * Release'ini bulur ve Windows kurulum dosyasinin adresini dondurur.
 *
 * Ortam degiskeni: GITHUB_REPO = "kullanici/repo"
 */

import { fail, json } from "./_lib/respond.mjs";

const GITHUB_API = "https://api.github.com";

export default async (request) => {
  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  const repo = String(process.env.GITHUB_REPO || "").trim();
  if (!repo) {
    return json({
      ok: true,
      available: false,
      reason: "GITHUB_REPO tanimli degil",
    });
  }

  try {
    const headers = { accept: "application/vnd.github+json" };
    // Genel repo icin token gerekmez; ozel repoda veya limit asiminda kullanilir.
    if (process.env.GITHUB_TOKEN) {
      headers.authorization = "Bearer " + process.env.GITHUB_TOKEN;
    }

    const response = await fetch(
      GITHUB_API + "/repos/" + repo + "/releases/latest",
      { headers },
    );

    if (response.status === 404) {
      return json({ ok: true, available: false, reason: "henuz-release-yok" });
    }
    if (!response.ok) {
      return fail("github-" + response.status, { status: 502 });
    }

    const payload = await response.json();
    const asset = (payload.assets || []).find((row) =>
      String(row?.name || "")
        .toLowerCase()
        .endsWith(".exe"),
    );

    return json(
      {
        ok: true,
        available: Boolean(asset),
        version: String(payload.tag_name || "").replace(/^v/, ""),
        publishedAt: payload.published_at || "",
        releaseUrl: payload.html_url || "",
        notes: String(payload.body || "").slice(0, 2000),
        download: asset
          ? {
              name: asset.name,
              url: asset.browser_download_url,
              sizeBytes: Number(asset.size || 0),
            }
          : null,
      },
      { cacheSeconds: 600 },
    );
  } catch (error) {
    return fail("release-bilgisi-alinamadi", {
      status: 502,
      message: String(error?.message || error),
    });
  }
};
