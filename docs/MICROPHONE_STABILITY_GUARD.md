# Microphone Stability Guard

Bu not, su anda calisan mikrofon davranisini korumak icin yazildi. Not Defteri, Ortam Dinleme, Yuz Yuze ve Sohbet mikrofonlari calisir durumda kabul edilir. Bundan sonraki islerde hedef, bu davranisi bozmadan performans ve yan bolgeleri gelistirmektir.

## Korunacak Davranislar

- Not Defteri ve Ortam Dinleme kullanici durdurana kadar duz metin olarak yazmaya devam eder.
- Konusmadaki kisa sessizlik, duraklama veya Android SpeechRecognizer lifecycle bitisi ekrani temizlemez.
- Canli metinde sayfa, kart, pencere, cerceve veya "konusma parcasi" mantigi geri getirilmez.
- Canli mikrofon akisi noktalama duzeltmesi yapmaz. `addPunctuation: false` kalmalidir.
- Eski metin ile yeni metin ayrimi kullaniciya hissettirilmez; mikrofon kapanana kadar tek bir yazi akisi vardir.
- Native recognizer iceride toparlanabilir, ama UI bunu yeni mesaj/yeni sayfa gibi gostermemelidir.
- Android tarafinda stop sadece kullanici durdurdugunda gercek stop sayilir.
- Yuz Yuze ve Sohbet mesajlarinda 700 karakter siniri korunur.

## Kritik Dosyalar

- `src/utils/speech.js`: JS speech wrapper, native listener, recoverable restart, punctuation ayari.
- `android/app/src/main/java/com/asleyduo/app/EarySpeechPlugin.java`: Android `SpeechRecognizer` lifecycle, silence/min length ayarlari, final text flush.
- `src/components/AccessibilityHub.jsx`: Not Defteri, Ortam Dinleme, Yuz Yuze live transcript akisi.
- `src/components/IntercomInterface.jsx`: Sohbet mikrofonu ve 700 karakter siniri.
- `src/main.jsx`, `src/components/RoomSetup.jsx`, `src/components/ChatHome.jsx`: Login sonrasi Firebase permission hatalarinin app acilisini dusurmemesi.

## Regresyon Kontrolu

Mikrofonla ilgili degisikliklerden sonra once bu komut calismali:

```bash
npm run check:microphone
```

Bu kontrol, kritik davranislari statik olarak yakalar:

- Noktalama kapali mi?
- Append-only transcript helperlari yerinde mi?
- Not Defteri, Ortam Dinleme ve Yuz Yuze ayni duz metin akisini kullaniyor mu?
- Sohbet/Yuz Yuze 700 karakter siniri korunuyor mu?
- Android native stop ve final text flush davranisi duruyor mu?

## Windows Dogrulama Sirasi

```powershell
npm run check:microphone
npx eslint src/utils/speech.js src/components/AccessibilityHub.jsx src/components/IntercomInterface.jsx --max-warnings=0
npm run build
npx cap sync android
cd android
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'; $env:Path="$env:JAVA_HOME\bin;$env:Path"; .\gradlew.bat assembleDebug
```

APK yolu:

```text
C:\Users\aslih\Documents\GitHub\Eary\android\app\build\outputs\apk\debug\app-debug.apk
```

## Manuel Cihaz Testi

- Not Defteri: 30-60 saniye konus, 1-2 saniye sus, tekrar konus. Eski metin silinmemeli.
- Ortam Dinleme: Uzun konusmada sayfa/kart/pencere olusmamali; metin asagi dogru devam etmeli.
- Yuz Yuze: Uzun konusmada tekrar eden carryover azaltilmali; mesaj 700 karakteri gecmemeli.
- Sohbet: Sesli ve manuel mesajlar 700 karakter sinirina uymali.
- Login sonrasi: Firebase permission hatasi app acilis ekranini dusurmemeli.

## Yapilmamasi Gerekenler

- Canli metne otomatik noktalama veya AI duzeltme ekleme.
- Ortam Dinleme/Not Defteri icin "final result geldi, yeni blok ac" mantigi ekleme.
- Kullanici durdurmadan UI mikrofonunu kapali gostermek.
- Native recognizer lifecycle eventlerini dogrudan UI reset sebebi yapmak.
- Eski metni state temizligiyle sifirlamak.
