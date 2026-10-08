import { useEffect, useState } from "react";
import "./HelpDialog.css";

/**
 * "Nasıl çalışır?" penceresi.
 *
 * Uygulamaya hakim olmayan, puanlarin ve onerilerin nereden geldigini merak
 * eden ya da "Tavsiyeleri yönet" ekraninda neyi degistirirse neyin degisecegini
 * ogrenmek isteyenler icin. Her sekme bir ana ozelligi OZETLER; sayilar
 * cekirdek modullerdeki sabitlerle aynidir:
 *
 *   Item tavsiyesi   -> core live/item-advice.js, live/threats.js
 *   Hero tavsiyesi   -> core draft/draft-advisor.js, draft/draft-analyzer.js
 *   Oyuncu puani     -> core players/weekly-score.js
 *   Performance Rank -> core players/performance-evaluation-engine.js
 *
 * Bu sabitler degisirse buradaki metin de guncellenmeli.
 */

/** @type {Array<{ key: string, label: string, render: () => JSX.Element }>} */
const TABS = [
  { key: "overview", label: "Genel", render: () => <OverviewTab /> },
  { key: "items", label: "Item tavsiyesi", render: () => <ItemsTab /> },
  { key: "draft", label: "Hero tavsiyesi", render: () => <DraftTab /> },
  { key: "score", label: "Oyuncu puanı", render: () => <ScoreTab /> },
  { key: "rank", label: "Performance Rank", render: () => <RankTab /> },
  { key: "edit", label: "Düzenleme rehberi", render: () => <EditTab /> },
];

/**
 * @param {{ onClose: () => void }} props
 */
export function HelpDialog({ onClose }) {
  const [tab, setTab] = useState(TABS[0].key);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = TABS.find((row) => row.key === tab) || TABS[0];

  return (
    <div
      className="help-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Nasıl çalışır?"
      >
        <header className="help-head">
          <div>
            <strong>Nasıl çalışır?</strong>
            <p className="muted micro">
              DotaStat'ın önerileri ve puanları nereden gelir, neyi düzenlersen
              ne değişir.
            </p>
          </div>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Kapat
          </button>
        </header>

        <nav className="tabs help-tabs" role="tablist">
          {TABS.map((row) => (
            <button
              key={row.key}
              type="button"
              role="tab"
              aria-selected={tab === row.key}
              className={"tab" + (tab === row.key ? " active" : "")}
              onClick={() => setTab(row.key)}
            >
              {row.label}
            </button>
          ))}
        </nav>

        <div className="help-body" role="tabpanel">
          {current.render()}
        </div>
      </div>
    </div>
  );
}

/**
 * Puan kalemleri tablosu.
 * @param {{ rows: Array<[string, string, string?]> }} props
 */
