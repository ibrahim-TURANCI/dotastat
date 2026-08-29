/**
 * Oyuncu ikilileri arasi sinerji notlari.
 *
 * JSON yerine ES modulu olarak tutulur: hem Node (Netlify Functions, Electron)
 * hem tarayici (Vite) tarafinda ek yapilandirma olmadan import edilebilsin diye.
 */
export default {
  version: 1,
  note: "Oyuncu ikilileri arasindaki gozleme dayali sinerji tanimlari. UI metinleri buradan gelir, component icinde hardcode edilmez.",
  synergies: [
    {
      id: "janissary__qalleleon",
      playerId1: "janissary",
      playerId2: "qalleleon",
      synergyScore: 82,
      description:
        "Janissary alan acar ve fight baslatir. QALLELEON olusan avantaji carry gucune cevirir.",
      strengths: [
        "Initiation -> cleanup zinciri net",
        "QALLELEON'un ihtiyac duydugu 'onde olma' halini Janissary uretebiliyor",
        "Fight sonrasi objective donusumu hizlanir",
      ],
      risks: [
        "Fight kotu giderse QALLELEON'un dususu ikisini birden etkisizlestirir",
        "Janissary'nin fazla fight aramasi carry'nin farm penceresini daraltabilir",
      ],
    },
    {
      id: "811__galleleon",
      playerId1: "811",
      playerId2: "galleleon",
      synergyScore: 78,
      description:
        "811 vision, lane ve map kontrolu saglar. Galleleon fight damage ve disable ile devam eder.",
      strengths: [
        "Support hatti hem kontrollu hem agresif olur",
        "Detection ve vision rutini 811 tarafindan garanti altina alinir",
        "Galleleon'un disable'i 811'in setup'i uzerine oturur",
      ],
      risks: [
        "Ikisi de agresife kacarsa lane kontrolu birakilabilir",
        "Galleleon'un fight sonrasi cikis sorunu ikili rotasyonlarda maliyetli olur",
      ],
    },
    {
      id: "whoami__janissary",
      playerId1: "whoami",
      playerId2: "janissary",
      synergyScore: 74,
      description:
        "WhoAmI?'in agresif oyununu daha stabil bir Pos 3 dengeler; Janissary hem fight acar hem hasari uzerine ceker.",
      strengths: [
        "WhoAmI? spell'lerini daha guvenli bir ortamda kullanabilir",
        "Offlane ikilisi erken baski uretir",
      ],
      risks: [
        "Ikisi de fight sever; gereksiz erken fight sayisi artabilir",
        "Lane kontrolu ve pull rutini iki tarafta da zayif kalir",
      ],
    },
    {
      id: "bontala__janissary",
      playerId1: "bontala",
      playerId2: "janissary",
      synergyScore: 76,
      description:
        "BONTALA'nin aktif Pos 4 oyunu Janissary'nin initiation ve fight okumasiyla uyumlu.",
      strengths: [
        "Iki oyuncunun da fight okumasi yuksek",
        "Pickoff ve initiation ayni tempoda calisir",
        "Shot-calling paylasilabilir",
      ],
      risks: [
        "Ikisi de fight arar; objective ihmal edilebilir",
        "BONTALA'nin execution'i her oyunda ayni degil",
      ],
    },
    {
      id: "811__bordomavi",
      playerId1: "811",
      playerId2: "bordomavi",
      synergyScore: 71,
      description:
        "811'in vision ve rotasyon rutini, BordoMavi'nin mid tempo oyununu besler.",
      strengths: [
        "Mid'e guvenli rotasyon ve vision destegi",
        "Erken pickoff ile tempo avantaji",
      ],
      risks: ["BordoMavi signature hero disina ciktiginda tempo plani bozulur"],
    },
    {
      id: "prehistorik__janissary",
      playerId1: "prehistorik",
      playerId2: "janissary",
      synergyScore: 58,
      description:
        "Prehistorik net gorev tanimiyla verimli olur; Janissary shot-caller olarak bu gorevleri uretebilir.",
      strengths: [
        "Belirsizlik azalir, Prehistorik ne yapacagini bilir",
        "Basit global support herolari takim planina baglanir",
      ],
      risks: [
        "Janissary'nin surekli yonlendirme yuku artar",
        "Hizli tempolu oyunlarda Prehistorik geride kalabilir",
      ],
    },
    {
      id: "ston3b4nks__qalleleon",
      playerId1: "ston3b4nks",
      playerId2: "qalleleon",
      synergyScore: 64,
      description:
        "Ston3B4nks eksik core rolu doldurur; QALLELEON Pos 1'de kalarak en verimli oldugu yerde oynar.",
      strengths: [
        "Draft esnekligi artar",
        "Iki core da tercih ettigi rolde oynar",
      ],
      risks: [
        "Iki oyuncu da geriden gelen oyunlarda zayif",
        "Farm alani cakismasi olabilir",
      ],
    },
    {
      id: "galleleon__prehistorik",
      playerId1: "galleleon",
      playerId2: "prehistorik",
      synergyScore: 45,
      description:
        "Ikisi de support hattinda oldugunda vision ve lane kontrolu bosta kalir.",
      strengths: ["Fight damage uretimi Galleleon tarafindan saglanir"],
      risks: [
        "Ward / detection rutini kimsede degil",
        "Lane kontrolu ve pull yapilamaz",
        "Support hatti fazla pasif veya fazla riskli hale gelir",
      ],
    },
  ],
};
