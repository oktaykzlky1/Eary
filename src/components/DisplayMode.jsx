import { useState, useEffect, useRef } from 'react';
import { db, ref, onValue, set, remove } from '../firebase';
import { LogOut, ZoomIn, ZoomOut, Volume2, MessageSquare, ArrowLeft } from 'lucide-react';

const TRANSLATIONS = {
    'tr-TR': {
        title: 'Yansıtma Ekranı (Display)',
        room: 'Oda',
        waiting: 'Bağlantı bekleniyor... Birisi konuştuğunda yazı burada belirecektir.',
        exit: 'Yansıtmayı Kapat',
        fontSize: 'Yazı Boyutu',
        activeSpeaker: 'Konuşan',
        listening: 'Dinliyor...',
        switchToIntercom: 'İnterkom Modu',
    },
    'tr': {
        title: 'Yansıtma Ekranı (Display)',
        room: 'Oda',
        waiting: 'Bağlantı bekleniyor... Birisi konuştuğunda yazı burada belirecektir.',
        exit: 'Yansıtmayı Kapat',
        fontSize: 'Yazı Boyutu',
        activeSpeaker: 'Konuşan',
        listening: 'Dinliyor...',
        switchToIntercom: 'İnterkom Modu',
    },
    'de': {
        title: 'Präsentationsbildschirm',
        room: 'Raum',
        waiting: 'Warten auf Verbindung... Sobald jemand spricht, erscheint der Text hier.',
        exit: 'Präsentation Beenden',
        fontSize: 'Textgröße',
        activeSpeaker: 'Sprecher',
        listening: 'Hört zu...',
        switchToIntercom: 'Intercom-Modus',
    },
    'en': {
        title: 'Display Screen',
        room: 'Room',
        waiting: 'Waiting for connection... Text will appear here when someone speaks.',
        exit: 'Close Display',
        fontSize: 'Font Size',
        activeSpeaker: 'Speaker',
        listening: 'Listening...',
        switchToIntercom: 'Intercom Mode',
    }
};

