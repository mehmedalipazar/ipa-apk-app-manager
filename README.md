# ipa-ota-download

Kendi sunucunuzda çalışan iOS **OTA (over-the-air)** dağıtım servisi. IPA'yı panelden
yükleyin, süreli bir kurulum linki alın; alıcı linki iPhone'da Safari ile açıp tek
dokunuşla kurar. Diawi / InstallOnAir muadili — dosyalarınız üçüncü taraf sunucuya çıkmaz.

Öne çıkanlar: sürükle-bırak yükleme, otomatik IPA çözümleme (paket adı, sürüm, simge),
süreli + şifreli + QR kodlu linkler, admin panel (sürümler, sayaçlar, tüm ayarlar),
otomatik disk temizliği, uçtan uca TypeScript, Docker ile tek komut kurulum.

---

## ⚠️ HTTPS zorunludur

iOS, OTA kurulumu yalnızca **geçerli sertifikalı HTTPS** üzerinden yapar. `http://`,
self-signed veya eksik zincirli sertifikada kurulum **cihazda hiçbir hata göstermeden**
başarısız olur. Uygulama TLS sonlandırmaz: önüne bir ters proxy koyun ve
`PUBLIC_BASE_URL`'i `https://` adrese ayarlayın. `http://localhost:3000` yalnızca arayüzü
ve yükleme akışını test etmek içindir — cihaza kurulum yapamaz.

**Enterprise (In-House)** imzalı IPA her cihaza kurulur; **Ad-Hoc** imzalı IPA yalnızca
UDID'si provisioning profile'a eklenmiş cihazlara. Servis imzaya karışmaz.

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
| uygulama ayarı | `.env.development` / `.env.production` / `.env.local` | aynı üçlü (Vite okur) |
| yayın | `backend/docker-compose.yml` → proje `ipa-ota-backend` | `frontend/docker-compose.yml` → proje `ipa-ota-frontend` |
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
- **`.env` dosyalarını Node okumaz.** Her iki serviste de `.env` yalnızca `docker compose`
  içindir; uygulamanın kendi ortam dosyaları `.env.development` / `.env.production` /
  `.env.local`'dır ve `package.json` içinde açıkça listelenir. Tek istisna: **Vite**
  `frontend/.env`'i de yükler — bu yüzden oraya `VITE_` önekli bir değişken yazmayın,
  sessizce derlemeye sızar.
- Compose proje adları dosyalarda sabitlenmiştir (`ipa-ota-backend`, `ipa-ota-frontend`).
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
tar czf ipa-ota-yedek-$(date +%F).tar.gz data-docker/
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
  Token 22 karakter rastgeledir; `manifest.plist` ve `app.ipa` adresleri `token + amaç`
  ikilisine bağlı kısa ömürlü **HMAC imzası** taşır: A linki B'nin dosyasına erişemez,
  imzasız erişim 403 alır.
- İsteğe bağlı **link şifresi** ikinci katmandır; doğrulanmadan imzalı adresler sayfaya
  hiç yazılmaz. Linki elde eden herkes kurabilir — kişi bazlı kimlik gerekiyorsa şifre
  kullanın ya da servisi VPN/SSO arkasına alın.

Neden çerez değil imzalı URL? `itms-services://` zincirinde dosyaları Safari değil,
iOS'un `installd` süreci indirir ve Safari'nin çerezlerini görmez — çerez tabanlı koruma
OTA kurulumunu bozar. Kurulum yollarına oturum kontrolü eklemeyin.

---

## Kullanım

Panele girin → IPA'yı sürükleyin → süre / not / şifre seçin → çıkan linki paylaşın.
Alıcı linki iPhone'da **Safari** ile açar; Enterprise imzalı uygulamada ilk açılışta
*Ayarlar › Genel › VPN ve Aygıt Yönetimi*'nden **Güven** demesi gerekir (kurulum sayfası
bunu anlatır).

Süre / not / şifre `Sürümler › Düzenle`den sonradan değiştirilir; panel yalnızca
dokunduğunuz alanı gönderir. Süre düzenlerken taban seçilir:

- **Yükleme anından** (varsayılan) — yüklemedeki tercihi düzeltir; sonuç geçmişe
  düşerse link kapanır (panel önceden uyarır).
- **Şimdiden** — süresi dolmuş linki yeniden canlandırır.

İptal bundan bağımsızdır: süre düzenlemek iptal edilmiş linki açmaz; **İptal et /
Yeniden aç** ayrıca yönetilir.

