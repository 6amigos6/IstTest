# IST Trust Zone

Dənizçi sənədlərinin idarə edilməsi üçün tam funksional veb platforma.
Realtime məlumat üçün **Firebase Realtime Database**, fayl saxlama/yükləmə üçün **Google Drive API** istifadə olunur.

İstifadəçi Paneli və Admin Paneli **iki ayrı səhifə** olaraq kodlanıb (`index.html` / `admin.html`), amma hər ikisi **eyni Firebase Realtime Database**-ə qoşulduğu üçün aralarında tam realtime sinxronizasiya var — admin bir dinləyici və ya fayl əlavə edən kimi, İstifadəçi Panelini açıq saxlayan hər kəsdə səhifə yenilənmədən dərhal görünür.

Login/Sign-up yoxdur — Admin Panelə giriş İstifadəçi Panelindəki axtarış xanasına `1006` yazıb Enter basmaqla, `admin.html`-ə yönləndirmə vasitəsilə edilir. (Google Drive-a fayl yükləmək üçün isə admin bir dəfə öz Google hesabı ilə icazə verməlidir — aşağıya bax.)

## Fayl strukturu

```
IstServices/
├── index.html               → İstifadəçi Paneli (əsas səhifə)
├── admin.html                → Admin Paneli (ayrı səhifə, öz məntiqi ilə)
├── css/style.css             → Ümumi dizayn (hər iki səhifə paylaşır)
├── js/
│   ├── firebase-config.js    → Firebase və Google Drive konfiqurasiyası
│   ├── shared.js             → Hər iki panelin paylaşdığı əsas məntiq (Firebase, utils, dialoglar, preview)
│   ├── drive.js               → Google Drive OAuth girişi və fayl yükləmə/silmə məntiqi (yalnız admin.js istifadə edir)
│   ├── user.js                → Yalnız İstifadəçi Panelinə aid məntiq
│   └── admin.js               → Yalnız Admin Panelinə aid məntiq
└── assets/logo.png            → Loqo
```

Heç bir build addımı tələb olunmur — sadəcə statik fayllardır. Hər hansı statik hosting (Firebase Hosting, Netlify, Vercel, cPanel və s.) üzərinə birbaşa yükləyə bilərsiniz, ya da lokal test üçün bir statik server ilə açın (`index.html`-i birbaşa `file://` ilə açsanız, bəzi brauzerlər ES module importlarını bloklaya bilər — buna görə `npx serve` və ya oxşar sadə server tövsiyə olunur).

## Vacib: işə salmadan əvvəl 2 tənzimləmə

Bunlar olmadan sistem işləməyəcək, çünki heç bir giriş/parol istifadə olunmur:

### 1. Firebase Realtime Database qaydaları

Firebase Console → Realtime Database → Rules bölməsində, ictimai oxuma/yazma icazəsi verilməlidir (layihədə login olmadığı üçün):

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> Qeyd: bu qaydalar bazanı tam açıq edir. Əgər gələcəkdə əlavə təhlükəsizlik lazımdırsa, admin girişini IP-yə görə məhdudlaşdırmaq və ya Firebase App Check əlavə etmək tövsiyə olunur.

### 2. Google Drive quraşdırması ✅ (Client ID artıq inteqrasiya olunub)

Fayllar admin-in öz Google Drive-ına yüklənir və "hər kəs linklə görə bilər" şəklində paylaşılır; həmin link isə Firebase-də saxlanılıb İstifadəçi Panelində göstərilir.

`js/firebase-config.js` faylında `googleDriveConfig` artıq tam doludur:
- `apiKey`: `AIzaSyCo5Od1i-6g7gxgrq3yon1clyKU3S2b0lE`
- `clientId`: `377661699117-g1b7kdao9m278pm33nl0pfl8t2j5r153.apps.googleusercontent.com`

**Vacib məhdudiyyət — Authorized JavaScript origin:** Google Cloud Console-da bu Client ID üçün icazə verilən domen yalnız **`https://istservices.vercel.app`**-dir. Yəni:
- Sayt yalnız həmin domendə (`https://istservices.vercel.app`) açıldıqda Google Drive girişi işləyəcək.
- Başqa domendə (fərqli Vercel deploy linki, öz domeniniz, `localhost` və s.) açsanız, Google girişi **"redirect_uri_mismatch" və ya "origin not allowed"** xətası verəcək.
- Əgər gələcəkdə başqa domenə keçsəniz, Google Cloud Console → Credentials → bu Client ID → **Authorized JavaScript origins** bölməsinə yeni domeni əlavə etməlisiniz.

**Təhlükəsizlik qeydi:** Yüklədiyiniz `client_secret_*.json` faylında bir `client_secret` dəyəri də var idi. Bu, yalnız **server-side** OAuth axınları üçündür və heç vaxt brauzer/frontend koduna qoyulmamalıdır (əks halda hər kəs onu görüb sui-istifadə edə bilər). Ona görə həmin sirri layihəyə **qəsdən daxil etmədim** — yalnız təhlükəsiz olan `client_id` istifadə olunur, çünki bu tip brauzer-daxili OAuth axını (Google Identity Services) üçün sirr tələb olunmur.

