# ipa-apk-app-manager

Kendi sunucunuzda çalışan iOS **ve Android** **OTA (over-the-air)** dağıtım servisi. IPA ya da
APK'yı panelden yükleyin, süreli bir kurulum linki alın; alıcı linki telefonunda mobil
tarayıcısıyla açıp tek dokunuşla kurar (iOS: `itms-services` kurulumu, Android: imzalı `.apk`
indirmesi → paket yükleyici). Diawi / InstallOnAir muadili — dosyalarınız üçüncü taraf sunucuya
çıkmaz. Her paket kendi başına bir sürümdür (ayrı link, ayrı QR); iOS ve Android sürümleri tek link
altında eşleştirilmez.

Öne çıkanlar: sürükle-bırak yükleme, otomatik IPA/APK çözümleme (paket adı, sürüm, simge —
APK için `AndroidManifest.xml` + `resources.arsc` bağımlılıksız okunur), süreli + şifreli + QR
kodlu linkler, admin panel (sürümler, platform filtresi, sayaçlar, tüm ayarlar), otomatik disk
temizliği, uçtan uca TypeScript, Docker ile tek komut kurulum.

---

## ⚠️ HTTPS zorunludur

iOS, OTA kurulumu yalnızca **geçerli sertifikalı HTTPS** üzerinden yapar. `http://`,
self-signed veya eksik zincirli sertifikada kurulum **cihazda hiçbir hata göstermeden**
başarısız olur. Uygulama TLS sonlandırmaz: önüne bir ters proxy koyun ve
`PUBLIC_BASE_URL`'i `https://` adrese ayarlayın. `http://localhost:3000` yalnızca arayüzü
ve yükleme akışını test etmek içindir — cihaza kurulum yapamaz.

**Enterprise (In-House)** imzalı IPA her cihaza kurulur; **Ad-Hoc** imzalı IPA yalnızca
UDID'si provisioning profile'a eklenmiş cihazlara. Servis imzaya karışmaz.

Android tarafında HTTPS teknik bir şart değildir (APK düz dosya olarak indirilir) ama tarayıcılar
düz `http://` üzerinden APK indirmesini "güvensiz" diye işaretleyip engelleyebilir; aynı `https://`
adres ikisine de hizmet eder. APK'nın da imzalı olması gerekir (`apksigner`), servis imzaya karışmaz.

---

## İki bağımsız servis

Depo tek, ama **backend ve frontend birbirinden tamamen ayrıdır**. Ortak `package.json`,
ortak lock dosyası, ortak `.env` veya ortak `docker-compose.yml` **yoktur**; kök dizinde
yapılandırma bulunmaz. Her servis kendi klasöründen tek başına kurulur, derlenir ve ayağa
kalkar:

| | backend | frontend |
|---|---|---|
| bağımlılıklar | `backend/package.json` + kendi `package-lock.json` | `frontend/package.json` + kendi `package-lock.json` |
| derleme ayarı | `backend/tsconfig.json` (kendi kendine yeter) | `frontend/tsconfig.json` |
| compose sırları | `backend/.env` | `frontend/.env` |
| uygulama ayarı | `.env.development` / `.env.production` / `.env.local` (Node) | `.env.development` / `.env.production` / `.env.development.local` (Vite; `.env.local` mode dosyasını **ezemez**) |
| yayın | `backend/docker-compose.yml` → proje `ipa-apk-backend` | `frontend/docker-compose.yml` → proje `ipa-apk-frontend` |
| veri | `backend/data-docker/` | yok (durum tutmaz) |

Aralarında container-içi trafik, ortak ağ veya paylaşılan dosya yoktur. **Tek bağ HTTP'dir**
ve o da önlerindeki ters proxy üzerinden kurulur. Birini diğerine dokunmadan yeniden
başlatabilir, yeniden derleyebilir, hatta başka bir makineye taşıyabilirsiniz.

## Kurulum (Docker)

İki servis ayrı ayrı ayağa kaldırılır. **Sıra önemli değildir.**

```bash
# --- 1) API ---
cd backend
cp .env.example .env    # sonra doldurun:
```

