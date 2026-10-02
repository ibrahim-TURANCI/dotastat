/**
 * Kadro degisiklik katmani (Debug paneli -> Onbellek tablosu).
 *
 *   - Ekleme, duzenleme, gizleme/gosterme ve silme tohum veriyi bozmaz.
 *   - Gizli oyuncu listRoster'dan cikar ama findRosterPlayer onu bulur.
 *   - Katalog yoneticisi silinemez, account id'si degistirilemez.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRosterChange,
  applyRosterOverrides,
  findRosterPlayer,
  isCatalogAdmin,
  listAllRoster,
  listRoster,
} from "../src/players/roster.js";

/** Her testten sonra tohum veriye don. */
function reset() {
  applyRosterOverrides(null);
}

test("oyuncu account id ile eklenir ve tekrar eklenemez", () => {
  const before = listRoster().length;
  const added = applyRosterChange(null, {
    action: "add",
    accountId: "123456789",
    name: "Yeni Oyuncu",
  });
  assert.equal(added.ok, true);
  applyRosterOverrides(added.overrides);
  assert.equal(listRoster().length, before + 1);
  assert.equal(findRosterPlayer("123456789")?.name, "Yeni Oyuncu");

  const again = applyRosterChange(added.overrides, {
    action: "add",
    accountId: "123456789",
    name: "Kopya",
  });
  assert.equal(again.ok, false);
  assert.equal(again.error, "oyuncu-zaten-var");
  reset();
});

test("gizli oyuncu listeden cikar, bulunmaya devam eder", () => {
  const hidden = applyRosterChange(null, { action: "hide", id: "janissary" });
  assert.equal(hidden.ok, true);
  applyRosterOverrides(hidden.overrides);
  assert.equal(
    listRoster().some((row) => row.id === "janissary"),
    false,
  );
  assert.equal(findRosterPlayer("201008262")?.active, false);
  assert.equal(isCatalogAdmin("201008262"), true);

  const shown = applyRosterChange(hidden.overrides, {
    action: "show",
    id: "janissary",
  });
  applyRosterOverrides(shown.overrides);
  assert.equal(
    listRoster().some((row) => row.id === "janissary"),
    true,
  );
  reset();
});

test("duzenleme adi degistirir, yonetici account id'si korunur", () => {
  const renamed = applyRosterChange(null, {
    action: "edit",
    id: "janissary",
    name: "Jani",
  });
  assert.equal(renamed.ok, true);
  applyRosterOverrides(renamed.overrides);
  assert.equal(findRosterPlayer("janissary")?.name, "Jani");

  const moved = applyRosterChange(renamed.overrides, {
    action: "edit",
    id: "janissary",
    accountId: "999",
  });
  assert.equal(moved.ok, false);
  assert.equal(moved.error, "yonetici-korumali");

  // Ad tohumdakine geri donunce duzenleme kaydi kalkar.
  const back = applyRosterChange(renamed.overrides, {
    action: "edit",
    id: "janissary",
    name: "Janissary",
  });
  assert.deepEqual(back.overrides.edits, {});
  reset();
});

test("silme: yonetici silinemez, digerleri kadrodan cikar", () => {
  assert.equal(
    applyRosterChange(null, { action: "delete", id: "janissary" }).ok,
    false,
  );

  const other = listAllRoster().find((row) => !row.catalogAdmin);
  const removed = applyRosterChange(null, { action: "delete", id: other.id });
  assert.equal(removed.ok, true);
  applyRosterOverrides(removed.overrides);
  assert.equal(findRosterPlayer(other.player_id), null);
  reset();
  assert.ok(findRosterPlayer(other.player_id));
});

test("eklenen oyuncu silinince katmandan da cikar", () => {
  const added = applyRosterChange(null, {
    action: "add",
    accountId: "555",
    name: "Gecici",
  });
  const id = added.overrides.added[0].id;
  const removed = applyRosterChange(added.overrides, { action: "delete", id });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.overrides.added, []);
  assert.deepEqual(removed.overrides.deleted, []);
});
