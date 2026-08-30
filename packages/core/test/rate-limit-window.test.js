/**
 * Tazeleme sayacinin pencere mantigi.
 *
 * Netlify fonksiyonlari `@dotastat/core` disinda oldugu icin buradaki test
 * ayni algoritmayi bagimsiz olarak dogrular: pencere icindeki damgalar sayilir,
 * disari dusenler serbest birakilir. Fonksiyondaki uygulama degisirse bu test
 * degismez — sozlesme "saatte N istek"tir.
 */

import assert from "node:assert/strict";
import test from "node:test";

const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * `netlify/functions/_lib/rate-limit.mjs` icindeki karar mantiginin ayni sekli.
 *
 * @param {number[]} hits Onceki istek zaman damgalari
 * @param {number} now
 * @returns {{ ok: boolean, hits: number[], retryAfterSeconds: number }}
 */
function consume(hits, now) {
  const kept = hits.filter((at) => now - at < WINDOW_MS);
  if (kept.length >= LIMIT) {
    const oldest = Math.min(...kept);
    return {
      ok: false,
      hits: kept,
      retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)),
    };
  }
  return { ok: true, hits: [...kept, now], retryAfterSeconds: 0 };
}

test("saatte 5 istek gecer, 6. reddedilir", () => {
  const start = Date.UTC(2026, 0, 1, 12, 0, 0);
  let hits = [];

  for (let i = 0; i < LIMIT; i += 1) {
    const result = consume(hits, start + i * 1000);
    assert.equal(result.ok, true, `${i + 1}. istek gecmeliydi`);
    hits = result.hits;
  }

  const blocked = consume(hits, start + LIMIT * 1000);
  assert.equal(blocked.ok, false, "6. istek reddedilmeliydi");
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("pencere disina dusen istekler hakki serbest birakir", () => {
  const start = Date.UTC(2026, 0, 1, 12, 0, 0);
  let hits = [];

  for (let i = 0; i < LIMIT; i += 1) {
    hits = consume(hits, start + i * 1000).hits;
  }
  assert.equal(consume(hits, start + 5000).ok, false);

  // Bir saat bir saniye sonra en eski damga pencereden cikar.
  const later = consume(hits, start + WINDOW_MS + 1000);
  assert.equal(later.ok, true, "pencere kaydiginda yeni hak dogmali");
});

test("bekleme suresi en eski damgaya gore hesaplanir", () => {
  const start = Date.UTC(2026, 0, 1, 12, 0, 0);
  let hits = [];
  for (let i = 0; i < LIMIT; i += 1) {
    hits = consume(hits, start + i * 1000).hits;
  }

  // Pencerenin yarisi gecmisken: kabaca yarim saat kalmali.
  const half = consume(hits, start + WINDOW_MS / 2);
  assert.equal(half.ok, false);
  const minutes = half.retryAfterSeconds / 60;
  assert.ok(
    minutes > 29 && minutes < 31,
    `yaklasik 30 dakika beklenirdi, ${minutes.toFixed(1)} bulundu`,
  );
});