```ini
ADMIN_PASSWORD=guclu-bir-sifre
SESSION_SECRET=<openssl rand -hex 32 çıktısı>
PUBLIC_BASE_URL=https://ipa-ios.simurgbilisim.com
INSTALL_PATH_PREFIX=/api/i
CORS_ORIGINS=http://localhost:5173   # dev arayüzü canlı API'ye bağlanabilsin
API_PORT=3000
```

```bash
docker compose up -d --build

# --- 2) Arayüz ---
cd ../frontend
cp .env.example .env    # yalnızca WEB_PORT
docker compose up -d --build
```

Arayüz `http://localhost:5173`, API `http://localhost:3000` (host portları ilgili servisin
kendi `.env`'i içinde `WEB_PORT` / `API_PORT` ile değişir; container-içi portlar sabittir).

- `ADMIN_PASSWORD` veya `SESSION_SECRET` boşsa backend compose'u **başlamaz** (`${VAR:?}`) —
  şifresiz panel sessizce ayağa kalkamaz.
- `backend/.env` yalnızca sırları ve makineye özel değerleri taşır. Üretim varsayılanları
  imaja gömülü `backend/.env.production` içindedir (sırsız). `NODE_ENV`, `PORT` ve
  `DATA_DIR` compose'a bilerek yazılmamıştır — tek kaynakları imajdır; `backend/.env`e
  yanlışlıkla yazılan bir değer container'a ulaşamaz.
- **`.env` dosyalarını Node okumaz.** Her iki serviste de `.env` yalnızca
  `docker compose` içindir. Backend'in kendi ortam dosyaları `.env.development` /
  `.env.production` / `.env.local`'dır ve `package.json` içinde açıkça listelenir.
  Frontend'de dosyaları Vite kendi kuralıyla yükler (`.env` → `.env.local` →
  `.env.[mode]` → `.env.[mode].local`) — bu yüzden **`frontend/.env`'e `VITE_` önekli
  bir değişken yazmayın**, sessizce derlemeye sızar; makineye özel ezme
  `.env.development.local`'a yazılır (`.env.local` mode dosyasını ezemez).
- Compose proje adları dosyalarda sabitlenmiştir (`ipa-apk-backend`, `ipa-apk-frontend`).
  Aksi halde compose dizin adını (`backend`, `frontend`) kullanır ve iki servis karışır.

### Ters proxy (yayına alma)

Arayüz üretimde göreli yol kullanır (`/api/...`), bu yüzden her şey **tek alan adı**
altında birleşir ve iki proxy kuralı yeter — `INSTALL_PATH_PREFIX=/api/i` sayesinde
kurulum yolları da mevcut `/api/*` kuralından geçer:

```
https://alan-adi/        ->  web:8080   (SPA)
https://alan-adi/api/*   ->  api:3000   (API + OTA kurulum)
```

