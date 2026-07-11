# Mac Codex Handoff

Mac tarafindaki Codex, once bu dosyayi ve `docs/MICROPHONE_STABILITY_GUARD.md` dosyasini okumali. Mikrofon ozellikleri su anda calisir durumda kabul edilir; amac bu davranisi bozmadan yeni kodlari almak ve gelistirmeye devam etmektir.

## Mac'te Sifirdan Ortam

```bash
git clone https://github.com/oktaykzlky1/Eary.git
cd Eary
npm install
npm run check:microphone
npm run lint
npm run build
npx cap sync android
```

Gerekli araclar:

- Node.js ve npm. Windows tarafinda son dogrulama Node `v25.2.1`, npm `11.6.2` ile yapildi.
- Android Studio ve Android SDK.
- Java icin Android Studio'nun bundled JBR/JDK kullanilabilir.
- iOS build alinacaksa Xcode ve CocoaPods gerekir; Android market cikisi icin zorunlu degil.

## Android Release / Play Hazirligi

Mac'te Play'e yuklenecek yeni AAB alinacaksa once imza dosyalari Mac'e guvenli bicimde tasinmali. Bu iki dosya git'e girmez ve girmemeli:

```text
android/eary-upload-key.jks
android/keystore.properties
```

Bu dosyalar kaybolursa Google Play guncellemeleri zorlasir. Mac'e kopyalandiktan sonra kontrol:

```bash
ls -l android/eary-upload-key.jks android/keystore.properties
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```

Release AAB yolu:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Debug APK:

```bash
cd android
./gradlew assembleDebug
```

## Bu Committeki Market-Oncesi Durum

- Sohbetten foto/video secme, kamera acma, medya yukleme ve medya viewer akisi kaldirildi.
- Firebase Storage importlari aktif app kodundan temizlendi.
- Android manifestten kamera izni kaldirildi.
- Profil fotografi ve grup fotografi yukleme akislari ilk market surumu icin kapatildi.
- Mikrofon stabilite guard'i ve `npm run check:microphone` korunmali.
- Play release notlari `docs/PLAY_RELEASE_PREP.md` icinde.

## Ilk Bakilacak Komutlar

```bash
git status --short
git diff -- src/utils/speech.js src/components/AccessibilityHub.jsx src/components/IntercomInterface.jsx src/components/ConversationInfo.jsx android/app/src/main/java/com/asleyduo/app/EarySpeechPlugin.java src/main.jsx src/components/RoomSetup.jsx src/components/ChatHome.jsx package.json scripts/check-microphone-regressions.mjs docs/MICROPHONE_STABILITY_GUARD.md docs/MAC_CODEX_HANDOFF.md
```

## Mac Dogrulama Sirasi

```bash
npm install
npm run check:microphone
npx eslint src/utils/speech.js src/components/AccessibilityHub.jsx src/components/IntercomInterface.jsx --max-warnings=0
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Release bundle kontrolu:

```bash
cd android && ./gradlew bundleRelease
```

## Degisiklikleri Anlamak Icin Kisa Ozet

- `speech.js`: Native Android recognizer kapansa bile JS wrapper kullanici durdurmadikca dinleme niyetini korur. Noktalama kapali kalir.
- `EarySpeechPlugin.java`: Android tarafinda stop ile lifecycle end/error ayrildi; son taninan metin kaybolmadan final olarak gonderilir.
- `AccessibilityHub.jsx`: Not Defteri, Ortam Dinleme ve Yuz Yuze tek duz metin akisi mantigina alindi. Eski/yeni pencere veya konusma parcasi mantigi geri getirilmemeli.
- `IntercomInterface.jsx`: Sohbet ve sesli mesajlar 700 karakter siniri ile ayni kurala baglandi; foto/video upload akisi kaldirildi.
- `ConversationInfo.jsx`: Grup/profil fotografi ve medya galerisi ilk market surumu icin kaldirildi.
- `main.jsx`, `RoomSetup.jsx`, `ChatHome.jsx`: Login sonrasi permission hatalari app acilisini tamamen dusurmesin diye hata yakalama eklendi.

## Sonraki Isler Icin Kural

Mikrofon dosyalarinda degisiklik yapmadan once `npm run check:microphone` gecmeli, degisiklikten sonra tekrar gecmeli. Performans veya tasarim isleri yapilirken mikrofon transcript akisi refactor edilmemeli.
