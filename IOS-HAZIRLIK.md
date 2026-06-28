# Eary iOS Hazirlik Notlari

Mac gelmeden hazir olanlar:

- Proje Capacitor yapisinda oldugu icin iOS'a tasinabilir.
- Android tarafindaki Firebase ve bildirim kurulumu temel olarak hazir.
- Windows'a bagli yerel push-notifications paket yolu kaldirildi; Mac'te npm uzerinden kurulacak hale getirildi.

Mac gelince yapilacak ilk siralama:

1. Xcode'u App Store'dan kur ve ilk acilista ek bileşenlerin yuklenmesini bekle.
2. Node.js LTS surumunu kur.
3. Proje klasorunu Mac'e kopyala. `node_modules` klasorunu kopyalamaya gerek yok.
4. Proje klasorunde bagimliliklari yeniden kur:

```bash
npm install
```

5. iOS platformunu ekle:

```bash
npm install @capacitor/ios@^8.4.0
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

6. Xcode icinde:

- Bundle ID: `com.asleyduo.app`
- Team: Apple hesabini sec
- Signing otomatik olsun
- Mikrofon, konusma tanima, kamera, fotograf ve bildirim izinleri kontrol edilsin

Not:

- iOS bildirimleri Android'deki `google-services.json` ile calismaz. iOS icin Firebase'e ayrica iOS uygulamasi eklemek ve APNs kurulumu yapmak gerekir.
- Cevresel ses algilama iOS'ta Android'den farkli ele alinacak; arka planda mikrofon kullanimi Apple tarafinda daha siki kurallara baglidir.
