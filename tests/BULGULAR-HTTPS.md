# HTTPS Domain Uctan Uca Test — Bulgular

Hedef: `https://ipa-ios.simurgbilisim.com` (yayindaki gercek zincir)

| Kosum | Mimari | A+B+C | D |
|---|---|---|---|
| **2026-08-10** (guncel) | v2 — `backend/` + `frontend/` | 106/106 ✅ | 47/47 ✅ |
| 2026-08-06 (tarihce, asagida) | v1 — `server/` + `web/` | 106/106 ✅ | 47/47 ✅ |

Iki kosumun D'si ayni degildir: v2 yeniden yapilanmasi (7 Agustos) calisma
zamani yapilandirmasini (`/config.js`) kaldirdi, uretim CORS listesini bosaltti
ve cerezi `SameSite=Lax`a cekti. Suite D'nin 4 testi (D2.4, D3.3, D3.5, D3.7)
2026-08-10'da bu v2 beklentilerine gore guncellendi — artik eski davranisin
GERI DONMEDIGINI savunuyorlar. Kanit raporlari: `tests/reports/`
`rapor-2026-08-10T07-00-41-231Z.json` (D 47/47) ve
`rapor-2026-08-10T06-48-36-789Z.json` (B 14/14).

---

## 2026-08-10 — Bulgu 1: Yigin kapaliyken domain 502 ("uretim bu Mac'tir")

Gunun ilk D kosumunda 47 testin 40'i nginx'in `502 Bad Gateway` sayfasiyla
dustu; ayni anda TLS testleri (D1.1–D1.3) gecti. Yani sertifika ve LAN nginx
sapasaglamken servis yayinda degildi: compose yigini bu Mac'te kapaliydi.
`docker compose up -d --build` sonrasi ayni paket 43/47'ye, test
guncellemeleriyle 47/47'ye cikti.

Cikarimlar:

- **"Yayinda miyim?" kontrolu sertifikaya degil `https://.../healthz`e
  bakmali.** TLS el sikismasi nginx'te biter; uygulamanin ayakta olup
  olmadigini soylemez.
- LAN nginx 443'u karsilayip **bu makinenin** `:3000` / `:5173` portlarina
  aktarir. Compose kapaliyken `:3000`'i kim dinliyorsa (or. `npm run
  dev:backend`) uretim trafigini o alir — CLAUDE.md'deki "port 3000 cakismasi"
  uyarisi bir gelistirme rahatsizligi degil, uretim meselesidir.
- Mac yeniden basladiginda yiginin kendiliginden kalkmasi (Docker Desktop
  otomatik baslatma + `restart` politikasi) ayni sebepten onemlidir.

## 2026-08-10 — Bulgu 2: Suite D'de 4 test v1 beklentisi tasiyordu

v2'ye karsi olculen gercek degerler ve testlerin yeni beklentileri:

| Test | v1 beklentisi (eski) | v2'de olculen (yeni beklenti) |
|---|---|---|
| D2.4 | `/config.js` 200 + `apiBaseUrl` | 200 ama SPA fallback (index.html); `apiBaseUrl` / `__IPA_OTA_CONFIG__` yok. Imajin icinde de yok (B13) |
| D3.3 | cerez `SameSite=None` | `Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax` |
| D3.5 | `localhost:5173`e CORS izni | `access-control-allow-origin` basligi hic yok (eklenti kayitli degil) |
| D3.7 | preflight 2xx + izin basliklari | `OPTIONS /api/settings` → 404, izin basligi yok |

Dordu de kod hatasi degildi; testler 6 Agustos kararlarini kodluyordu ve v2 o
kararlari bilerek tersine cevirdi (ayni-origin tasarim: bos `CORS_ORIGINS` ⇒
cerez `Lax`; API adresi derleme aninda gomulur, uretimde goreli yol).

## 2026-08-10 — Yeniden dogrulananlar (v2, canli domain)

- **Imza guvenligi (D9, 5/5).** Amac baglamasi calisiyor (manifest anahtari
  `.ipa`da gecmiyor), bir surumun anahtari baska surumde gecmiyor, iptal
  edilen surumde gecerli imzali manifest bile 410.
- **Dosya butunlugu (D8, 5/5).** Indirilen `.ipa`nin SHA-256'si birebir
  (63 026 bayt); `Range` 206 + dogru `content-range`, sondan range
  (`bytes=-500`) calisiyor.
- **Tam iOS zinciri (D11.1).** sayfa → `itms-services://` → `manifest.plist`
  → `app.ipa`; zincirin her adresi `https://`, indirilen dosyanin hash'i dogru.
