/**
 * Hero ve item arama.
 *
 * Korunan sozlesme: kullanici GORDUGU adi yazar, ic anahtari degil. Ekranda
 * "Shadow Fiend" yaziyorsa "shadow" ya da "sf" onu bulmali; kimse
 * `nevermore` yazmak zorunda kalmamali.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  exactHeroKey,
  searchHeroes,
  searchItems,
} from "../src/heroes/search.js";
import { heroDisplayName } from "../src/heroes/hero-names.js";
import { isRetiredItem } from "../src/live/item-keys.js";

/** Sonuclarin ilk anahtari. */
const first = (rows) => rows[0]?.key || "";

test("hero gorunen adiyla bulunur, ic anahtariyla degil", () => {
  // Bu ciftlerin solu ekranda yazan ad, sagi Dota'nin ic anahtari. Ikisi
  // ortusmuyor ve kullanici soldakini biliyor.
  assert.equal(first(searchHeroes("shadow fiend")), "nevermore");
  assert.equal(first(searchHeroes("queen of pain")), "queenofpain");
  assert.equal(first(searchHeroes("clockwerk")), "rattletrap");
  assert.equal(first(searchHeroes("wraith king")), "skeleton_king");
  assert.equal(first(searchHeroes("zeus")), "zuus");
  assert.equal(first(searchHeroes("windranger")), "windrunner");
});

test("birkac harf yeter", () => {
  assert.equal(first(searchHeroes("pud")), "pudge");
  assert.equal(first(searchHeroes("timber")), "shredder");
  assert.equal(first(searchItems("khan")), "angels_demise");
  assert.equal(first(searchItems("linken")), "sphere");
  assert.equal(first(searchItems("drum")), "ancient_janggo");
});

test("kisaltmalar calisir", () => {
  assert.equal(first(searchHeroes("sf")), "nevermore");
  assert.equal(first(searchHeroes("qop")), "queenofpain");
  assert.equal(first(searchHeroes("kotl")), "keeper_of_the_light");
  assert.equal(first(searchHeroes("wk")), "skeleton_king");
  // Kesme isareti kelime ayirmaz: "Nature's Prophet" -> "np".
  assert.equal(first(searchHeroes("np")), "furion");
  assert.equal(first(searchItems("bkb")), "black_king_bar");
  assert.equal(first(searchItems("mkb")), "monkey_king_bar");
  assert.equal(first(searchItems("hotd")), "helm_of_the_dominator");
});

test("toplulukta yerlesmis takma ad basa gelir", () => {
  // "pa" hem Pangolier hem Phantom Assassin ile basliyor; takma ad tablosu
  // Phantom Assassin diyor ve kullanicinin kastettigi o.
  assert.equal(first(searchHeroes("pa")), "phantom_assassin");
  assert.equal(exactHeroKey("pa"), "phantom_assassin");
  assert.equal(exactHeroKey("uydurma"), "");
});

test("baslangic eslesmesi, icinde gecmeye tercih edilir", () => {
  const rows = searchHeroes("lin");
  assert.equal(first(rows), "lina", "Lina, Lina ile baslamayan adlardan once");
});

test("arama sonucu kaldirilmis item icermez", () => {
  // Kaldirilmis bir itemi listede gostermek, kullaniciyi bir daha hic
  // onerilmeyecek bir sey eklemeye davet eder.
  for (const query of ["eternal", "necro", "aquila", "cornucopia", "medallion"]) {
    const retired = searchItems(query, 20).filter((row) =>
      isRetiredItem(row.key),
    );
    assert.deepEqual(retired, [], query + " icin kaldirilmis item dondu");
  }
});

test("bos sorgu listeyi bastan gosterir", () => {
  // Bos bir acilir kutu "sonuc yok" gibi okunuyor ve kullanici yazmayi
  // birakiyor; kutuya odaklanildiginda liste dolu gelmeli.
  assert.ok(searchHeroes("").length > 0);
  assert.ok(searchItems("").length > 0);
});

test("sonuc sayisi sinirlanir", () => {
  assert.ok(searchHeroes("a", 5).length <= 5);
  assert.ok(searchItems("a", 3).length <= 3);
});

test("her sonuç gorunen adini tasir", () => {
  for (const row of searchHeroes("", 200)) {
    assert.equal(row.name, heroDisplayName(row.key));
    assert.ok(row.name && !row.name.includes("_"), row.key + " adi ham kalmis");
  }
});

test("eslesmeyen sorgu bos doner", () => {
  assert.deepEqual(searchHeroes("zzzzqqq"), []);
  assert.deepEqual(searchItems("zzzzqqq"), []);
});
