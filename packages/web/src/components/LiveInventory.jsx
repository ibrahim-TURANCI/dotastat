import { useEffect, useState } from "react";
import { itemDisplayName, itemIconUrl, ownedItems } from "@dotastat/core";

/**
 * Canli mac satirindaki envanter ve tavsiye gorsellestirmesi.
 *
 * DUZEN oyundaki kutu yerlesimini taklit eder, cunku ekrana bakan kisi ayni
 * anda oyuna da bakiyor ve iki goruntunun ortusmesi taramayi hizlandiriyor:
 *
 *   [agh]   [ 1 2 3 ]   [neutral]
 *   [shard] [ 4 5 6 ]   [n. etki]
 *           [ b b b ]   [  tp   ]
 *
 * Aghanim's Scepter ve Shard SOLDA ayri durur: ikisi de envanterde tutulmaz,
 * alindiginda hero'ya islenir. Sag sutundaki uc yuvarlak kutu neutral item,
 * neutral etkisi ve TP — ucu de ana envanterden ayri slotlar.
 *
 * ONEMLI AYRIM: "esya yok" ile "esya BILINMIYOR" ayni sey degildir. GSI canli
 * macta yalnizca kendi oyuncusunun envanterini verir; Overwolf'tan gelen rakip
 * satirlarinda item alani HIC yoktur. Bos kutular cizmek, rakibin gercekten
 * bos oldugunu soylemek olurdu. Bu yuzden veri yoksa bolum hic cizilmez.
 */

/** Ana envanterdeki slot sayisi (oyundaki gibi: 3x2). */
const MAIN_SLOTS = 6;
/** Backpack slot sayisi (ana envanterin altinda 3x1). */
const BACKPACK_SLOTS = 3;
/** Tavsiye izgarasinin sabit yuva sayisi (3x2). */
const ADVICE_SLOTS = 6;

/** Aghanim's Scepter ikonunun CDN anahtari. */
const SCEPTER_KEY = "ultimate_scepter";
/** Aghanim's Shard ikonunun CDN anahtari. */
const SHARD_KEY = "aghanims_shard";

/** Envanterde scepter sayilan anahtarlar (Blessing dahil). */
const SCEPTER_ITEMS = new Set([
  "ultimate_scepter",
  "ultimate_scepter_2",
  "ultimate_scepter_roshan",
]);
/** Envanterde shard sayilan anahtarlar. */
const SHARD_ITEMS = new Set(["aghanims_shard", "aghanims_shard_roshan"]);

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
 *
 * Ikon yuklenmezse kutu BOS BIRAKILMAZ, itemin bas harfleri yazilir. Kirik
 * resim simgesi bir Dota kutusundan cok daha dikkat cekiyor ve "bu slot bos"
 * ile "bu ikon gelmedi" birbirine karisiyordu.
 *
 * @param {{ item?: string, title?: string, shape?: "square"|"circle" }} props
 */