export default function DisplayMode({ roomId, onLeave, onUpdateRole, language = 'tr-TR', nickname = 'Ekran' }) {
    const [messages, setMessages] = useState([]);
    const [roomUsers, setRoomUsers] = useState([]);

    // Register active user presence in Firebase
    useEffect(() => {
        const presenceName = nickname || 'Yansıtma Ekranı';
        const deviceId = localStorage.getItem('duotalk_device_id') || Math.random().toString(36).substring(2, 9);
        localStorage.setItem('duotalk_device_id', deviceId);
        const presenceKey = `${presenceName.replace(/[.$#[\]/]/g, '_')}_${deviceId}`;
        const presenceRef = ref(db, `rooms/${roomId}/presence/${presenceKey}`);
        
        set(presenceRef, {
            nickname: presenceName,
            role: 'display',
            active: true,
            lastActive: Date.now()
        }).catch(err => console.error("Error setting presence:", err));

        // Cleanup on unmount or tab close
        return () => {
            remove(presenceRef).catch(err => console.error("Error cleaning presence:", err));
        };
    }, [roomId, nickname]);

    // Listen to active users in room
    useEffect(() => {
        const presenceRef = ref(db, `rooms/${roomId}/presence`);
        const unsubscribe = onValue(presenceRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const list = Object.values(data)
                    .filter(u => u.nickname && u.nickname !== nickname)
                    .map(u => {
                        const roleLabel = u.role === 'station' 
                            ? (language.startsWith('de') ? 'Mikrofon' : language.startsWith('en') ? 'Mic' : 'Mikrofon')
                            : u.role === 'display'
                                ? (language.startsWith('de') ? 'Bildschirm' : language.startsWith('en') ? 'Display' : 'Ekran')
                                : (language.startsWith('de') ? 'Sohbet' : language.startsWith('en') ? 'Chat' : 'Sohbet');
                        return `${u.nickname} (${roleLabel})`;
                    });
                const uniqueList = Array.from(new Set(list));
                setRoomUsers(uniqueList);
            } else {
                setRoomUsers([]);
            }
        });
        return () => unsubscribe();
    }, [roomId, nickname, language]);

    const [fontSizeIndex, setFontSizeIndex] = useState(3); // Default to Extra Large
    const [flashAlert, setFlashAlert] = useState(false);
    const [activeSpeaker, setActiveSpeaker] = useState(null);
    const messagesEndRef = useRef(null);

    const langKey = language.startsWith('de') ? 'de' : language.startsWith('en') ? 'en' : 'tr';
    const text = TRANSLATIONS[langKey] || TRANSLATIONS['en'];

    // Font size presets
    const FONT_SIZES = [
        { label: 'S', class: 'text-2xl md:text-3xl' },
        { label: 'M', class: 'text-3xl md:text-4xl' },
        { label: 'L', class: 'text-4xl md:text-5xl' },
        { label: 'XL', class: 'text-5xl md:text-6xl font-semibold' },
        { label: 'XXL', class: 'text-6xl md:text-7xl font-bold' },
        { label: 'GIANT', class: 'text-7xl md:text-9xl font-extrabold tracking-wide' }
    ];

    // Fetch messages from Firebase in real-time
    useEffect(() => {
        const roomRef = ref(db, `rooms/${roomId}/messages`);
        
        const unsubscribe = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const messageList = Object.keys(data).map(key => ({
                    id: key,
                    ...data[key]
                }));
                
                // Sort by timestamp
                messageList.sort((a, b) => a.timestamp - b.timestamp);
                
                setMessages(messageList);
                
                // Alert visual flash if new message is received
                if (messageList.length > 0) {
                    const lastMsg = messageList[messageList.length - 1];
                    setActiveSpeaker(lastMsg.senderName);
                    
                    // Flash screen border to notify hearing impaired user
                    setFlashAlert(true);
                    const timer = setTimeout(() => setFlashAlert(false), 800);
                    
                    return () => clearTimeout(timer);
                }
            } else {
                setMessages([]);
                setActiveSpeaker(null);
            }
        });

        return () => unsubscribe();
    }, [roomId]);

    // Auto-scroll on new message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const increaseFontSize = () => {
        if (fontSizeIndex < FONT_SIZES.length - 1) {
            setFontSizeIndex(prev => prev + 1);
        }
    };

    const decreaseFontSize = () => {
        if (fontSizeIndex > 0) {
            setFontSizeIndex(prev => prev - 1);
        }
    };

    return (
        <div className={`fixed inset-0 flex flex-col bg-[#FAF8F5] text-[#2D1F47] transition-all duration-300 ${
            flashAlert ? 'border-[16px] border-[#7B52AB]' : 'border-[16px] border-transparent'
        }`}>
            {/* Top Bar */}
            <header className="flex items-center justify-between px-3 py-3 md:px-8 md:py-4 bg-white border-b border-[#DCD0EC]">
                <div className="flex items-center gap-2">
                    <button 
                        type="button"
                        onClick={onLeave}
                        className="p-1.5 bg-[#FAF8F5] hover:bg-[#EBE5F7] rounded-xl text-[#7B52AB] hover:text-[#663F93] transition-all active:scale-95 border border-[#DCD0EC] cursor-pointer shadow-sm"
                        title={language === 'tr-TR' ? 'Geri Dön' : 'Back'}
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 md:w-3.5 md:h-3.5 bg-[#7B52AB] rounded-full animate-pulse" />
                        <h1 className="text-xs md:text-lg font-bold tracking-wider text-[#2D1F47] whitespace-nowrap">
                            {text.title}
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 bg-[#FAF8F5] px-2 py-1.5 md:px-4 md:py-2 rounded-xl border border-[#DCD0EC] text-[10px] md:text-sm text-[#2D1F47]">
                    <div className="flex items-center gap-1">
                        <span className="text-[#8A7E9F] font-medium uppercase tracking-widest">{text.room}:</span>
                        <span className="font-bold text-[#7B52AB] tracking-wider">{roomId}</span>
                    </div>
                    {roomUsers.length > 0 && (
                        <div className="hidden md:flex items-center gap-2 border-l border-[#DCD0EC] pl-4">
                            <span className="text-xs text-[#8A7E9F] font-medium uppercase tracking-widest">
                                {language.startsWith('de') ? 'Im Raum' : language.startsWith('en') ? 'In Room' : 'Odadakiler'}:
                            </span>
                            <span className="text-xs font-bold text-[#4B3E63]">
                                {roomUsers.join(', ')}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1.5 md:gap-3">
                    {onUpdateRole && (
                        <>
                            {/* Switch to Intercom (Sohbet) */}
                            <button 
                                onClick={() => {
                                    if (confirm(language.startsWith('de') ? 'In Sohbet/Intercom Modus wechseln?' : language.startsWith('en') ? 'Switch to Intercom Mode?' : 'Normal Sohbet/İnterkom moduna geçmek istiyor musunuz?')) {
                                        onUpdateRole('intercom');
                                    }
                                }}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 md:px-4 md:py-2 bg-[#F4F0FC] hover:bg-[#EBE5F7] border border-[#DCD0EC]/60 rounded-xl text-[#7B52AB] font-medium text-xs md:text-sm transition-all duration-200 hover:shadow-lg active:scale-95 cursor-pointer"
                                title={text.switchToIntercom}
                            >
                                <MessageSquare size={14} />
                                <span className="hidden sm:inline">{text.switchToIntercom}</span>
                            </button>

                        </>
                    )}
                    
                    <button 
                        onClick={onLeave}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 md:px-4 md:py-2 bg-white hover:bg-rose-50 border border-rose-200 rounded-xl text-rose-600 font-medium text-xs md:text-sm transition-all duration-200 hover:shadow-lg active:scale-95 cursor-pointer"
                    >
                        <LogOut size={14} />
                        <span className="hidden sm:inline">{text.exit}</span>
                    </button>
                </div>
            </header>

            {/* Active Speaker Alert Box */}
            {activeSpeaker && (
                <div className="bg-white border-b border-[#DCD0EC]/65 px-8 py-3 flex items-center justify-between text-[#2D1F47]">
                    <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
                        <Volume2 size={16} className="text-[#7B52AB] animate-bounce" />
                        <span>{text.activeSpeaker}: <strong className="text-[#7B52AB] text-base">{activeSpeaker}</strong></span>
                    </div>
                    <div className="text-xs text-[#8A7E9F] animate-pulse flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#7B52AB]"></span>
                        {text.listening}
                    </div>
                </div>
            )}

            {/* Transcription Display Area */}
            <main className="flex-1 overflow-y-auto px-8 md:px-16 py-12 flex flex-col justify-end">
                {messages.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-center p-8">
                        <p className="text-xl md:text-3xl text-[#8A7E9F] font-light leading-relaxed max-w-3xl">
                            {text.waiting}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-8 md:space-y-12">
                        {messages.map((msg, index) => {
                            const isLastMessage = index === messages.length - 1;
                            return (
                                <div 
                                    key={msg.id} 
                                    className={`flex flex-col gap-2 transition-all duration-300 ${
                                        isLastMessage ? 'opacity-100 scale-100' : 'opacity-60'
                                    }`}
                                >
                                    {/* Speaker Badge */}
                                    <div className="flex items-center gap-2">
                                        <span className="px-3 py-1 bg-[#EBE5F7] text-xs md:text-sm font-semibold tracking-wider text-[#7B52AB] rounded-full border border-[#DCD0EC]">
                                            {msg.senderName}
                                        </span>
                                        <span className="text-[10px] md:text-xs text-[#8A7E9F]">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    {/* Text */}
                                    <p className={`${FONT_SIZES[fontSizeIndex].class} leading-relaxed text-[#2D1F47] select-text`}>
                                        {msg.text}
                                    </p>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </main>

            {/* Bottom Controls (Font Sizing) */}
            <footer className="px-8 py-4 bg-white border-t border-[#DCD0EC] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-[#8A7E9F] font-medium uppercase tracking-wider">{text.fontSize}:</span>
                    <span className="text-sm font-bold bg-[#FAF8F5] border border-[#DCD0EC] px-3 py-1 rounded-lg text-[#7B52AB]">
                        {FONT_SIZES[fontSizeIndex].label}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={decreaseFontSize}
                        disabled={fontSizeIndex === 0}
                        className="p-3 bg-[#FAF8F5] hover:bg-[#EBE5F7] disabled:opacity-40 disabled:hover:bg-[#FAF8F5] border border-[#DCD0EC] text-[#7B52AB] rounded-xl transition-all duration-200 cursor-pointer shadow-sm"
                        title="Yazıyı Küçült"
                    >
                        <ZoomOut size={20} />
                    </button>
                    <button 
                        onClick={increaseFontSize}
                        disabled={fontSizeIndex === FONT_SIZES.length - 1}
                        className="p-3 bg-[#FAF8F5] hover:bg-[#EBE5F7] disabled:opacity-40 disabled:hover:bg-[#FAF8F5] border border-[#DCD0EC] text-[#7B52AB] rounded-xl transition-all duration-200 cursor-pointer shadow-sm"
                        title="Yazıyı Büyüt"
                    >
                        <ZoomIn size={20} />
                    </button>
                </div>
            </footer>
        </div>
    );
}