Örnek nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name ipa-ios.simurgbilisim.com;

    ssl_certificate     /etc/letsencrypt/live/ipa-ios.simurgbilisim.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ipa-ios.simurgbilisim.com/privkey.pem;

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 0;         # sinir uygulamada (maxUploadMb)
        proxy_buffering      off;       # .ipa tamponlanmasin
        proxy_request_buffering off;
        proxy_read_timeout   300s;
        proxy_send_timeout   300s;
    }

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- **`CORS_ORIGINS`** yalnızca API'ye ayrı origin'den bağlanmasına izin verilen arayüzleri
  listeler. Bu kurulumda `http://localhost:5173` listelidir (yerel geliştirme arayüzü
  canlı API'ye bağlanabilir — bilinçli karar, 2026-08-10). Liste doluyken oturum çerezi
  `SameSite=None` olur; CSRF koruması backend'in **Origin doğrulama katmanıyla** sağlanır:
  durum değiştiren isteklerde (POST/PUT/PATCH/DELETE) tanınmayan `Origin` başlığı 403 alır.
  Tam aynı-origin düzenine dönmek için listeyi boşaltın — çerez `SameSite=Lax`'a döner.
- `TRUST_PROXY=true` compose varsayılanıdır; proxy'siz bir kurulumda `false` yapın.
- Sertifika geçerli ve **tam zincirli** olmalı; proxy'de gövde sınırı ve zaman aşımları
  yüksek olmalı (örnekteki değerler).

### Veri ve yedekleme

Her şey **`backend/data-docker/`** altındadır (SQLite + IPA dosyaları). Adlandırılmış volume
değil bind mount — sıradan bir dizin gibi yedeklenir. Frontend durum tutmaz, yedeklenecek
verisi yoktur:

```bash
cd backend
docker compose stop api
tar czf ipa-apk-yedek-$(date +%F).tar.gz data-docker/
docker compose start api
```

> **Canlı veritabanına host'tan `sqlite3` ile bağlanmayın.** POSIX dosya kilitleri Docker
> Desktop bind mount'undan geçmez; host bağlantısı kendini yalnız sanır ve kapanırken
> WAL'i sıfırlayıp container'ın yazdıklarını siler (10 Ağustos 2026'da bir kayıt böyle
> kaybedildi, elle geri yazıldı). Yığın çalışırken okumayı container içinden yapın:
>
> ```bash
> docker compose exec -T api node -e 'const {DatabaseSync}=require("node:sqlite");
>   const db=new DatabaseSync("/data/ipa-ota.db",{readOnly:true});
>   console.log(db.prepare("select app_name, version from builds").all());'
> ```
>
> Host `sqlite3` yalnızca `docker compose stop api` sonrasında güvenlidir. Veritabanını
> kopyalarken `.db-wal` ve `.db-shm` dosyalarını da alın — `.db` tek başına eksiktir.

### Veritabanını arayüzden görüntüleme (`dbadmin`)

Komut yazmadan, tarayıcıdan **canlı** veritabanına bakmak için `backend/docker-compose.yml`
içinde `dbadmin` servisi vardır. **Salt okunurdur ve varsayılan olarak çalışmaz.**

```bash
cd backend
npm run db:ui          # veya: docker compose --profile dbadmin up -d dbadmin
open http://127.0.0.1:8081
npm run db:ui:down     # kapat
```

Şifre `backend/.env` içindeki `DBADMIN_PASSWORD` değeridir. Arayüz tabloları listeler,
satırları sayfalar, sütunlara göre sıralar ve serbest **SELECT** çalıştırmanıza izin verir.
Sayfayı yenilediğinizde güncel veriyi görürsünüz — yığın çalışmaya devam ederken.

Kalıcı açmak isterseniz `backend/.env` dosyasına `COMPOSE_PROFILES=dbadmin` ekleyin; o zaman
düz `docker compose up -d` bu servisi de başlatır.

> **Neden yazma yok?** 13 Ağustos 2026'da bu makinede ölçüldü: aynı bind mount üzerindeki
> **ikinci bir process yazarsa** POSIX kilitleri geçmediği için kilidi tutan tarafın
> `COMMIT`'i `locking protocol` (errcode 15) hatasıyla ölür ve **o işlemin verisi kaybolur**.
> Aynı sonuç tek container içindeki iki process ile de çıktı, yani sorun bind mount'un
> kendisindedir; VirtioFS zaten açık, çevrilecek bir Docker ayarı yok. **Okuma** ise güvenli
> ölçüldü. Bu yüzden servis `-r` bayrağıyla çalışır ve o bayrak güvenlik sınırıdır —
> kaldırmayın.
>
> Yazma yetkisi gerçekten gerekiyorsa doğru çözüm veritabanını **adlandırılmış bir volume'e**
> taşımaktır: aynı test orada doğru davrandı (rakip yazar `database is locked` alıp bekledi,
> veri kaybı olmadı). Bedeli, `.db` dosyasının macOS'tan doğrudan açılamaz olmasıdır.

> Arayüz varsayılan olarak **yalnızca bu makineden** erişilebilir (`DBADMIN_BIND=127.0.0.1`).
> Burası üretim sunucusu olduğu için LAN'a açmak (`0.0.0.0`) şifre dışında hiçbir koruma
> bırakmaz — uzaktan bakmanız gerekiyorsa SSH tüneli tercih edin:
> `ssh -L 8081:127.0.0.1:8081 <bu-makine>`

---

## Roller ve link güvenliği

- **Yönetici** — `ADMIN_PASSWORD` ile giriş (12 saatlik oturum çerezi). Yükleme, sürüm
  yönetimi ve ayarlar dahil tüm `/api/*` uçları oturum ister; `POST /api/uploads` dosya
  gövdesi okunmadan 401 döner ve bunu kapatan bir ayar **yoktur**.
- **Link sahibi** — hesabı yoktur; elindeki kurulum linki yalnızca o sürümü kurdurur.
  Token 22 karakter rastgeledir; `manifest.plist`, `app.ipa` ve `app.apk` adresleri `token + amaç`
  ikilisine bağlı kısa ömürlü **HMAC imzası** taşır: A linki B'nin dosyasına erişemez,
  imzasız erişim 403 alır, `app.ipa` için üretilen imza `app.apk`'yı açmaz. Android kaydında
  `manifest.plist`/`app.ipa`, iOS kaydında `app.apk` yoktur (404).
- İsteğe bağlı **link şifresi** ikinci katmandır; doğrulanmadan imzalı adresler sayfaya
  hiç yazılmaz. Linki elde eden herkes kurabilir — kişi bazlı kimlik gerekiyorsa şifre
  kullanın ya da servisi VPN/SSO arkasına alın.

Neden çerez değil imzalı URL? `itms-services://` zincirinde dosyaları Safari değil,
iOS'un `installd` süreci indirir ve Safari'nin çerezlerini görmez — çerez tabanlı koruma
OTA kurulumunu bozar. Kurulum yollarına oturum kontrolü eklemeyin.

---

## Kullanım

Panele girin → IPA ya da APK'yı sürükleyin → süre / not / şifre seçin → çıkan linki paylaşın.
Platform dosya uzantısından anlaşılır; sürüm kartlarında iOS/Android rozeti ve platform filtresi vardır.

- **iOS:** Alıcı linki iPhone'da **mobil tarayıcısıyla** (Safari ya da Chrome) açar; Enterprise
  imzalı uygulamada ilk açılışta *Ayarlar › Genel › VPN ve Aygıt Yönetimi*'nden **Güven** demesi
  gerekir (kurulum sayfası bunu anlatır).
- **Android:** Alıcı linki Android cihazında açar, **Uygulamayı İndir**'e dokunur; tarayıcı `.apk`'yı
  indirir. İndirilen dosyaya dokununca paket yükleyici açılır; ilk seferde tarayıcı için
  *Bilinmeyen uygulamaları yükle* izni istenir, ardından **Yükle**. Sayfa masaüstünde ya da
  iPhone'da açılırsa uyarı + QR + indirme butonu gösterilir (APK düz dosyadır, `adb install` ile
  de kurulabilir).