function ItemSlot({ item, title = "", shape = "square", predicted = false }) {
  const key = String(item || "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [key]);

  if (!key) {
    return <div className={"inv-slot " + shape + " empty"} />;
  }

  const label = itemDisplayName(key);
  const base = "inv-slot " + shape + (predicted ? " predicted" : "");
  const hint = predicted
    ? `${label} — tahmini, gerçek envanter görünmüyor`
    : title
      ? `${title}: ${label}`
      : label;

  if (failed) {
    return (
      <div className={base + " fallback"} title={hint}>
        {label.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <div className={base} title={hint}>
      <img
        src={itemIconUrl(key)}
        alt={label}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/**
 * Aghanim kutusu: dolu ise renkli, degilse soluk.
 *
 * Yoklugu de bilgidir ("bu hero'nun hala scepter'i yok"), bu yuzden kutu her
 * zaman cizilir; yalnizca doygunlugu degisir.
 *
 * @param {{ active: boolean, itemKey: string, label: string }} props
 */
function AghanimSlot({ active, itemKey, label }) {
  return (
    <div
      className={"inv-agh" + (active ? " active" : "")}
      title={`${label}: ${active ? "var" : "yok"}`}
    >
      <img src={itemIconUrl(itemKey)} alt={label} loading="lazy" />
    </div>
  );
}

/**
 * Envanteri ekrandaki yerlesime gore ayirir.
 *
 * GSI slotlari zaten ayiriyor, ama iki kaynak birlestiginde (Overwolf + GSI)
 * ya da eski bir kayit okundugunda neutral/TP ana listede kalmis olabilir.
 * Boyle bir durumda item IKI KEZ gorunurdu; bu yuzden ozel slotlar ana
 * listeden cikarilir.
 *
 * @param {Record<string, any>} player
 */
function inventoryLayout(player) {
  const main = (Array.isArray(player.items) ? player.items : []).map(String);
  const backpack = (Array.isArray(player.backpack) ? player.backpack : []).map(
    String,
  );

  const neutral = String(player.neutral || "");
  const tp =
    String(player.tp || "") ||
    main.find(
      (key) => key.includes("tpscroll") || key.includes("town_portal"),
    ) ||
    "";
  const neutralEffect =
    String(player.neutralEffect || "") ||
    main.find((key) => key.startsWith("enhancement_")) ||
    "";

  const special = new Set([neutral, tp, neutralEffect].filter(Boolean));
  const strip = (list) => list.filter((key) => key && !special.has(key));

  return {
    main: strip(main).slice(0, MAIN_SLOTS),
    backpack: strip(backpack).slice(0, BACKPACK_SLOTS),
    neutral,
    neutralEffect,
    tp,
  };
}

/**
 * Oyuncunun envanteri.
 * @param {{ player: Record<string, any> }} props
 */
export function LiveInventory({ player }) {
  if (!hasInventory(player)) {
    // Envanter gorunmuyor ama hero biliniyor: cekirdek planindan ve oyun
    // saatinden kestirilen TAHMINI envanter cizilir (bkz. core/live/
    // predicted-items.js). Kutular sonuk ve her birinin ustunde "tahmini"
    // yaziyor — gercek veriyle karistirilmamali.
    const predicted = Array.isArray(player?.predictedItems)
      ? player.predictedItems
      : [];
    if (!predicted.length) {
      return <span className="muted micro">envanter görünmüyor</span>;
    }
    return <PredictedInventory items={predicted} />;
  }

  const layout = inventoryLayout(player);
  const owned = new Set(ownedItems(player));

  // Scepter/Shard iki yoldan da anlasilabilir: GSI'nin hero bayragi (dogru
  // kaynak) ya da hala envanterde duran item (henuz kullanilmamis). Ikisi de
  // "var" demektir.
  const hasScepter =
    Boolean(player.hasScepter) ||
    [...SCEPTER_ITEMS].some((key) => owned.has(key));
  const hasShard =
    Boolean(player.hasShard) || [...SHARD_ITEMS].some((key) => owned.has(key));

  return (
    <div className="inv-layout">
      <div className="inv-aghs">
        <AghanimSlot
          active={hasScepter}
          itemKey={SCEPTER_KEY}
          label="Aghanim's Scepter"
        />
        <AghanimSlot
          active={hasShard}
          itemKey={SHARD_KEY}
          label="Aghanim's Shard"
        />
      </div>

      <div className="inv-left">
        <div className="inv-main">
          {Array.from({ length: MAIN_SLOTS }, (_, index) => (
            <ItemSlot key={index} item={layout.main[index]} title="Envanter" />
          ))}
        </div>
        <div className="inv-backpack">
          {Array.from({ length: BACKPACK_SLOTS }, (_, index) => (
            <ItemSlot
              key={index}
              item={layout.backpack[index]}
              title="Backpack"
            />
          ))}
        </div>
      </div>

      <div className="inv-side">
        <ItemSlot item={layout.neutral} title="Neutral" shape="circle" />
        <ItemSlot
          item={layout.neutralEffect}
          title="Neutral etki"
          shape="circle"
        />
        <ItemSlot item={layout.tp} title="TP" shape="circle" />
      </div>
    </div>
  );
}

/**
 * Envanteri gorunmeyen bir satirin TAHMINI envanteri.
 *
 * Yalnizca ana envanter cizilir. Backpack, neutral ve TP tahmin EDILMEZ: o
 * slotlar hero'nun item planindan turetilemez ve bos kutu cizmek "bunlar yok"
 * demek olurdu. Aghanim kutulari da ayni sebeple burada yok — plandaki scepter
 * ana yuvalarda gorunur.
 *
 * @param {{ items: string[] }} props
 */
function PredictedInventory({ items }) {
  return (
    <div className="inv-layout predicted" title="Tahmini envanter">
      <div className="inv-left">
        <div className="inv-main">
          {Array.from({ length: MAIN_SLOTS }, (_, index) => (
            <ItemSlot key={index} item={items[index]} predicted />
          ))}
        </div>
      </div>
      <span className="inv-predicted-tag micro">tahmini</span>
    </div>
  );
}

/**
 * Oyuncuya onerilen itemler.
 *
 * Izgara SABIT (3x2): satirlar iki takim arasinda hizali kalsin diye bos
 * yuvalar da cizilir. Degisken genislikte bir liste, on satirlik bir tabloda
 * gozu her satirda yeniden hizalamaya zorluyordu.
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
      {Array.from({ length: ADVICE_SLOTS }, (_, index) => {
        const row = rows[index];
        if (!row) {
          return <div key={index} className="advice-slot empty" />;
        }
        return <AdviceSlot key={row.key} row={row} />;
      })}
    </div>
  );
}

/**
 * Tek tavsiye kutusu (ikon yuklenmezse bas harflere duser).
 * @param {{ row: Record<string, any> }} props
 */
function AdviceSlot({ row }) {
  const [failed, setFailed] = useState(false);
  const name = row.name || itemDisplayName(row.key);
  const hint = `${name} — ${row.groupLabel}. ${row.reason}`;

  return (
    <div className={"advice-slot " + row.group} title={hint}>
      {failed ? (
        <span className="advice-fallback">
          {name.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <img
          src={itemIconUrl(row.key)}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
