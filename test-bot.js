import { initializeApp } from "firebase/app";
import { getDatabase, ref, push, set, onChildAdded } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCbao9F8V3xNObfBpyx-_K94SwISoKuGt0",
  authDomain: "eary-e0f00.firebaseapp.com",
  databaseURL: "https://eary-e0f00-default-rtdb.firebaseio.com",
  projectId: "eary-e0f00",
  storageBucket: "eary-e0f00.firebasestorage.app",
  messagingSenderId: "599913888122",
  appId: "1:599913888122:web:bb883f52089d315de3bec3",
  measurementId: "G-6ZD0H6HDPW"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Get room ID and bot name from command-line arguments or use defaults
const roomId = process.argv[2] || "test-odasi";
const botName = process.argv[3] || "Sanal Es (Ahmet)";

console.log(`==================================================`);
console.log(`🤖 Eary Sanal Test Botu Başlatıldı`);
console.log(`📍 Hedef Oda (Room ID): ${roomId}`);
console.log(`👤 Bot Takma Adı: ${botName}`);
console.log(`==================================================`);

const BOT_PHRASES = [
  "Merhaba! Sesimi duyabiliyor musun?",
  "Şu an Eary uygulamasının testindeyim.",
  "Harika! Bildirimlerin telefonuna ulaşıyor mu?",
  "Eğer uygulamayı arka plana atarsan veya ekranı kilitlersen bildirim gelmesi lazım.",
  "Saat simgesine dokunup 'Saat Bildirimi (Her Zaman)' seçeneğini açtın mı?",
  "Ben evin diğer odasındayım gibi düşünelim, çocuğun yanındayım.",
  "Çocuk şu an uyuyor, her şey yolunda.",
  "Birazdan yanına geleceğim.",
  "Akıllı saatinde bildirimlerin titreyip titremediğini kontrol et lütfen.",
  "Bu sistem gerçekten işitme engelliler için çok pratik olmuş.",
  "Sana bir mesaj daha gönderiyorum, test etmen için.",
  "Ben şimdi mutfağa geçiyorum, bir şeye ihtiyacın var mı?"
];

let phraseIndex = 0;
let autoInterval = null;

const sendMessage = (text) => {
  const msgRef = ref(db, `rooms/${roomId}/messages`);
  const newMsgRef = push(msgRef);
  set(newMsgRef, {
    senderName: botName,
    text: text,
    timestamp: Date.now()
  }).then(() => {
    console.log(`[Bot] Gönderildi: "${text}"`);
  }).catch(err => {
    console.error("Mesaj gönderim hatası:", err);
  });
};

// Listen for messages in the room
const messagesRef = ref(db, `rooms/${roomId}/messages`);

console.log(`"${roomId}" odasındaki yeni mesajlar dinleniyor...`);
console.log(`Ipucu: Bot ile sohbet edebilirsin veya şu komutları gönderebilirsin:`);
console.log(`  /test -> Rastgele bir deneme mesajı tetikler`);
console.log(`  /auto -> Her 10 saniyede bir otomatik mesaj gönderir (Bildirim testi için harika)`);
console.log(`  /stop -> Otomatik mesaj gönderimini durdurur`);
console.log(`--------------------------------------------------`);

// Track startup time to prevent replying to historical messages
const startupTime = Date.now();

onChildAdded(messagesRef, (snapshot) => {
  const msg = snapshot.val();
  if (!msg) return;

  // Ignore if the message was sent by the bot itself, or if it is from the past
  if (msg.senderName === botName) return;
  if (msg.timestamp < startupTime - 3000) return;

  console.log(`[Gelen Mesaj] ${msg.senderName}: "${msg.text}"`);

  const cleanText = msg.text.trim().toLowerCase();

  // Simulate thinking / typing delay (2 seconds)
  setTimeout(() => {
    if (cleanText === "/ping") {
      sendMessage("Pong! 🏓");
    } else if (cleanText === "/help" || cleanText === "yardım") {
      sendMessage("Kullanabileceğin komutlar: /ping, /test (rastgele mesaj), /auto (otomatik bildirim testi başlatır), /stop (otomatik testi durdurur)");
    } else if (cleanText === "/auto") {
      if (autoInterval) {
        sendMessage("Otomatik mesaj gönderimi zaten aktif!");
      } else {
        sendMessage("Otomatik test başlatıldı! Her 10 saniyede bir mesaj göndereceğim. Telefonunu arka plana al veya ekranı kilitleyip akıllı saatindeki bildirimleri/titreşimleri dene!");
        autoInterval = setInterval(() => {
          const phrase = BOT_PHRASES[phraseIndex % BOT_PHRASES.length];
          phraseIndex++;
          sendMessage(phrase);
        }, 10000);
      }
    } else if (cleanText === "/stop") {
      if (autoInterval) {
        clearInterval(autoInterval);
        autoInterval = null;
        sendMessage("Otomatik mesaj gönderimi durduruldu.");
      } else {
        sendMessage("Aktif bir otomatik gönderim bulunmuyor.");
      }
    } else if (cleanText === "/test") {
      const phrase = BOT_PHRASES[Math.floor(Math.random() * BOT_PHRASES.length)];
      sendMessage(phrase);
    } else {
      // General conversation simulation
      const reply = BOT_PHRASES[phraseIndex % BOT_PHRASES.length];
      phraseIndex++;
      sendMessage(reply);
    }
  }, 2000);
});