Süre / not / şifre `Sürümler › Düzenle`den sonradan değiştirilir; panel yalnızca
dokunduğunuz alanı gönderir. Süre düzenlerken taban seçilir:

- **Yükleme anından** (varsayılan) — yüklemedeki tercihi düzeltir; sonuç geçmişe
  düşerse link kapanır (panel önceden uyarır).
- **Şimdiden** — süresi dolmuş linki yeniden canlandırır.

İptal bundan bağımsızdır: süre düzenlemek iptal edilmiş linki açmaz; **İptal et /
Yeniden aç** ayrıca yönetilir. Dikkat: iptal edilen linkin dosyası da *Silme gecikmesi*
(varsayılan 24 saat) sonunda silinir; ondan sonra *Yeniden aç* ve süre düzenleme `409`
ile reddedilir, panelde Düzenle pasifleşir.

---

## Ayarlar

**Genel adres (baseUrl) hariç** hepsi panelden değişir ve anında geçerli olur. baseUrl
yalnızca `PUBLIC_BASE_URL` ortam değişkeninden gelir, panelde salt okunur görünür —
yanlış host'lu manifest cihazda sessizce başarısız olduğu için panelden değiştirilemez.

| Ayar | Varsayılan | Not |
|---|---|---|
| Varsayılan link süresi | 24 saat | Yeni linklerin ömrü |
| En uzun link süresi | 720 saat | Panel tavanı; en fazla 8760 (1 yıl) |
| Silme gecikmesi | 24 saat | Süresi dolan **veya iptal edilen** paketin (IPA/APK) diskten silinme gecikmesi; silindikten sonra link yeniden açılamaz |
| İmzalı link ömrü | 120 dk | manifest / ipa / apk imza geçerliliği (linkin ömründen bağımsız) |
| En büyük dosya boyutu | 1024 MB | Kabul edilen en büyük paket (IPA/APK) |
| Önceki sürümü otomatik iptal | kapalı | Aynı paket kimliği **ve aynı platformda** yeni paket yüklenince eskisini kapatır; iOS ile Android sürümleri birbirini kapatmaz |
| Site adı / Kurulum notu / QR | — | Kurulum sayfasının görünümü |