- **Sertifika (D1.2).** CN esliyor, 85 gun omru var (3 Kasim 2026'ya kadar) —
  6 Agustos olcumuyle tutarli.
- **Compose (B, 14/14).** `${VAR}` cozumu, sifresiz baslatmanin reddi,
  `NODE_ENV`/`PORT`/`DATA_DIR`'in konteynere sizmamasi, `down → up` sonrasi
  SQLite'in korunmasi (B11), panelden kaydin `PUBLIC_BASE_URL`u
  golgeleyememesi (B8b).
- **Temizlik (D12).** Kosumun yukledigi 3 test surumu uretimden silindi,
  cikis yapildi; `data-docker` DB'sinde test artigi kalmadi.

---

## Sistem haritasi (her iki kosumda olcumle dogrulandi)

```
  Internet
     │  443, Let's Encrypt (CN=ipa-ios.simurgbilisim.com, 3 Kas 2026'ya kadar)
     ▼
  193.192.105.202  ──►  LAN nginx  ──┬── /api/*  ──►  192.168.20.205:3000  (api container)
                                     └── /*      ──►  192.168.20.205:5173  (web container)
```

nginx bu Mac'te **degil**; makinede 443 dinleyen yok, brew nginx kurulu ama
calismiyor. Uzak istegin yerel container'a dustugu API loglarindan dogrulandi
(`host: 192.168.20.205:3000`, `remoteAddress: 192.168.65.1` = Docker gecidi).
2026-08-10'da ters yonu de olculdu: yigin kapaliyken ayni zincir gecerli
sertifikayla **502** dondurur (bkz. Bulgu 1).

---

## Tarihce — 2026-08-06 kosumu (v1)

### Bulunan sorun: `/i/*` API'ye gitmiyordu

nginx yalnizca `/api/*` yolunu API'ye yonlendiriyor. Kurulum yollari (`/i/*`)
SPA fallback'ine dusuyordu:

| Istek | Once | Sonra |
|---|---|---|
| `GET /i/<token>` | `200` + admin paneli (`<div id="root">`) | — |
| `GET /api/i/<token>` | `404` JSON | `200` kurulum sayfasi |

Sonucu: paylasilan link son kullaniciya kurulum sayfasi yerine admin panelini
gosterirdi; iOS `installd` de `manifest.plist` yerine HTML alip *"Uygulama
yuklenemedi"* verirdi. Sertifikanin alinma amaci tam olarak bu akisti.

**Cozum:** kurulum yolunun oneki `INSTALL_PATH_PREFIX` ile ayarlanabilir hale
getirildi (varsayilan `/i`, bu kurulumda `/api/i`); rota kayitlari ve uretilen
linkler ayni degerden turer, nginx'e dokunulmadi. O gunku dosyalar v1
agacindaydi; v2 karsiliklari: `backend/src/config/env.ts` (degisken +
dogrulama), `backend/src/modules/install/install.module.ts` (rota kayitlari),
`backend/src/domain/links/service.ts` (`publicUrl()` / `signedUrl()`).

**Olculen yan kosullar:** `/api` proxy'si derin yollari koruyor (yol
kirpilmiyor) ve 5 MB'lik govde nginx'ten gecip API'ye ulasiyor (413 degil 401
dondu) — IPA yuklemesi proxy sinirina takilmiyor.

### O gun yapilan diger degisiklikler

