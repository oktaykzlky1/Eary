# Mac Codex Handoff

Mac tarafindaki Codex once bu dosyayi ve `docs/MICROPHONE_STABILITY_GUARD.md` dosyasini okumali. Su an Windows tarafinda her sey dogrulandi ve GitHub'a pushlandi.

## En Guncel Repo Durumu

Son iyi commit:

```text
1effa1a Remove contact invite flow and harden link requests
```

Mac'te mevcut clone varsa:

```bash
cd Eary
git status --short
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

`git log -1 --oneline` ciktisi `1effa1a Remove contact invite flow and harden link requests` olmali.

Mac'te lokal degisiklik varsa once kaybetmeden sakla:

```bash
git status --short
git stash push -u -m "mac-local-before-1effa1a"
git pull --ff-only origin main
```

## Mac'te Sifirdan Ortam

```bash
git clone https://github.com/oktaykzlky1/Eary.git
cd Eary
npm install
npm run check:microphone
npm run lint
npm run build
npx cap sync android
npx cap sync ios
```

Gerekli araclar:

- Node.js ve npm.
- Android Studio ve Android SDK.
- Java icin Android Studio'nun bundled JBR/JDK kullanilabilir.
- iOS gelistirme icin Xcode gerekir.

## Bu Committe Yapilan Son Kritik Isler

- Yeni sohbet ekranindan `Rehberden bul / Telefon rehberinden bul` tamamen kaldirildi.
- Android `READ_CONTACTS` izni kaldirildi.
- Android `EaryContactsPlugin` silindi ve `MainActivity` kaydi kaldirildi.
- Yeni sohbet acilinca arama kutusu artik otomatik focus almiyor; klavye kendiliginden acilmiyor.
- Eski `1 / 2 / 3 - Istek gelir / Kabul edilir / Sohbet acilir` aciklama blogu kaldirildi.
- Davet linki mimarisi guclendirildi:
  - Link acilinca `eary_pending_invite_v1` olarak lokal bekleyen davet saklanir.
  - Profil hazir olunca Firebase'e karsi tarafa `messageRequests` kaydi yazilir.
  - Karsi taraf kabul edince normal sohbet akisi ve kabul bildirimi devreye girer.
- Menu switch/toggle dugmelerindeki topun cerceve disina tasma sorunu duzeltildi.
- `npm run check:microphone` guard'i artik rehber akisi geri gelirse hata verecek sekilde guncellendi.
- Mikrofon calisma mekanizmasina dokunulmadi.

## Windows Tarafinda Gecen Dogrulamalar

```bash
npm run check:microphone
npm run lint
npm run build
npx cap sync android
npx cap sync ios
cd android && ./gradlew assembleDebug
cd android && ./gradlew bundleRelease
```

Hepsi basarili gecti.

## Mac Dogrulama Sirasi

Mac yeni kodu cektikten sonra en az su sirayi calistirsin:

```bash
npm install
npm run check:microphone
npm run lint
npm run build
npx cap sync ios
npx cap sync android
```

Android test APK:

```bash
cd android
./gradlew assembleDebug
```

Android release AAB:

```bash
cd android
./gradlew bundleRelease
```

## Android Release / Play Hazirligi

Mac'te Play'e yuklenecek yeni AAB alinacaksa imza dosyalari Mac'e guvenli bicimde tasinmali. Bu iki dosya git'e girmez ve girmemeli:

```text
android/eary-upload-key.jks
android/keystore.properties
```

Bu dosyalar kaybolursa Google Play guncellemeleri zorlasir.

Release AAB yolu:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Debug APK yolu:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Windows'ta Uretilen Son Paketler

Debug APK:

```text
C:\Users\aslih\Documents\Codex\2026-07-11\markete-giris\outputs\eary-1effa1a-debug.apk
```

Release AAB:

```text
C:\Users\aslih\Documents\Codex\2026-07-11\markete-giris\outputs\eary-1effa1a-release.aab
```

## Mac Icin Dikkat Edilecek Kurallar

- Mikrofon dosyalarina dokunmadan once ve sonra `npm run check:microphone` calissin.
- Sohbet mikrofonu ve ortam dinleme performansi su an iyi kabul ediliyor; bu akislari refactor etme.
- `READ_CONTACTS`, `EaryContactsPlugin`, `onOpenContacts`, `openContactPicker`, `Telefon rehberinden bul` geri getirilmemeli.
- Yeni sohbet ekraninda arama input'una `autoFocus` geri eklenmemeli.
- Paylas butonu native share sheet acmali; sadece kopyalama davranisina dusmemeli, ancak share sheet acilamazsa fallback olarak kopyalayabilir.
- iOS gelistirme devam ederken `npx cap sync ios` sonrasi Xcode'da app acilip smoke test yapilmali.

## Kisa Smoke Test Listesi

1. Ana ekranda `Sohbetler > yeni sohbet` acilinca klavye otomatik acilmamali.
2. Yeni sohbet ekraninda rehber butonu gorunmemeli.
3. Paylas butonu telefondaki paylasim uygulamalarini acmali.
4. Davet linki acilinca profil hazirsa gonderen kisinin sohbet isteklerine dusmeli.
5. Menu switch'lerinde beyaz top cerceve disina tasmamali.
6. Sohbet mikrofonu duraksamada eski metni silmemeli.
7. Ortam dinleme uzun metni korumali ve ceviri ana metnin altinda tek metin olarak gorunmeli.
