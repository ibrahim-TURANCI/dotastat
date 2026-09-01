/**
 * Arkadas grubunun baslangic oyuncu profilleri.
 *
 * JSON yerine ES modulu olarak tutulur: hem Node (Netlify Functions, Electron)
 * hem tarayici (Vite) tarafinda ek yapilandirma olmadan import edilebilsin diye.
 */
export default {
  version: 1,
  note: "Baslangic verisi. Uzun sureli gozleme dayali profillerdir, kesin istatistik degildir. performanceProfile degerleri GERCEK MMR DEGIL, performans seviyesi tahminidir.",
  players: [
    {
      id: "janissary",
      name: "Janissary",
      player_id: "201008262",
      active: true,
      dotaProfile: {
        primaryRole: "pos3",
        secondaryRoles: ["pos2", "pos4", "pos1", "pos5"],
        signatureHeroes: ["dark_seer", "magnataur", "enigma"],
        preferredHeroes: [
          "lina",
          "leshrac",
          "void_spirit",
          "puck",
          "death_prophet",
        ],
        weakHeroes: [],
        experimentalHeroes: ["tidehunter", "centaur"],
      },
      character: {
        generalPlaystyle:
          "Rakibin ne yapmak istedigini okuyup bozmayi seven, fight ve alan kontrolu uzerinden oynayan oyuncu. Grubun en tecrubeli ismi; teorik olarak 5 rolu de oynayabilecek oyun bilgisine sahip.",
        strengths: [
          "Teamfight okuma",
          "Initiation",
          "Positioning",
          "Alan acma",
          "Takim arkadaslarina oynama",
          "Rakibin pozisyonunu bozma",
          "Eski tecrube ve oyun bilgisi",
        ],
        weaknesses: [
          "Ondeyken gereginden fazla fight arayabilme",
          "Avantaji map/objective kontrolune cevirmek yerine fight kovalamak",
          "Yanlis hero seciminde performansin ciddi dusebilmesi",
          "Her hero ve rolde ayni seviyede olmamasi",
        ],
        developmentAreas: [
          "Avantajli oyunlarda tempoyu objective uzerinden kapatmak",
          "Hero havuzunu en verimli 6-8 hero ile sinirlamak",
        ],
        laneBehavior:
          "Offlane'de alan kazanip rakip safelane planini bozar; gerektiginde lane'i feda edip haritaya cikar.",
        teamfightBehavior:
          "Initiation'i ustlenir, fight'i baslatan ve sekillendiren isim.",
        mapTempoVisionBehavior:
          "Tempoyu fight uzerinden kurar; objective donusumu zayif kalabilir.",
        bestTeamUsage: "Pos 3 initiator / alan acici / ikinci shot-caller.",
        synergyNotes: [
          "Actigi alani degerlendirebilecek bir carry ile birlikte cok daha verimli.",
        ],
        funnyAdvice:
          "5k'ya cikman icin daha iyi farm yapmana gerek yok. Daha az 'hadi fight atalim' demen gerekiyor.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 5000,
          max: 6000,
        },
        gameKnowledgeLevel: {
          min: 5000,
          max: 6000,
        },
        averageHeroPerformance: {
          min: 4000,
          max: 5000,
        },
        weakHeroPerformance: {
          min: 3500,
          max: 4000,
        },
        unplayableHeroCount: {
          min: 15,
          max: 20,
        },
        actualRank: 3500,
      },
    },
    {
      id: "galleleon",
      name: "Galleleon",
      player_id: "1128333660",
      active: true,
      dotaProfile: {
        primaryRole: "pos5",
        secondaryRoles: ["pos4"],
        signatureHeroes: ["witch_doctor", "shadow_shaman", "disruptor"],
        preferredHeroes: ["witch_doctor", "shadow_shaman", "disruptor"],
        weakHeroes: [],
        experimentalHeroes: ["rubick", "tusk", "snapfire", "bounty_hunter"],
      },
      character: {
        generalPlaystyle:
          "Agresif fight supportu. Son donemde aktif oynuyor ve kazanma istegi yuksek; aktif form acisindan grubun daha guvenilir oyuncularindan biri.",
        strengths: [
          "Spell kullanimi",
          "Fight damage",
          "Disable",
          "Assist uretimi",
          "Objective katkisi",
        ],
        weaknesses: [
          "Spell attiktan sonra fight'tan cikmayi unutabiliyor",
          "Gereksiz bir spell veya auto attack icin olebiliyor",
          "Lane manipulation tarafi 811 kadar guclu degil",
        ],
        developmentAreas: [
          "Spell sonrasi reposition",
          "Pull / camp manipulation",
          "Ward zamanlamasi",
        ],
        laneBehavior:
          "Lane'de agresif; trade aramayi sever, lane kontrolu ikinci planda.",
        teamfightBehavior:
          "Disable + damage kombinasyonuyla fight'i acar, cikis planlamasi zayif.",
        mapTempoVisionBehavior:
          "Vision rutini orta seviyede; fight tempolarina daha cok odakli.",
        bestTeamUsage: "Pos 5 ana rol, gerektiginde fight agirlikli Pos 4.",
        synergyNotes: [
          "Vision ve lane kontrolu guclu bir Pos 4 ile birlikte cok daha stabil.",
        ],
        funnyAdvice:
          "Spell'i attin, isin bitti. Sirada 'geri cekilmek' var, 'bir tane daha vurayim' degil.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 3500,
          max: 4000,
        },
        gameKnowledgeLevel: {
          min: 3300,
          max: 3500,
        },
        averageHeroPerformance: {
          min: 3000,
          max: 3500,
        },
        weakHeroPerformance: {
          min: 2500,
          max: 3000,
        },
        unplayableHeroCount: {
          min: 70,
          max: 80,
        },
        actualRank: 3000,
      },
    },
    {
      id: "qalleleon",
      name: "QALLELEON",
      player_id: "263552728",
      active: true,
      dotaProfile: {
        primaryRole: "pos1",
        secondaryRoles: [],
        signatureHeroes: [],
        preferredHeroes: ["juggernaut", "phantom_assassin", "luna"],
        weakHeroes: [],
        experimentalHeroes: [],
      },
      character: {
        generalPlaystyle:
          "Advantage Converter Carry. Takim ondeyken avantaji buyutme konusunda guclu; farm alanini kullanip kill ve objective'e cevirebiliyor. Gerideyken performansi ciddi dusuyor.",
        strengths: [
          "Farm",
          "Avantajli oyunu buyutme",
          "Cleanup",
          "Takim ondeyken carry etkisi",
        ],
        weaknesses: [
          "Geriden gelen oyunlarda etkisizlesebilme",
          "Guclu rakibe karsi performans tutarsizligi",
          "Cabuk sinirlenme",
          "Takim iletisiminin zayiflamasi",
          "Oyundan erken dusebilme",
        ],
        developmentAreas: [
          "Geride kalinan oyunlarda defansif farm plani",
          "Tilt yonetimi",
          "Kotu gidisatta iletisimi surdurmek",
        ],
        laneBehavior: "Rahat lane'de guclu; baskilanan lane'de plani bozulur.",
        teamfightBehavior:
          "Fight'a onde girmez; avantaj varsa cleanup ile oyunu kapatir.",
        mapTempoVisionBehavior:
          "Psikolojik momentumdan fazla etkilenir; oyun tempo takibi duruma gore degisir.",
        bestTeamUsage: "Pos 1. Onde olan takimda maksimum verim.",
        synergyNotes: [
          "Alan acan bir offlaner/initiator ile birlikte tavani ciddi yukselir.",
        ],
        funnyAdvice:
          "Oyun geride diye chat'e yazmak GPM'ini artirmiyor. Denendi, olmuyor.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 3000,
          max: 3500,
        },
        gameKnowledgeLevel: {
          min: 2800,
          max: 3000,
        },
        averageHeroPerformance: {
          min: 2500,
          max: 3000,
        },
        weakHeroPerformance: {
          min: 2000,
          max: 2500,
        },
        unplayableHeroCount: {
          min: 70,
          max: 80,
        },
        actualRank: 2500,
      },
    },
    {
      id: "bordomavi",
      name: "BordoMavi",
      player_id: "171585303",
      active: true,
      dotaProfile: {
        primaryRole: "pos2",
        secondaryRoles: [],
        signatureHeroes: ["bloodseeker"],
        preferredHeroes: ["bloodseeker"],
        weakHeroes: [],
        experimentalHeroes: [
          "necrophos",
          "death_prophet",
          "puck",
          "queenofpain",
          "snapfire",
        ],
      },
      character: {
        generalPlaystyle:
          "Bloodseeker'da belirgin sekilde guclu mid / tempo oyuncusu. Bloodseeker oynadiginda lane, fight ve tempo plani net; disina ciktiginda plan kolay bozuluyor.",
        strengths: [
          "Bloodseeker",
          "Mid lane aliskanligi",
          "Tempo",
          "Aktif oynama",
        ],
        weaknesses: [
          "Hero pool bagimliligi",
          "Guclu rakibe karsi plani bozuldugunda afallama",
          "Kendi bildigini yapmada israr",
          "Rastgele hero secimlerinde ciddi performans dususu",
        ],
        developmentAreas: [
          "Hero havuzunu 3-4 guvenli mid ile genisletmek",
          "Kotu matchup'ta alternatif plan uretmek",
        ],
        laneBehavior:
          "Mid'de aktif; rupture/tempo baskisiyla lane disina tasar.",
        teamfightBehavior:
          "Tempo ve pickoff odakli; hero uygunsa oyunu tek basina hizlandirir.",
        mapTempoVisionBehavior:
          "Bloodseeker ile map tempo kontrolu guclu, diger herolarda dusuk.",
        bestTeamUsage: "Pos 2, tercihen signature hero uzerinden.",
        synergyNotes: [
          "Erken fight kuran bir Pos 4 ile birlikte tempo avantaji buyur.",
        ],
        funnyAdvice:
          "Bloodseeker banlandiysa panik yapma; hero secim ekraninda 4 dakikan daha var.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 3000,
          max: 3500,
        },
        gameKnowledgeLevel: {
          min: 2800,
          max: 3000,
        },
        averageHeroPerformance: {
          min: 2500,
          max: 3000,
        },
        weakHeroPerformance: {
          min: 1800,
          max: 2000,
        },
        unplayableHeroCount: {
          min: 70,
          max: 80,
        },
        actualRank: 3000,
      },
    },
    {
      id: "ston3b4nks",
      name: "Ston3B4nks",
      player_id: "323242079",
      active: true,
      dotaProfile: {
        primaryRole: "pos1",
        secondaryRoles: ["pos2", "pos3"],
        signatureHeroes: [],
        preferredHeroes: ["anti_mage", "spectre", "tidehunter"],
        weakHeroes: [],
        experimentalHeroes: [],
      },
      character: {
        generalPlaystyle:
          "Flex oyuncu. Dogru hero ve odakla grubun en iyi core performanslarindan birini verebilir; ozellikle laning ve late game tarafinda yuksek tavani var.",
        strengths: [
          "Core oynama",
          "Laning",
          "Late game",
          "Takimin eksik core rolunu doldurma",
        ],
        weaknesses: [
          "Odak seviyesi degisken",
          "Support performansi daha zayif",
          "Her oyunda ayni seviyeyi veremiyor",
          "Belirgin tek bir signature rolu yok",
        ],
        developmentAreas: [
          "Sabit bir signature rol/hero seti olusturmak",
          "Oyun ici odak sureklililigi",
        ],
        laneBehavior:
          "Laning en guclu yani; lane'i kazanip avantaji late'e tasir.",
        teamfightBehavior:
          "Late game itemleri tamamlandiginda fight etkisi yuksek.",
        mapTempoVisionBehavior:
          "Farm rutini duzenli; map tempo takibi odak durumuna gore degisir.",
        bestTeamUsage:
          "Pos 1 / Pos 2 / Pos 3 flex - takimda hangi core rolu bossa.",
        synergyNotes: [
          "Takimda eksik kalan core rolunu doldurdugunda draft esnekligi saglar.",
        ],
        funnyAdvice:
          "Support oynayacaksan haber ver, takim psikolojik olarak hazirlansin.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 4000,
          max: 4500,
        },
        gameKnowledgeLevel: {
          min: 3800,
          max: 4000,
        },
        averageHeroPerformance: {
          min: 3000,
          max: 3500,
        },
        weakHeroPerformance: {
          min: 2500,
          max: 3000,
        },
        unplayableHeroCount: {
          min: 30,
          max: 40,
        },
        actualRank: 3000,
      },
    },
    {
      id: "811",
      name: "811",
      player_id: "244162185",
      active: true,
      dotaProfile: {
        primaryRole: "pos4",
        secondaryRoles: ["pos5"],
        signatureHeroes: ["skywrath_mage", "mirana", "lion"],
        preferredHeroes: ["skywrath_mage", "mirana", "lion"],
        weakHeroes: [],
        experimentalHeroes: [],
      },
      character: {
        generalPlaystyle:
          "Aktif ve kontrollu Pos 4. Vision, detection ve map kontrolu tarafinda grubun en sistemli oyuncularindan biri. Galleleon'a gore daha kontrollu, WhoAmI?'a gore daha bilgi odakli.",
        strengths: [
          "Vision",
          "Detection",
          "Sentry / Dust kullanimi",
          "Pickoff",
          "Camp manipulation",
          "Pull",
          "Lane kontrolu",
        ],
        weaknesses: [
          "Her hero ile ayni seviyede degil",
          "Aktif support oyununu zaman zaman fazla zorlayabiliyor",
          "Kotu draftta etkisi dusebiliyor",
        ],
        developmentAreas: [
          "Hero havuzunu genisletmek",
          "Kotu draftta rol degistirebilme",
        ],
        laneBehavior:
          "Pull ve camp manipulation ile lane'i yonetir; lane sonucunu bilincli kurgular.",
        teamfightBehavior:
          "Pickoff ve setup odakli; fight'i vision avantajiyla acar.",
        mapTempoVisionBehavior:
          "Grubun en duzenli ward/detection rutini; map kontrolu onceligi yuksek.",
        bestTeamUsage: "Pos 4 - vision ve map kontrolu sorumlusu.",
        synergyNotes: [
          "Fight damage'i yuksek bir Pos 5 ile birlikte support hatti dengelenir.",
        ],
        funnyAdvice:
          "Ward koydun, dust aldin, sentry bastin. Bir de hayatta kalirsan mukemmel olacak.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 3300,
          max: 3500,
        },
        gameKnowledgeLevel: {
          min: 3300,
          max: 3500,
        },
        averageHeroPerformance: {
          min: 3000,
          max: 3500,
        },
        weakHeroPerformance: {
          min: 2500,
          max: 3000,
        },
        unplayableHeroCount: {
          min: 70,
          max: 80,
        },
        actualRank: 2500,
      },
    },
    {
      id: "whoami",
      name: "WhoAmI?",
      player_id: "179935428",
      active: true,
      dotaProfile: {
        primaryRole: "pos4",
        secondaryRoles: ["pos5"],
        signatureHeroes: [],
        preferredHeroes: ["pudge", "earthshaker", "nyx_assassin"],
        weakHeroes: [],
        experimentalHeroes: ["undying", "treant"],
      },
      character: {
        generalPlaystyle:
          "Agresif, damage vermeyi seven ancak support olarak pozisyon guvenligini ikinci plana atan oyuncu. Dogal yaklasimi 'lane'i kontrol edeyim' yerine 'rakibi rahatsiz edeyim ve kill tehdidi olustureyim'.",
        strengths: [
          "Aktif spell kullanimi",
          "Pickoff",
          "Damage",
          "Assist uretimi",
          "Offlane ortamina uyum",
        ],
        weaknesses: [
          "Pozisyon guvenligi",
          "Spell sonrasi hayatta kalma",
          "Gereksiz fight'a baglanma",
          "Camp manipulation / lane kontrolu",
        ],
        developmentAreas: [
          "Fight sonrasi cikis",
          "Lane kontrolu ve pull rutini",
          "Fight secimi",
        ],
        laneBehavior:
          "Surekli baski kurar; lane kontrolu ve pull rutini zayif.",
        teamfightBehavior:
          "Onde spell atar, cikis planlamasi yapmadigi icin erken oler.",
        mapTempoVisionBehavior: "Vision rutini dusuk; agresif rotasyon odakli.",
        bestTeamUsage: "Pos 4 - agresif spell / pickoff support.",
        synergyNotes: [
          "Saglam ve stabil bir Pos 3 ile birlikte agresifligi dengelenir.",
        ],
        funnyAdvice:
          "3 spell attiysan ve hala yasiyorsan aslinda cok iyi gidiyorsun. Dorduncuyu atmak zorunda degilsin.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 2500,
          max: 3000,
        },
        gameKnowledgeLevel: {
          min: 3300,
          max: 3500,
        },
        averageHeroPerformance: {
          min: 2000,
          max: 2500,
        },
        weakHeroPerformance: {
          min: 1800,
          max: 2000,
        },
        unplayableHeroCount: {
          min: 50,
          max: 60,
        },
        actualRank: 2000,
      },
    },
    {
      id: "prehistorik",
      name: "Prehistorik",
      player_id: "214253685",
      active: true,
      dotaProfile: {
        primaryRole: "pos5",
        secondaryRoles: [],
        signatureHeroes: [],
        preferredHeroes: ["jakiro", "crystal_maiden", "warlock", "zuus"],
        weakHeroes: [],
        experimentalHeroes: [],
      },
      character: {
        generalPlaystyle:
          "Grubun en dusuk genel seviyeli oyuncusu. Kendi rank seviyesindeki oyunlarda daha rahat olabilir; bu grupla oynarken oyunun hizi yukseldigi icin core sorumlulugu tasimamali. Basit, takim faydasi saglayan veya global etkili herolarda kullanilmali.",
        strengths: [
          "Verilen basit gorevi uygulama",
          "Global / kolay etkili support herolari",
          "Takimin plani netse uyum",
        ],
        weaknesses: [
          "Oyun takibi",
          "Global gelismeleri takip",
          "Karar hizi",
          "Core sorumlulugu tasiyamama",
        ],
        developmentAreas: [
          "Minimap takibi",
          "Temel ward rutini",
          "Sabit 2-3 herodan olusan guvenli havuz",
        ],
        laneBehavior: "Lane'de pasif; gorev verildiginde uygular.",
        teamfightBehavior:
          "Global veya genis alan etkili spell'lerle katki saglamasi en verimlisi.",
        mapTempoVisionBehavior:
          "Map takibi zayif; tempo kararlarini takima birakmali.",
        bestTeamUsage:
          "Pos 5 / Utility Support. 'Takim oyunu yonetsin, Prehistorik belirli gorevleri yapsin.'",
        synergyNotes: [
          "Shot-caller bir oyuncuyla ayni takimda net gorev tanimiyla verimli olur.",
        ],
        funnyAdvice:
          "Prehistorik takimda oldugunda matchmaking'in daha gucsuz rakip getirme ihtimali bile stratejik avantaj sayilabilir.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 1000,
          max: 1500,
        },
        gameKnowledgeLevel: {
          min: 1800,
          max: 2000,
        },
        averageHeroPerformance: {
          min: 800,
          max: 1000,
        },
        weakHeroPerformance: {
          min: 500,
          max: 1000,
        },
        unplayableHeroCount: {
          min: 50,
          max: 60,
        },
        actualRank: 1000,
      },
    },
    {
      id: "bontala",
      name: "BONTALA",
      player_id: "241152103",
      active: true,
      dotaProfile: {
        primaryRole: "pos4",
        secondaryRoles: ["pos5"],
        signatureHeroes: ["pudge", "crystal_maiden"],
        preferredHeroes: [
          "jakiro",
          "witch_doctor",
          "mirana",
          "rubick",
          "undying",
        ],
        weakHeroes: [],
        experimentalHeroes: [],
      },
      character: {
        generalPlaystyle:
          "Aktif, fight seven, support oynarken bile oyunun merkezinde olmak isteyen oyuncu. Oyun bilgisi mevcut pratik seviyesinin uzerinde; pro oyunu okuyabiliyor ancak az oynadigi icin execution her zaman ayni seviyede degil.",
        strengths: [
          "Fight okuma",
          "Aktif support oyun",
          "Pickoff",
          "Teorik oyun bilgisi",
        ],
        weaknesses: [
          "Aktif oynama eksikligi",
          "Hero pratigi",
          "Bazen fight ile inting arasindaki cizgiyi gecebilmesi",
        ],
        developmentAreas: [
          "Duzenli oynayarak execution'i bilgi seviyesine cekmek",
          "Fight secimi",
        ],
        laneBehavior: "Aktif; kill tehdidi olusturmaya calisir.",
        teamfightBehavior:
          "Fight'in merkezinde olmak ister, okuma iyi ama uygulama degisken.",
        mapTempoVisionBehavior:
          "Rotasyon ve pickoff odakli; vision rutini orta seviyede.",
        bestTeamUsage: "Pos 4 - aktif playmaker support.",
        synergyNotes: [
          "Initiation ve fight okumasi guclu bir Pos 3 ile birlikte uyumlu calisir.",
        ],
        funnyAdvice:
          "Her gordugun fight senin fight'in degil. Pudge oynarken haritanin %100'unu hook menziline alma zorunlulugun yok.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 3500,
          max: 4000,
        },
        gameKnowledgeLevel: {
          min: 4000,
          max: 4500,
        },
        averageHeroPerformance: {
          min: 2800,
          max: 3000,
        },
        weakHeroPerformance: {
          min: 2500,
          max: 3000,
        },
        unplayableHeroCount: {
          min: 40,
          max: 50,
        },
        actualRank: 2500,
      },
    },
    {
      id: "maboss",
      name: "MABOSS",
      player_id: "240808986",
      active: true,
      dotaProfile: {
        primaryRole: "pos2",
        secondaryRoles: ["pos1", "pos3"],
        signatureHeroes: ["invoker", "obsidian_destroyer", "ursa"],
        preferredHeroes: [
          "furion",
          "warlock",
          "life_stealer",
          "viper",
          "ember_spirit",
        ],
        weakHeroes: [],
        experimentalHeroes: [],
      },
      character: {
        generalPlaystyle:
          "Cok genis havuza sahip, mid odakli deneyimli oyuncu: 8700+ mac ve oynanmamis hero yok. Invoker basta olmak uzere kontrol mid herolarinda belirgin ustunluk kuruyor; havuzun genisligi sayesinde takimin acigi hangi rolde olursa olsun doldurabiliyor.",
        strengths: [
          "Invoker",
          "Mid lane kontrolu",
          "Genis hero havuzu",
          "Mac deneyimi",
        ],
        weaknesses: [
          "Initiator offlane herolari (Beastmaster, Sand King, Mars)",
          "Support oynadigi maclarda verim dususu",
          "Genis havuzun getirdigi odak dagilmasi",
        ],
        developmentAreas: [
          "Kazanamadigi initiator herolarini havuzdan cikarmak ya da uzerine calismak",
          "Support oynanan maclarda vision rutinini oturtmak",
        ],
        laneBehavior:
          "Mid'de kontrol ve son vurus odakli; lane'i kaynak ustunlugune cevirir.",
        teamfightBehavior:
          "Uzaktan buyu hasari ve kontrol; Invoker / Obsidian Destroyer gibi herolarda fight'i sekillendirir.",
        mapTempoVisionBehavior:
          "Tempoyu mid uzerinden kurar; rol degistiginde vision rutini zayiflar.",
        bestTeamUsage: "Pos 2 kontrol mid; gerektiginde Pos 1'e kayabilir.",
        synergyNotes: [
          "Mid'in actigi alani kullanabilecek bir Pos 3 ile birlikte tempo avantaji buyur.",
        ],
        funnyAdvice:
          "127 heronun hepsini oynamissin, 128.'yi bekleme. Invoker zaten sirada.",
      },
      performanceProfile: {
        strongHeroPerformance: {
          min: 4500,
          max: 5000,
        },
        gameKnowledgeLevel: {
          min: 4500,
          max: 5000,
        },
        averageHeroPerformance: {
          min: 4200,
          max: 4700,
        },
        weakHeroPerformance: {
          min: 2800,
          max: 3200,
        },
        unplayableHeroCount: {
          min: 5,
          max: 10,
        },
        actualRank: 3800,
      },
    },
  ],
};
