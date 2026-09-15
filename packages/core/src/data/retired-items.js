/**
 * Oyundan KALDIRILMIS itemler (URETILMIS VERI — elle duzenlemeyin).
 *
 * Uretici: scripts/build-retired-items.mjs
 * Kaynak: Valve'in yama notlari beslemesi ("Item removed from the game").
 *
 * NEDEN AYRI BIR LISTE GEREKIYOR: hem OpenDota sabitleri hem Valve'in item
 * listesi kaldirilmis itemleri TASIMAYA DEVAM EDIYOR — eski maclar okunabilsin
 * diye. Yani "tabloda var" olmasi oyunda var oldugu anlamina gelmiyor ve
 * tavsiye motorunun bakabilecegi baska bir isaret yok.
 *
 * Anahtar -> kaldirildigi yama.
 *
 * Yeni bir yama ciktiginda ureticiyi tekrar calistirin; liste elle tutulursa
 * eskidigi fark edilmiyor ve motor var olmayan itemleri onermeye devam ediyor.
 */
export default {
  // --- 7.07 ---
  iron_talon: "7.07", // Iron Talon

  // --- 7.23a ---
  tome_of_aghanim: "7.23a", // Tome of Aghanim

  // --- 7.23d ---
  elixer: "7.23d", // Elixir
  helm_of_the_undying: "7.23d", // Helm of the Undying

  // --- 7.24 ---
  poor_mans_shield: "7.24", // Poor Man's Shield

  // --- 7.29 ---
  necronomicon: "7.29", // Necronomicon
  necronomicon_2: "7.29", // Necronomicon
  necronomicon_3: "7.29", // Necronomicon
  ring_of_aquila: "7.29", // Ring of Aquila

  // --- 7.33 ---
  hood_of_defiance: "7.33", // Hood of Defiance
  tome_of_knowledge: "7.33", // Tome of Knowledge
  wraith_pact: "7.33", // Wraith Pact

  // --- 7.35 ---
  medallion_of_courage: "7.35", // Medallion of Courage
  quarterstaff: "7.35", // Quarterstaff

  // --- 7.41 ---
  cornucopia: "7.41", // Cornucopia
  eternal_shroud: "7.41", // Eternal Shroud
};