Link süresi üç kademedir: kod tavanı `MAX_TTL_HOURS = 8760`
(`backend/src/config/settings.schema.ts`) → panel tavanı *En uzun link süresi* (formdaki
hazır süre düğmelerini de filtreler) → linkin kendi süresi (yükleme formu). 1 yıllık link
için önce ayardan 8760, sonra formda **1 yıl**. Süresi dolan link `410` döner; dosyası
*Silme gecikmesi* kadar sonra silinir, kayıt "purged" olarak kalır. **İptal edilen
link için de aynı saat işler**: iptalden *Silme gecikmesi* kadar sonra dosyası silinir
ve o andan itibaren *Yeniden aç* / süre düzenleme `409` alır. İptali geçici
tutacaksanız gecikmeyi ona göre uzun seçin.

---

## Geliştirme

Kökte `npm install` **yoktur** — her servis kendi klasöründe kurulur. İki ayrı terminal:

```bash
# --- terminal 1: API ---
cd backend
npm install
cp .env.local.example .env.local      # ADMIN_PASSWORD + SESSION_SECRET
npm run dev            # :3000  (veriler backend/data/ içine)
npm run typecheck
npm run build

# --- terminal 2: arayüz ---
cd frontend
npm install
cp .env.development.local.example .env.development.local   # isteğe bağlı: yerel backend'e bağlan
npm run dev            # :5173
npm run typecheck
npm run build
```

İkisini birden kuran/derleyen bir kök komut bilinçli olarak yoktur: npm workspaces
kaldırıldı, böylece frontend'i kurmak için backend'in yerel eklentisini (`better-sqlite3`,
derleyici ister) kurmak zorunda kalmazsınız — ve tersi.

Arayüzün bağlandığı API, derleme anındaki `VITE_API_BASE_URL`'den gelir:

| Dosya | Değer | Sonuç |
|---|---|---|
| `frontend/.env.production` | *boş* | göreli yol — üretim SPA'sı aynı origin, CORS'suz |
| `frontend/.env.development` | `https://ipa-ios.simurgbilisim.com` | dev arayüzü **canlı API'ye** CORS ile bağlanır |
| `frontend/.env.development.local` | `http://localhost:3000` | yerel backend ile çalışmak için ezme (şablon: `.env.development.local.example`; `.env.local` **işe yaramaz** — Vite onu mode dosyasından önce yükler) |

Geliştirme akışı bilinçli olarak cross-origin'dir (karar: 2026-08-10): dev arayüzü kendi
origin'inde (5173) çalışır ve varsayılan olarak **canlı API'ye** konuşur. Üç uyarı:

- **Dev panelindeki işlemler canlı veriye gider** — yükleme/silme/ayar denemeleri için
  `frontend/.env.development.local` ile yerel backend'e dönün.
- **Safari üçüncü taraf çerezleri engeller** — dev-arayüz-canlı-API akışı Chrome/Firefox
  içindir.
