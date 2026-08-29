/**
 * Item bazli counter kurallari.
 *
 * JSON yerine ES modulu olarak tutulur: hem Node (Netlify Functions, Electron)
 * hem tarayici (Vite) tarafinda ek yapilandirma olmadan import edilebilsin diye.
 */
export default {
  blade_mail: {
    counters: ["orchid", "bloodthorn", "cyclone"],
  },
  vanguard: {
    counters: ["desolator", "skadi", "silver_edge"],
  },
  black_king_bar: {
    counters: ["nullifier", "abyssal_blade"],
  },
  ghost_scepter: {
    counters: ["nullifier", "disperser"],
  },
  lotus_orb: {
    counters: ["nullifier", "sheepstick"],
  },
  pipe: {
    counters: ["shivas_guard", "diffusal_blade"],
  },
  assault: {
    counters: ["desolator", "solar_crest"],
  },
  crimson_guard: {
    counters: ["maelstrom", "mjollnir"],
  },
  linkensphere: {
    counters: ["force_staff", "cyclone", "nullifier"],
  },
  manta: {
    counters: ["maelstrom", "mjollnir", "radiance"],
  },
  heart: {
    counters: ["spirit_vessel", "skadi"],
  },
  satanic: {
    counters: ["spirit_vessel", "nullifier"],
  },
  butterfly: {
    counters: ["monkey_king_bar", "bloodthorn"],
  },
  euls: {
    counters: ["nullifier", "black_king_bar"],
  },
  aeon_disk: {
    counters: ["nullifier", "abyssal_blade"],
  },
};