---

## Ayarlar

**Genel adres (baseUrl) hariç** hepsi panelden değişir ve anında geçerli olur. baseUrl
yalnızca `PUBLIC_BASE_URL` ortam değişkeninden gelir, panelde salt okunur görünür —
yanlış host'lu manifest cihazda sessizce başarısız olduğu için panelden değiştirilemez.

| Ayar | Varsayılan | Not |
|---|---|---|
| Varsayılan link süresi | 24 saat | Yeni linklerin ömrü |
| En uzun link süresi | 720 saat | Panel tavanı; en fazla 8760 (1 yıl) |
| Silme gecikmesi | 24 saat | Süresi dolan IPA'nın diskten silinme gecikmesi |
| İmzalı link ömrü | 120 dk | manifest/ipa imza geçerliliği (linkin ömründen bağımsız) |
| En büyük dosya boyutu | 1024 MB | Kabul edilen en büyük IPA |
| Önceki sürümü otomatik iptal | kapalı | Aynı bundle-id yüklenince eskisini kapatır |
| Site adı / Kurulum notu / QR | — | Kurulum sayfasının görünümü |

Link süresi üç kademedir: kod tavanı `MAX_TTL_HOURS = 8760`
(`backend/src/config/settings.schema.ts`) → panel tavanı *En uzun link süresi* (formdaki
hazır süre düğmelerini de filtreler) → linkin kendi süresi (yükleme formu). 1 yıllık link
için önce ayardan 8760, sonra formda **1 yıl**. Süresi dolan link `410` döner; dosyası
*Silme gecikmesi* kadar sonra silinir, kayıt "purged" olarak kalır.

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
| `frontend/.env.local` | `http://localhost:3000` | yerel backend ile çalışmak için ezme (şablon: `.env.local.example`) |

Geliştirme akışı bilinçli olarak cross-origin'dir (karar: 2026-08-10): dev arayüzü kendi
origin'inde (5173) çalışır ve varsayılan olarak **canlı API'ye** konuşur. Üç uyarı:

- **Dev panelindeki işlemler canlı veriye gider** — yükleme/silme/ayar denemeleri için
  `frontend/.env.local` ile yerel backend'e dönün.
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
  `frontend/src/api.ts` içinde **elle** senkron tutulur (bekçi test: C10).
- Uygulama simgeleri Apple'ın CgBI-PNG varyantından dönüştürülür
  (`backend/src/domain/ipa/cgbi.ts`); dönüşemeyen simge atlanır, kurulum etkilenmez.

### Testler

Gerçek paket kökteki `tests/` altında çerçevesiz `.mjs` betikleridir (yalnızca Node
builtin'leri kullanır, kurulum gerektirmez). Tek istisna `frontend`'deki `npm test`
(vitest): `fetch`'i taklit ederek "backend kapalı / nginx 502 / ağ hatası" gibi backend'in hiç
göremediği taşıma katmanı hatalarının arayüzde doğru mesaja dönüştüğünü sınar; suite C'nin
C14 adımı bunu otomatik koşar.

```bash
node tests/run-suite.mjs A C    # şu an sağlıklı çalışan gruplar
node tests/run-suite.mjs        # tüm gruplar
```

> **⚠️ B ve D grupları servis ayrımından sonra onarım bekliyor (13 Ağustos 2026).**
> Bu betikler kök `.env` ve kök `docker-compose.yml` dosyalarını okuyacak şekilde
> yazılmıştı; ikisi de artık yok. Etkilenen yerler: B1, B4, B5 (`readFileSync(KOK/.env)`
> ve kök `docker compose config`) ve D'nin `PUBLIC_BASE_URL`'i kök `.env`'den okuması.
> Onarım = bu yolları `backend/.env` ve `backend/docker-compose.yml`'e çevirmek.
> **A ve C grupları etkilenmedi**: backend'i `cwd: backend/` ile ayrı süreç olarak
> başlatıp env'i açıkça geçiriyorlar, hiçbir `.env` dosyası okumuyorlar.
>
> D grubunu bu arada elle hedefleyebilirsiniz:
> `node tests/run-suite.mjs D --domain https://ipa-ios.simurgbilisim.com`

Ayrım öncesi son tam koşum: **156/156** (10 Ağustos 2026, aynı gün build edilen
imajlarla). Senaryo matrisi `tests/TEST-PLAN.md`, kanıt geçmişi
`tests/BULGULAR-HTTPS.md`, ham raporlar `tests/reports/`.

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