- **Port 5173'ü frontend servisi tutuyor olabilir** — dev arayüzünü açmadan önce
  `cd frontend && docker compose stop web` (Vite `strictPort` ile çalışır, başka porta
  kaymaz; web kapalıyken kurulum linkleri çalışmaya devam eder çünkü onları backend
  sunar — yalnızca canlı panel kapanır). Servisler ayrı olduğu için arayüzü durdurmak
  API'ye hiç dokunmaz.

Env kuralları: `dotenv` yoktur, Node'un `--env-file-if-exists` desteği kullanılır.
**Sonraki dosya öncekini, gerçek ortam değişkeni hepsini ezer.** Backend dev:
`.env.development` → `.env.local` → kabuk; container: `.env.production` → `.env.local` →
kabuk. Sırlar yalnızca `backend/.env.local` (dev) ve `backend/.env` (compose) içindedir.
Frontend'de sıra Vite'ındır: `.env` → `.env.local` → `.env.[mode]` →
`.env.[mode].local` (`frontend/src/env-order.test.ts` bunu ölçer).

Her servisin `.env` dosyası **yalnızca kendi** `docker-compose.yml`'ine aittir; `docker
compose` bulunduğu dizindeki `.env`'i okur, yan klasördekini görmez.

`CORS_ORIGINS=http://localhost:5173` iki yerde de tanımlıdır: `backend/.env.development`
(yerel backend için) ve `backend/.env` (canlı API için) — ikisi de **backend'e** aittir.
Bu, frontend'e kurulan bir bağımlılık değildir: backend yalnızca *hangi origin'lerin bana
bağlanabileceğini* söyler, frontend'in nerede/nasıl çalıştığını bilmez. Vite `strictPort`
ile çalışır: 5173 doluysa sessizce kaymak yerine hata verir (kayan port CORS listesiyle
eşleşmez).

> **Port 3000 çakışması macOS'ta sessizdir.** Dev backend ile api container'ı aynı anda
> dinliyor görünebilir (biri IPv4, biri IPv6) ve istekler hangisine gittiği belli olmaz —
> üretim trafiği yanlış sürece düşebilir. Şüphede:
> `lsof -nP -iTCP:3000 -sTCP:LISTEN`, gerekirse `cd backend && docker compose stop api`.
>
> Hangi sürecin cevap verdiğini anlamanın hızlı yolu — **doğrudan `:3000`'e**, alan adı
> üzerinden değil — **`GET /healthz`**: dönen `uptime`
> **saniye** cinsindendir. Yeni başlattığınız sunucu `0`–`2` verir; büyük bir değer
> görüyorsanız cevabı veren sizin süreciniz değil, önceden çalışan container'dır.
> (13 Ağustos 2026'da tam olarak bu yaşandı: Docker Desktop arka planda açıldı,
> `restart: unless-stopped` eski container'ı geri getirdi ve test sonuçları yanıltıcı
> çıktı.)

Kod notları:

- Import yolları `.ts` uzantılıdır (Node kaynak dosyaları doğrudan çalıştırır; `tsc`
  derlemede `.js`'e çevirir). `constructor(private x: T)` sözdizimi kullanılmaz — Node'un
  tip sıyırma modu desteklemez.
- Yeni backend özelliği = `backend/src/modules/<ad>/` klasörü + `modules/index.ts`
  dizisine bir satır. Rotalar asla `server.ts`'e yazılmaz.
- `frontend` `backend`'den hiçbir şey import etmez; tek bağ HTTP'dir. DTO tipleri
  `frontend/src/api.ts` içinde **elle** senkron tutulur; bekçi testler yalnızca alan
  **adlarını** karşılaştırır (C10: `AppConfig`, C10b: `BuildDto`), tip değişikliğini
  yakalamaz.
- Uygulama simgeleri Apple'ın CgBI-PNG varyantından dönüştürülür
  (`backend/src/domain/ipa/cgbi.ts`); dönüşemeyen simge atlanır, kurulum etkilenmez.

### Testler

Gerçek paket kökteki `tests/` altında çerçevesiz `.mjs` betikleridir; kendi `npm install`'ı
yoktur ama iki yerde servislerin kurulu olmasına yaslanır: F13/F14 test örneğinin SQLite'ını
`backend/node_modules` içindeki `better-sqlite3` ile açar (backend zaten kurulu olmalı — sunucu
oradan başlatılır), C14 ise `frontend/node_modules/.bin/vitest`'i çocuk süreç olarak koşar
(yoksa atlanır). Frontend'in kendi `npm test`'i (vitest) iki dosyadır: `src/api.test.ts`
`fetch`'i taklit ederek "backend kapalı / nginx 502 / ağ hatası" gibi backend'in hiç
göremediği taşıma katmanı hatalarının arayüzde doğru mesaja dönüştüğünü sınar;
`src/env-order.test.ts` Vite'ın `.env` dosya sırasını gerçek `loadEnv` ile ölçer.

Test paketleri `tests/fixtures/` altındadır ve depoya girer: `.ipa`'lar `make-ipa.mjs` ile,
`.apk`'lar `make-apk.mjs` ile üretilir. APK üreticisi Android SDK build-tools (`aapt2`, `zipalign`,
`apksigner`) ve Java (`keytool`) ister — yalnızca yeniden üretmek için; koşum SDK istemez.
`demo-a.apk` bilerek `demo-a.ipa` ile aynı paket kimliğini taşır (platforma özel iptal testi).