function ScoreTable({ rows }) {
  return (
    <table className="help-table">
      <tbody>
        {rows.map(([label, value, note]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className="help-value">{value}</td>
            <td className="muted">{note || ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** @param {{ children: React.ReactNode }} props */
function Tip({ children }) {
  return <p className="help-tip">{children}</p>;
}

function OverviewTab() {
  return (
    <>
      <h4>Veri nereden geliyor?</h4>
      <ul>
        <li>
          <strong>Maç geçmişi</strong> OpenDota'dan gelir; OpenDota yanıt vermez
          ya da limite takılırsa Stratz devreye girer.
        </li>
        <li>
          <strong>Ortak önbellek:</strong> veri bir kez çekilir ve herkes aynı
          kopyayı görür. Biri oyuncuyu yenilediğinde herkesin kartı güncellenir.
        </li>
        <li>
          <strong>"Yenile"</strong> veriyi kaynaktan yeniden çeker. Veri 5
          dakikadan yeniyse tekrar çekilmez; buton bu sürede kapalı kalır.
        </li>
        <li>
          <strong>Maç bitince</strong> masaüstü uygulaması oynayanların verisini
          kendiliğinden yeniler. Yeni maç kaynaklara birkaç dakikada düştüğü
          için bunu aralıklarla birkaç kez dener.
        </li>
      </ul>

      <h4>Canlı maç</h4>
      <ul>
        <li>
          Masaüstü uygulaması oyundan <strong>GSI</strong> verisini alır. GSI
          yalnızca senin oyuncunu (hero, KDA, envanter) bildirir.
        </li>
        <li>
          <strong>Overwolf / DotaPlus</strong> kuruluysa 10 oyuncunun hero'su ve
          pozisyonu da görünür. Bu durumda karşı hamle önerileri açılır.
        </li>
        <li>
          Aynı maçtaki arkadaşların verisi birleştirilir: herkesin envanteri ve
          seçtiği pozisyon tek tabloda toplanır.
        </li>
      </ul>

      <Tip>
        Performance Rank ve "yaklaşık MMR" gerçek MMR değildir; seviye
        tahminidir.
      </Tip>
    </>
  );
}

function ItemsTab() {
  return (
    <>
      <p>
        Canlı maçta her oyuncuya "şimdi ne alsın" önerisi çıkar. Öneri sayısı
        eldeki veriye göre artar; eksik veriyle kesin konuşmamak için.
      </p>
      <ScoreTable
        rows={[
          ["Sadece kendi satırın (GSI)", "2 öneri", "hero'nun planından"],
          ["10 hero biliniyor (Overwolf)", "5 öneri", "3'ü karşı hamle"],
          ["Rakip envanteri de görünüyor", "6 öneri", "tam kural seti"],
        ]}
      />

      <h4>Öneriler hangi sırayla oluşur?</h4>
      <ol>
        <li>
          <strong>Elle eklenenler</strong> her şeyin önündedir.
        </li>
        <li>
          <strong>Kişisel erken cevaplar:</strong> oyun saati biliniyorsa rakibe
          göre ucuz itemler (ör. büyü spam'ine karşı Magic Wand).
        </li>
        <li>
          <strong>Çekirdek:</strong> hero'nun "Gerekli itemler" listesi.
        </li>
        <li>
          <strong>Duruma göre:</strong> hero'nun "Durumsal itemler" listesi.
        </li>
      </ol>

      <h4>Karşı hamle (counter) nasıl seçilir?</h4>
      <p>Bir item rakibe cevap veriyorsa grubu "Karşı hamle" olur. Üç kanıt:</p>
      <ul>
        <li>
          <strong>Rakip hero'ların özellikleri:</strong> görünmez → Dust /
          Distiller, büyü hasarı → BKB / Pipe, güçlü pasif → Silver Edge…
        </li>
        <li>
          <strong>Rakip hero'nun "Counter itemler" listesi.</strong>
        </li>
        <li>
          <strong>Rakibin aldığı ya da alması beklenen itemler:</strong> ör.
          BKB'ye karşı Nullifier. Envanteri görünmeyen rakibin itemleri oyun
          saatine göre tahmin edilir.
        </li>
      </ul>
      <p>
        Birden fazla rakip aynı tehdidi taşıyorsa (ve net worth'leri yüksekse)
        öneri öne geçer. Tooltip'te sebebi yazar: "Rakipte Venomancer ve Zeus
        büyü hasarı veriyor. Dark Seer Pipe of Insight alabilir."
      </p>

      <h4>Diğer kurallar</h4>
      <ul>
        <li>
          <strong>Kademeli öneri:</strong> büyük item için önce ara parça (Manta
          için Yasha). Yaklaşık 20. dakikadan sonra küçük item ve ara parça
          önerilmez, hedef item doğrudan gösterilir.
        </li>
        <li>Elinde olan item ve onun parçaları önerilmez; tek bot önerilir.</li>
        <li>
          Takımda bir kişinin alması yeterli itemler (Pipe gibi) yalnızca bir
          kişiye önerilir.
        </li>
        <li>
          Seçtiğin <strong>pozisyon</strong> core / destek ayrımını belirler.
        </li>
        <li>
          <strong>Takım analizi</strong> aynı kanıtı kullanır ve itemi kimin
          alabileceğini de yazar.
        </li>
      </ul>
    </>
  );
}

function DraftTab() {
  return (
    <>
      <p>
        Pick sırasında her açık pozisyon için o pozisyonu oynayabilen,
        banlanmamış ve seçilmemiş tüm hero'lar puanlanır. Her pozisyonda en iyi
        4 hero, altında da bir <strong>çeşitlilik önerisi</strong> gösterilir.
        Bir hero yalnızca en yüksek puanı aldığı pozisyonda çıkar.
      </p>

      <h4>Puan kalemleri</h4>
      <ScoreTable
        rows={[
          [
            "Oyuncu havuzu",
            "+34 / +20 / +6 / −30",
            "imza / tercih / deniyor / zayıf; pozisyonda oyuncu varsa",
          ],
          [
            "Son maçlarda oynama",
            "18'e kadar, ±20",
            "maç sayısı ve kazanma oranı",
          ],
          [
            "Tehdide cevap",
            "+10 … +28",
            "rakipte o özellikten ne kadar çok varsa",
          ],
          ["Combo", "+18", "takımdaki her combo ortağı için"],
          ["Counter", "+16", "bu hero'dan zarar gören her rakip için"],
          ["Counter'lanıyor", "−20", "bu hero'yu zorlayan her rakip için"],
          [
            "Takım ihtiyacı",
            "0 … 20",
            "teamfight, push, tempo… eksiği; pick yokken %40'ı",
          ],
          [
            "Pozisyon uyumu",
            "+8 / +4 / −4",
            "asıl pozisyon / tek pozisyonlu / çok pozisyonlu hero'nun ikincili",
          ],
        ]}
      />

      <h4>Pozisyonda kim oynuyor?</h4>
      <ol>
        <li>Senin seçtiğin pozisyon (üstteki "Pozisyonun" alanı).</li>
        <li>Overwolf'un pick sırasındaki pozisyon tahmini.</li>
        <li>Kadrodaki ana rolü, sonra ikincil rolleri.</li>
        <li>
          Pick başlamadan, maçta görünmeyen <strong>online arkadaşlar</strong>{" "}
          "olası" olarak boş pozisyonlara yerleşir; havuzları yarım ağırlıkla
          sayılır. Takımdan ilk pick gelince devreden çıkarlar.
        </li>
      </ol>

      <h4>Çeşitlilik önerisi (5. sıra)</h4>
      <p>
        Pozisyonda oyuncu varsa onun havuzundan listede olmayan en iyi hero;
        yoksa puanı ilk dörde yakın olup oyun tarzı onlara en az benzeyen hero
        ("Farklı tarz: daha çok geç oyun").
      </p>

      <Tip>
        Öneriler katalog verisi kadar iyidir: rakip pick'lere tepki vermesi için
        hero'ların "Counter hero'lar" listeleri dolu olmalı.
      </Tip>
    </>
  );
}

function ScoreTab() {
  return (
    <>
      <p>
        Kartlardaki puan "bu dönemde kim iyi gitti" sorusunu cevaplar. Herkes{" "}
        <strong>50</strong> (nötr) ile başlar. Tek maçlık şans sıralamayı
        değiştirmesin diye başarı kısmı maç sayısıyla ölçeklenir.
      </p>

      <h4>Başarı kalemleri (en fazla)</h4>
      <ScoreTable
        rows={[
          [
            "MMR değişimi",
            "±34",
            "haftada ±300 MMR tam puan; ölçülemezse maç başına ±25 tahmin",
          ],
          ["Galibiyet / mağlubiyet", "±26", "yumuşatılmış kazanma oranı"],
          [
            "Performance Rank değişimi",
            "±20",
            "dönem ortalaması, önceki 3 dönemin ortalamasıyla; ±400 tam puan",
          ],
        ]}
      />

      <h4>Güven çarpanı</h4>
      <p>
        Başarı kalemlerinin toplamı maç sayısına göre bir güvenle çarpılır
        (haftalık): 1 maç <strong>%20</strong>, 4 maç <strong>%50</strong>, 10
        maç <strong>%71</strong>, 20 maç <strong>%83</strong>. 1 maç oynayıp
        kazanan biri haftanın birincisi olamaz.
      </p>

      <h4>Oynama hacmi</h4>
      <p>
        Haftada 12 maç ve üstü tam puan; az oynayan ortalamanın biraz altına
        düşer (±6). "Son 60" sekmesinde hacim sayılmaz.
      </p>

      <h4>Dönemler ve renkler</h4>
      <ul>
        <li>
          <strong>Ay</strong> sekmesinde eşikler pencereyle büyür; iki sekme de
          "ortalamanın ne kadar üstünde/altında" sorusunu ölçer.
        </li>
        <li>
          Kart çerçevesi yalnızca başarı kısmı ±6'yı aşınca yeşil / kırmızı
          olur. Hacim rengi etkilemez.
        </li>
      </ul>
    </>
  );
}

function RankTab() {
  return (
    <>
      <p>
        Performance Rank, oyuncunun <strong>tek bir maçta</strong> yaklaşık
        hangi seviyede oynadığının tahminidir (200–9000). Gerçek MMR değildir.
      </p>

      <h4>Hesap adımları</h4>
      <ol>
        <li>
          <strong>Taban:</strong> oyuncunun genel seviyesi. Hero'nun havuzdaki
          yeri (imza / zayıf) tabanı en fazla ±400 kaydırır.
        </li>
        <li>
          <strong>Faktörler:</strong> her ölçüm, pozisyonun "orta seviye"
          beklentisine göre −1 … +1 puanlanır; ağırlıklı toplam tabana eklenir.
        </li>
        <li>
          <strong>Bağlam:</strong> geride kalan takımda iyi oynamak biraz daha
          değerli; galibiyet küçük bir bonus verir.
        </li>
        <li>
          <strong>Maçın seviyesi:</strong> sonuç maçın ortalama rankına %25
          çekilir (ortalama bilinmiyorsa %15). Uç tahminler makulleşir.
        </li>
      </ol>

      <h4>Faktör ağırlıkları</h4>
      <ScoreTable
        rows={[
          [
            "Core",
            "farm 24 · hasar 18 · fight 16",
            "hayatta kalma 16 · objective 14 · lane 12",
          ],
          [
            "Support",
            "fight 24 · vision 22 · hayatta kalma 18",
            "hasar 14 · objective 11 · lane 11",
          ],
        ]}
      />

      <h4>Pozisyon neden önemli?</h4>
      <ul>
        <li>
          Beklentiler pozisyona göre değişir: pos 3 daha az farmla, daha çok
          ölerek oynar; carry ile aynı ölçüye vurulmaz.
        </li>
        <li>
          Maç detayında 10 oyuncu görünüyorsa beklentiler o maçın temposuna
          kalibre edilir ve karşı pozisyondaki rakiple de kıyaslanır.
        </li>
        <li>
          Rol sırası: elle seçilen → takım dağılımı → maç verisi → istatistikten
          tahmin. Kendi maçlarında pozisyonu "Son maçlar" sekmesinden
          düzeltebilirsin; puan yeniden hesaplanır.
        </li>
      </ul>
    </>
  );
}

function EditTab() {
  return (
    <>
      <p>
        Hero kataloğu <strong>ortaktır</strong>: üst bardaki{" "}
        <strong>⚙ Tavsiyeleri yönet</strong> ekranında yapılan düzenleme hem
        sitede hem masaüstünde herkesin önerisine hemen yansır. Düzenlemek için
        kadroda olmak ve siteye Steam ile giriş yapmak gerekir.
      </p>

      <h4>Hangi alan neyi değiştirir?</h4>
      <ScoreTable
        rows={[
          [
            "Pozisyonlar",
            "Draft",
            "hero hangi pozisyonlarda önerilir; ilk seçilen asıl pozisyonudur",
          ],
          ["Roller", "Takım analizi", "kaydırıcılar takım radarını besler"],
          [
            "Özellikler",
            "Item + Draft",
            "rakipte bu hero varken hangi tehdit sayılır (görünmez, büyü hasarı…)",
          ],
          [
            "Counter hero'lar",
            "Draft",
            "bu hero'yu zorlayanlar: rakip bu hero'yu aldıysa onlar +16, rakipte onlar varsa bu hero −20",
          ],
          [
            "Counter itemler",
            "Item",
            "rakipte bu hero varken alınacaklar → Karşı hamle",
          ],
          ["Gerekli itemler", "Item", "çekirdek plan; sıralı tutulur"],
          ["Durumsal itemler", "Item", "duruma göre alınanlar"],
          ["Hiç önerme", "Item", "bu hero'ya asla önerilmez"],
        ]}
      />

      <h4>İpuçları</h4>
      <ul>
        <li>
          Counter listelerini kısa tut (3–6 kayıt). Uzun liste her şeyi counter
          yapar ve öneriler ayırt edici olmaktan çıkar.
        </li>
        <li>
          "Sıfırla" hero'yu varsayılan kaydına döndürür; yanlış bir düzenlemeyi
          geri almanın en kolay yolu budur.
        </li>
        <li>
          Maçtan önce üstteki <strong>Pozisyonun</strong> alanından pozisyonunu
          seç: draft seni o pozisyona yerleştirir, item önerisi core / destek
          ayrımını ona göre yapar.
        </li>
      </ul>
    </>
  );
}