Əgər hələ "Testing" statusundadırsa (OAuth consent screen), Google yalnız sizin əlavə etdiyiniz test istifadəçilərinə icazə verəcək — **OAuth consent screen → Test users** bölməsindən admin kimi giriş edəcək Google hesabını əlavə edin.

Admin Panelini açıb ilk dəfə fayl yükləməyə çalışanda (və ya başlıqdakı "Google Drive qoşulmayıb" düyməsinə basanda) brauzer Google giriş pəncərəsi açacaq — admin hesabı seçib icazə verdikdən sonra yükləmələr işləməyə başlayacaq.

## İstifadə

**İstifadəçi Paneli** (`index.html`, ilk açılan səhifə)
- Loqo və axtarış xanası yuxarıda, altında bölmələrin siyahısı.
- Axtarış hərflə yazıldıqca dərhal filtr olunur (böyük/kiçik hərf fərqi yoxdur).
- Bölmə üzərinə klikləndikdə həmin bölmədəki sənədlər açılır — hər sənədin yanında **Bax** (PDF/şəkil/video birbaşa brauzerdə açılır) və **Yüklə** (fayl birbaşa endirilir) düymələri var.

**Admin Panelə giriş**
- Axtarış xanasına `1006` yazıb Enter basın — brauzer `admin.html`-ə yönləndirilir.
- Panel açılan kimi mövcud dinləyicilər dərhal görünür (əlavə klikə ehtiyac yoxdur).
- Başlıqdakı düymə Google Drive qoşulub-qoşulmadığını göstərir (qırmızı nöqtə = qoşulmayıb, yaşıl = qoşuludur); ilk fayl yükləməsində və ya bu düyməyə basanda Google giriş pəncərəsi açılır.
- Dinləyici əlavə et/adını dəyiş/sil, dinləyici daxilində fayl yüklə/adını dəyiş/əvəz et/sil (fayllar Google Drive-a yüklənir).
- Bütün dəyişikliklər Firebase Realtime Database vasitəsilə İstifadəçi Panelində səhifə yenilənmədən dərhal görünür — və əksinə.
- "İstifadəçi panelinə qayıt" düyməsi ilə `index.html`-ə geri qayıdılır.

Sistem ilk açıldıqda tamamilə boşdur — heç bir demo məlumat yoxdur, yalnız admin tərəfindən əlavə edilənlər görünür.

## Yeni əlavələr (UI/UX yeniləməsi)

**Tema sistemi** — Header-də (axtarışın sağında) İşıqlı / Tünd / Mavi tema seçimi var. Seçim `localStorage`-da saxlanılır və bütün səhifələrdə (index.html + admin.html) tətbiq olunur, səhifə yenidən açılanda itmir.

**Splash + Giriş ekranı** — `index.html` açılanda əvvəlcə loqo ilə qısa bir yüklənmə ekranı, sonra (sessiya yoxdursa) şifrə ekranı görünür. İlkin şifrə: `ist@2026`. Şifrə heç vaxt açıq mətn kimi frontend kodunda saxlanılmır — yalnız "duzlanmış" (salted) SHA-256 heşi Firebase-də (`config/auth`) saxlanılır və brauzerin daxili Web Crypto API-si ilə yoxlanılır. Admin Paneldəki **Sazlamalar** bölməsindən şifrə dəyişdirildikdə, bu brauzer istisna olmaqla bütün sessiyalar etibarsız olur — hər kəs növbəti girişdə yeni şifrəni daxil etməlidir. `admin.html` birbaşa URL ilə açılsa belə eyni sessiya yoxlanılır.

> Vacib qeyd: layihədə real backend/server olmadığı üçün (README-də qeyd olunduğu kimi Firebase qaydaları ictimai oxuma/yazmaya açıqdır), bu, mövcud arxitektura daxilində əldə edilə bilən ən güclü giriş sistemidir. Tam server-side təhlükəsizlik üçün Firebase Auth + Security Rules əlavə edilməlidir.

**Dinləyici məlumatları** — Admin indi hər dinləyiciyə telefon və e-mail əlavə edə bilər (optional). Dəyişikliklər realtime olaraq İstifadəçi Panelində, sənəd siyahısının üstündə kiçik "pill" şəklində görünür.

**Sənəd yükləmə** — Admin Panelində fayl əlavə etmə bölməsi indi tam Drag & Drop dəstəkləyir (klikləyərək seçim də mövcuddur), limitsiz sayda faylı eyni anda seçmək/sürükləmək mümkündür, hər biri üçün ayrıca proqres göstərilir.

**Yeni dinləyici** — Əlavə edildiyi kimi avtomatik onun səhifəsinə keçilir, əlavə klik tələb olunmur.