```bash
node tests/run-suite.mjs            # tüm gruplar (A, B, C, D)
node tests/run-suite.mjs A C        # yalnızca seçilen gruplar
node tests/run-suite.mjs D --domain https://baska.adres
node tests/run-suite.mjs C --taban http://localhost:3010   # C'nin canlı bloğu için başka backend
```

Gruplar aynı ölçüde izole **değildir** — koşmadan önce bilin:

| Grup | Ne yapar | Neye dokunur |
|---|---|---|
| A | Her senaryo için ayrı bir backend süreci (geçici `DATA_DIR`, boş port; hiçbir `.env` okunmaz) | Hiçbir şeye |
| B | Sunucu başlatmaz: çalışan backend compose yığınına `docker compose config/exec` (`backend/` dizininden) + `ipa-apk-vartest` adlı geçici compose projesi (:38080) | Yığın kapalıysa ilgili adımlar atlanır; geçici proje sonda silinir |
| C | C1/C2/C3/C5/C16 **canlı** `--taban` adresine gider (varsayılan `http://localhost:3000` — bu makinede üretim api container'ı; ayakta olmalı). C3b web container'ını (`frontend/.env` `WEB_PORT`) yoklar. D/F/G/H/I blokları izole sunucuda | Canlı bloğu yalnızca okur |
| D | `suite-d-https.mjs`: yayındaki HTTPS zincirini hedefler. `backend/.env`'den `PUBLIC_BASE_URL`, `INSTALL_PATH_PREFIX`, `ADMIN_PASSWORD` okur, **canlı panele gerçek şifreyle girer**, üç geçici sürüm yükler (D5.1, D9.2, D10.1), birini iptal eder (D9.4), sonunda hepsini siler (D12.1) | **Üretim verisi** — koşum yarıda kesilirse artık sürümleri panelden silin |

> **Servis ayrımı (13 Ağustos 2026) tüm paketi kırmıştı; 20 Ağustos'ta onarıldı.** B ve D silinen
> kök `.env` / `docker-compose.yml`'i okuyordu; "A ve C etkilenmedi" iddiası da yanlıştı — C dört
> yerde kırıktı (C3b kök `.env`, F13/F14 kök `node_modules`'daki `better-sqlite3`, F20 kök
> `package.json`). İnceleyerek doğrulama kaçırmıştı, koşum saniyeler içinde yakaladı: **testler
> hakkındaki iddialar koşumdan gelir.** Bugün tüm betikler `backend/.env`,
> `backend/docker-compose.yml` (proje `ipa-apk-backend`) ve `frontend/.env` / `frontend/` kullanır.

Son tam yeşil koşum: **193/193** (26 Ağustos 2026, APK desteği; A 30 + C 100
`tests/reports/rapor-2026-08-26T08-28-38-829Z.json`, B 14 `…T08-27-51-364Z`, D 49
`…T08-26-47-543Z` — o raporda B12 kırmızıdır: B, api container'ı yenilendikten saniyeler sonra
koşmuş, healthcheck henüz `starting` idi; B tekrarı 14/14). Yeni Android grubu I1–I19 dahil.
İmajlar aynı gün yeniden kurulup dağıtıldı; gerçek bir APK (`com.kgm.gtbys` 1.2.5, 37 MB) alan adı
üzerinden yüklenip proxy'den bayt bayt aynı indirildi. Bir önceki tam koşum: **172/172**
(25 Ağustos 2026; A+C 109, B 14, D 49).
Senaryo matrisi `tests/TEST-PLAN.md` (oradaki "D. Admin Ayarlar" bloğu suite C'nin içindedir;
`run-suite.mjs D` ise HTTPS grubudur — harf çakışması tarihseldir), kanıt geçmişi
`tests/BULGULAR-HTTPS.md` (10 Ağustos ve öncesi; oradaki CORS duruşu 20 Ağustos'ta tersine
döndü), ham raporlar `tests/reports/`.

---

## Bakım

- **Şifre sıfırlama.** `ADMIN_PASSWORD` yalnızca ilk açılışta okunur (panelden
  değiştirilen şifre kalıcı olsun diye). Unutulursa `backend/.env`'e yeni şifreyi yazıp
  bir kez `ADMIN_PASSWORD_FORCE_RESET=true` ile başlatın, sonra değişkeni geri alın.
- **`SESSION_SECRET` değişirse** tüm oturumlar **ve dağıtılmış tüm imzalı linkler**
  geçersiz olur.
- **Canlı domain 502 veriyorsa** sorun sertifika değil, servisin kapalı olmasıdır. Artık
  iki ayrı yığın olduğu için hangisinin düştüğü ayrı ayrı bakılır: `/` 502 ise frontend,
  `/api/*` 502 ise backend. `cd backend && docker compose ps` / `cd frontend && docker
  compose ps`.
- **Alan adı üzerinden `/healthz` backend'i ölçmez — canlılık testi olarak kullanmayın.**
  O yolu *frontend* container'ının nginx'i sabit `200 "ok"` ile karşılar
  (`frontend/nginx.conf`); backend'in kendi `/healthz`'i ise proxy'nin taşıdığı `/api/*`
  önekinin **dışında** kaldığı için alan adından erişilemez. 25 Ağustos 2026'da ölçüldü:
  `api` durdurulmuşken `https://…/healthz` hâlâ `200 ok` derken bütün `/api/*` 502
  veriyordu. Backend'i `/api/*` altından yoklayın (örn. `GET /api/settings`) ya da
  doğrudan `:3000` üzerinden `/healthz` çağırın.
- **Log:** `cd backend && docker compose logs -f api` — arayüz için
  `cd frontend && docker compose logs -f web`. **Sağlık:** her servisi kendi portunda
  `GET /healthz` ile (backend'inki `uptime` saniyesini de döner).
- **Durdurma sırası yoktur** — servisler birbirine bağlı değildir. Arayüzü kapatmak
  kurulum linklerini etkilemez (onları backend sunar); API'yi kapatmak paneli işlevsiz
  bırakır ama SPA yine yüklenir.

---

## Güvenlik notları

- Şifreler `scrypt` ile özetlenir; harici kripto bağımlılığı yoktur.
- Kurulum sayfaları `noindex` etiketlidir; token'lar tahmin edilemez; imzasız
  manifest/ipa erişimi 403 alır.
- Yükleme her zaman yönetici oturumu ister; bunu kapatan ayar yoktur.
- Oturum çerezi `SameSite=None; Secure; HttpOnly` (CORS açık olduğu için). CSRF koruması
  Origin doğrulama katmanındadır: durum değiştiren isteklerde tanınmayan `Origin` 403 alır
  (`server.ts`; testleri D3.8/D3.9).
- Enterprise sertifikayla kurum dışına dağıtım sertifika iptali riski doğurur — iptalde
  aynı imzayla kurulmuş **tüm** uygulamalar açılmaz olur.

## Lisans

Dahili kullanım.