| Ayar | Once | Sonra (2026-08-06) | Neden |
|---|---|---|---|
| `PUBLIC_BASE_URL` | `http://localhost:3000` | `https://ipa-ios.simurgbilisim.com` | iOS gecerli sertifikali https ister |
| `API_BASE_URL` | `http://localhost:3000` | `https://ipa-ios.simurgbilisim.com` | https sayfadan http API = mixed content |
| `CORS_ORIGINS` | `http://localhost:5173` | domain + `localhost:5173` | iki giris yolu da acik olsun |
| `TRUST_PROXY` | `false` | `true` | ters proxy arkasindayiz |
| `INSTALL_PATH_PREFIX` | (yoktu) | `/api/i` | yukaridaki sorun |

**v2 (7 Agustos) bu tablodaki iki karari geri aldi:** `API_BASE_URL`
mekanizmasi tamamen kaldirildi (arayuz uretimde goreli yol kullanir, adres
derleme aninda gomulur) ve `CORS_ORIGINS` bosaltildi (cerez `Lax`a dondu).
`TRUST_PROXY=true` ile `INSTALL_PATH_PREFIX=/api/i` gecerliligini koruyor.

O gun ayrica gercek Chrome ile giris, yukleme, link uretimi ve kurulum sayfasi
elle dogrulandi; o gunku cerez `SameSite=None` idi (CORS listesi doluydu). DB
kontrolunde `settings` tablosunda `config.baseUrl` olmadigi, `PUBLIC_BASE_URL`
un gercekten env'den okundugu goruldu — v2'de bu guvence koda tasindi
(`config/settings.service.ts` env degerini her aciliste one alir; B8/B8b bunu
test eder).

---

## Gercek cihaz dogrulamasi (2026-08-10) — son adim da kapandi

Onceki kosumlarin tek acigi "gercek iPhone'a kurulum" idi; sentetik
fixture'lar (`demo-a.ipa`) imzasiz oldugu icin cihaz tarafi denenememisti.
2026-08-10'da gercek imzali bir IPA ile denendi ve calisti:

- **Dosya:** GTBYS 1.2.5 (`com.kgm.gtbys`, 36 478 824 bayt) — kurumsal
  (in-house) dagitim imzasi: `ProvisionsAllDevices: true`, profil
  2027-01-29'a, imza sertifikasi 2027-05-21'e kadar gecerli,
  `get-task-allow: false`.
- **Yukleme** panelin kullandigi gercek yoldan yapildi (domain + LAN nginx):
  36,5 MB govde nginx'ten gecti, `201` / 0,9 sn, sunucunun hesapladigi
  SHA-256 yerel dosyayla birebir.
- **Cihazin kendisi** (iPhone, ayni linkten) API loglarinda izlendi —
  `installd`'nin klasik deseni goruldu ve her adim `200` dondu:
  `GET manifest.plist?k=…` (5 ms) → `HEAD app.ipa?k=…` (boyut sondasi, 5 ms)
  → `GET app.ipa?k=…` (35 MB, 1,1 sn). Sayaclar buna gore artti; `HEAD`
  sondasinin da indirme sayacini bir artirdigi not edildi (Fastify GET
  rotalarina otomatik HEAD acar ve handler calisir — kucuk muhasebe
  ayrintisi, hata degil).
- Kurulum cihazda tamamlandi (kullanici dogrulamasi). Kurumsal profilde ilk
  acilista Ayarlar > Genel > VPN ve Aygit Yonetimi > kuruma "Guven" adimi
  gerekebilir; bu, dagitim zincirinin degil iOS'un standart kurumsal guven
  akisinin parcasidir.

---

## Kosum

```bash
node tests/run-suite.mjs D                        # yalnizca HTTPS grubu
node tests/run-suite.mjs D --domain https://baska.adres
node tests/run-suite.mjs                          # hepsi (A/B/C/D)
```

Grup D digerlerinden ayridir: izole sunucu baslatmaz, yayindaki ornegi hedefler.
Adresi, oneki ve admin sifresini `.env`den okur. Olusturdugu tum surumleri D12'de
siler. Kosumdan once yiginin ayakta oldugunu dogrulayin (`docker compose ps`) —
degilse tum HTTP testleri 502 ile duser (bkz. Bulgu 1).
