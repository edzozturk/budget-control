# Budget Control

Kişisel bütçe kontrol uygulaması: gelir/gider takibi, kategoriler, hesaplar ve çoklu para birimi. Bilgisayarında şifreli bir veritabanıyla çalışır; aynı kod sunucuya veya buluta da kurulabilir.

> Durum: 1. aşama (temel). Bütçe limitleri, tekrarlayan ödemeler, raporlar, dışa aktarma, yatırımlar ve forecast sonraki aşamalarda gelecek.

## Windows'ta kurulum (git ile)

Bir kerelik hazırlık:

1. [Node.js 22 LTS](https://nodejs.org/) ve [Git for Windows](https://git-scm.com/download/win) kur ("Next" ile geçmen yeterli).
2. Projeyi koymak istediğin klasörde sağ tık → **Open Git Bash here** (ya da bir terminal aç) ve çalıştır:

   ```bash
   git clone https://github.com/edzozturk/budget-control.git
   ```

   İlk seferde GitHub giriş penceresi açılır; depo özel olduğu için giriş yapman gerekir.
3. `budget-control` klasöründeki **`baslat.bat`** dosyasına çift tıkla. İlk seferde kurulum birkaç dakika sürer, sonra tarayıcı kendiliğinden açılır.

Verilerin `server\data` klasöründe durur. Git bu klasöre hiç dokunmaz; güncelleme ya da dal değiştirme verilerini silmez.

### Güncelleme ve yeni özellikleri deneme

Her yeni özellik ayrı bir dalda (branch) gelir. Denemek için `budget-control` klasöründe terminal açıp:

```bash
git fetch
git checkout <dal-adı>     # örn. phase-2-loans-cards
git pull
```

Sonra `baslat.bat`'a çift tıkla; kod değiştiyse kendisi yeniden derler. Ana sürüme dönmek için `git checkout main` ve `git pull`.

Önemli: yeni bir dal veritabanını yeni sürüme yükseltir. Yükseltilmiş veritabanı eski sürümde açılmayabilir. Denemeden önce `server\data` klasörünün bir kopyasını almak iyi olur.

## Bilgisayara kurulum (Windows, Mac, Linux)

1. [Node.js 22 LTS](https://nodejs.org/) kur (bir kerelik).
2. Bu depoyu indir: GitHub'da **Code → Download ZIP** ya da `git clone`.
3. Klasörde bir terminal aç ve şunları çalıştır:

   ```bash
   npm install
   npm run build
   npm start
   ```

4. Tarayıcıda **http://localhost:4310** adresini aç. İlk açılışta ana şifreni belirlersin.

Sonraki açılışlarda sadece `npm start` yeterli. Kapatmak için terminalde `Ctrl+C`.

### Verilerin nerede?

Varsayılan olarak proje klasöründeki `data/budget.db` dosyasında, ana şifrenle **AES-256 (SQLCipher)** ile şifreli olarak durur. Bu dosya depoya hiçbir zaman gönderilmez (`.gitignore`). Yedek almak için bu dosyayı kopyalaman yeterli; şifre olmadan okunamaz.

**Ana şifreni unutursan veriler kurtarılamaz.**

### Telefondan açmak

`.env` dosyasında `HOST=0.0.0.0` yaparsan aynı Wi‑Fi'daki telefonundan `http://<bilgisayarın-IP-adresi>:4310` ile açabilirsin. Varsayılan olarak kapalıdır; uygulama yalnızca bu bilgisayardan erişilebilir.

## Ayarlar

Kuruluma özel her şey ortam değişkenlerinden veya proje kökündeki `.env` dosyasından gelir. Örnek için [`.env.example`](.env.example) dosyasını `.env` olarak kopyala.

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Dinlenen adres. `0.0.0.0` ağa açar. |
| `PORT` | `4310` | Port. |
| `DATA_DIR` | `./data` | Veritabanının klasörü. |
| `DB_DRIVER` | `sqlite` | Şimdilik `sqlite` (yerel, şifreli). Bulut için PostgreSQL planlı. |
| `DB_FILE` | `budget.db` | Veritabanı dosyasının adı. |
| `APP_NAME` | `Budget Control` | Ekranda görünen ürün adı. |
| `DEFAULT_LOCALE` | `tr` | İlk kurulum dili (`tr`, `en`). |
| `DEFAULT_CURRENCY` | `TRY` | İlk kurulum ana para birimi. |
| `SESSION_IDLE_MINUTES` | `30` | Bu kadar dakika işlem yapılmazsa uygulama kilitlenir. |
| `COOKIE_SECURE` | `false` | HTTPS arkasında çalışırken `true`. |

Dil, ana para birimi, ay başlangıç günü, bütçe uyarı eşiği ve tema uygulamanın **Ayarlar** ekranından değişir.

## Docker ile kurulum (sunucu / bulut)

```bash
docker build -t budget-control .
docker run -d -p 4310:4310 -v budget-data:/data --name budget budget-control
```

Veriler `budget-data` adlı Docker volume'unda şifreli olarak durur.

## Geliştirme

```bash
npm install
npm run dev        # sunucu (4310) + arayüz (5173), değişiklikleri canlı yükler
npm test           # API testleri
npm run typecheck
```

- `server/`: Node.js + Fastify API, SQLite + SQLCipher, Drizzle ORM. Şema `server/src/db/schema.ts`; şema değişince `npm run db:generate` ile yeni migration üretilir, açılışta otomatik uygulanır.
- `web/`: React + Vite + Tailwind arayüzü; derlenince sunucu tarafından aynı porttan servis edilir.
- Tutarlar her yerde para biriminin en küçük biriminde tam sayı olarak tutulur (1250 = 12,50 TL).
- Her kayıt bir `workspace_id` taşır; bulut sürümünde aynı kurulum birden fazla müşteriye hizmet verebilir.
