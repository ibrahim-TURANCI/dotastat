import { itemDisplayName, itemIconUrl, ownedItems } from "@dotastat/core";

/**
 * Canli mac satirindaki envanter ve tavsiye gorsellestirmesi.
 *
 * ONEMLI AYRIM: "esya yok" ile "esya BILINMIYOR" ayni sey degildir. GSI canli
 * macta yalnizca kendi oyuncusunun envanterini verir; Overwolf'tan gelen rakip
 * satirlarinda item alani HIC yoktur. Bos kutular cizmek, rakibin gercekten
 * bos oldugunu soylemek olurdu. Bu yuzden veri yoksa bolum hic cizilmez.
 */

/** Ana envanterdeki slot sayisi (oyundaki gibi). */
const MAIN_SLOTS = 6;
/** Backpack slot sayisi. */
const BACKPACK_SLOTS = 3;

/**
 * Bir satirin envanteri BILINIYOR mu?
 * @param {Record<string, any>} player
 * @returns {boolean}
 */
export function hasInventory(player) {
  return Array.isArray(player?.items) || Array.isArray(player?.backpack);
}

/**
 * Tek bir item kutusu.
 * @param {{ item?: string, title?: string, shape?: "square"|"circle" }} props
 */
function ItemSlot({ item, title = "", shape = "square" }) {
  const key = String(item || "");
  const className = "inv-slot " + shape + (key ? "" : " empty");
  if (!key) {
    return <div className={className} />;
  }
  const label = itemDisplayName(key);
  return (
    <div className={className} title={title ? `${title}: ${label}` : label}>
      <img src={itemIconUrl(key)} alt={label} loading="lazy" />
    </div>
  );
}

/**
 * Oyuncunun envanteri: ana slotlar, backpack ve neutral.
 * @param {{ player: Record<string, any> }} props
 */
export function LiveInventory({ player }) {
  if (!hasInventory(player)) {
    return <span className="muted micro">envanter görünmüyor</span>;
  }

  const main = Array.isArray(player.items) ? player.items : [];
  const backpack = Array.isArray(player.backpack) ? player.backpack : [];
  const neutral = player.neutral || "";

  return (
    <div className="inv-layout">
      <div className="inv-main">
        {Array.from({ length: MAIN_SLOTS }, (_, index) => (
          <ItemSlot key={index} item={main[index]} title="Envanter" />
        ))}
      </div>
      <div className="inv-side">
        <div className="inv-backpack">
          {Array.from({ length: BACKPACK_SLOTS }, (_, index) => (
            <ItemSlot key={index} item={backpack[index]} title="Backpack" />
          ))}
        </div>
        <ItemSlot item={neutral} title="Neutral" shape="circle" />
      </div>
    </div>
  );
}

/**
 * Oyuncuya onerilen itemler.
 *
 * Her kutu GEREKCESINI tasir (title): "neden bu item" sorusunun cevabi
 * gorunmeden tavsiye bir listeden ibaret kalir ve guvenilmez.
 *
 * @param {{ advice: Array<Record<string, any>> }} props
 */
export function LiveAdvice({ advice }) {
  const rows = Array.isArray(advice) ? advice : [];
  if (!rows.length) {
    return <span className="muted micro">öneri yok</span>;
  }

  return (
    <div className="advice-grid">
      {rows.map((row) => (
        <div
          key={row.key}
          className={"advice-slot " + row.group}
          title={`${row.name} — ${row.groupLabel}. ${row.reason}`}
        >
          <img src={itemIconUrl(row.key)} alt={row.name} loading="lazy" />
        </div>
      ))}
    </div>
  );
}

/**
 * Bir oyuncunun sahip oldugu itemleri anahtar listesi olarak verir.
 * Dialogda "zaten var" isaretlemesi icin kullanilir.
 * @param {Record<string, any>} player
 * @returns {string[]}
 */
export function inventoryKeys(player) {
  return hasInventory(player) ? ownedItems(player) : [];
}
