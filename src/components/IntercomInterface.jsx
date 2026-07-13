import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { db, auth, ref, set, push, get, getRest, updateRest, remove, onValue, onDisconnect, update, query, limitToLast } from '../firebase';
import { getDuoSpeechRecognizer, rememberNativeSpeechTranscript } from '../utils/speech';
import { correctTranscription, extractPersonalTerms, rememberPersonalTerms } from '../utils/autocorrect';
import { requestNotificationPermission, scheduleNotification } from '../utils/notifications';
import { getDeviceId, registerRoomPushNotifications } from '../utils/pushNotifications';
import { phoneLookupKey } from '../utils/identity';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Mic, Trash2, X, AlertTriangle, Watch, ArrowLeft, Menu, Send, Smile, ChevronDown, Reply, Forward, Pencil, Copy, Share2, Volume2, Save, Eraser, PanelsTopLeft, Square, Languages } from 'lucide-react';

const playBeep = (type) => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'start') {
            osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.15);
        } else if (type === 'stop') {
            osc.frequency.setValueAtTime(660, audioCtx.currentTime); // E5
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.08);

            setTimeout(() => {
                try {
                    const osc2 = audioCtx.createOscillator();
                    const gain2 = audioCtx.createGain();
                    osc2.connect(gain2);
                    gain2.connect(audioCtx.destination);
                    osc2.frequency.setValueAtTime(554, audioCtx.currentTime); // C#5
                    gain2.gain.setValueAtTime(0.08, audioCtx.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
                    osc2.start(audioCtx.currentTime);
                    osc2.stop(audioCtx.currentTime + 0.1);
                } catch (error) {
                    console.warn("Failed to play stop beep tail:", error);
                }
            }, 100);
        }
    } catch (e) {
        console.error("Failed to play PTT beep:", e);
    }
};
import Sidebar from './Sidebar';
import ConversationInfo from './ConversationInfo';
import { normalizeAppLanguage } from '../utils/language';
const VoiceSettings = registerPlugin('VoiceSettings');
const FACE_TO_FACE_PHRASES = ['Tekrar eder misiniz?', 'Biraz yavaş konuşur musunuz?', 'Lütfen yüzüme bakarak konuşun', 'Bunu yazabilir misiniz?'];
const TEST_BOT_NAME = 'Eary Test Bot';
const MAX_CHAT_MESSAGE_CHARS = 700;
const MAX_VOICE_MESSAGE_CHARS = MAX_CHAT_MESSAGE_CHARS;
const limitChatMessageText = text => String(text || '').trim().slice(0, MAX_CHAT_MESSAGE_CHARS).trim();

const getTestBotReply = text => {
    const normalized = text.toLocaleLowerCase('tr-TR');
    if (normalized.includes('merhaba') || normalized.includes('selam')) {
        return 'Merhaba! Ben Eary test botuyum. Bana bir mesaj yaz, balonları ve akışı birlikte test edelim.';
    }
    if (normalized.includes('çeviri') || normalized.includes('ceviri')) {
        return 'Çeviri testi için örnek: "Randevum saat kaçta?" Bu mesaj balon ve metin akışını kontrol etmek için oluşturuldu.';
    }
    if (normalized.includes('mikrofon') || normalized.includes('konuş')) {
        return 'Mikrofon testi için bas-konuş düğmesini deneyebilirsin. Simulator mikrofonu gerçek cihaz kadar güvenilir olmayabilir.';
    }
    if (normalized.includes('yardım') || normalized.includes('help')) {
        return 'Test komutları: merhaba, çeviri, mikrofon. Normal mesajlara da kısa bir cevap veririm.';
    }
    return `Mesajını aldım: "${text}". Bu sohbet yerel test botudur; Firebase veya gerçek kullanıcı gerektirmez.`;
};

const shouldShowSpeechModal = errorText => {
    const errorStr = String(errorText || '').toLowerCase();
    if (!errorStr) return false;
    if (errorStr.includes('izin reddedildi') || errorStr.includes('permission denied') || errorStr.includes('not authorized')) return true;
    return Capacitor.getPlatform() !== 'ios';
};

const TRANSLATIONS = {
    'tr-TR': {
        title: 'Eary İnterkom',
        connected: 'Bağlandı',
        testNotify: '🔔 Test Bildirimi',
        cast: '📺 Ekrana Yansıt',
        exit: 'Ayrıl',
        startSpeak: 'Konuşmak için tıklayın',
        stopSpeak: 'Dinlemeyi Durdur',
        listening: 'Sizi dinliyor...',
        interimPreview: 'Konuşma önizleme:',
        deleteSelected: 'Seçilenleri Sil',
        cancel: 'Vazgeç',
        selectMode: 'Toplu Sil',
        noMessages: 'Henüz konuşma kaydı yok. Konuşmak için aşağıdaki butona basın.',
        testAlertTitle: 'Eary Test',
        testAlertBody: 'Bildirim sistemi başarıyla çalışıyor! 🎉',
        newMessage: 'Yeni Mesaj - ',
        inputPlaceholder: 'Konuşamadığınızda el ile yazın...',
        castTabWireless: 'Kablosuz TV',
        castTabQRCode: 'QR Kod Tarat',
        castTabPinCode: 'KOD ile Eşleştir',
        castNativeSearch: 'Kablosuz TV Ara / Yansıt (Chromecast)',
        castNativeUnsupported: 'Bu tarayıcı veya cihaz doğrudan kablosuz yansıtmayı (Presentation API) desteklemiyor. Lütfen yukarıdan "QR Kod" veya "KOD ile Eşleştir" sekmelerini kullanın.',
        castQRText: 'Yansıtmak istediğiniz tabletten, telefondan veya kamerası olan bir TV\'den bu QR kodu taratarak odaya anında bağlanabilirsiniz.',
        alwaysNotifyToggle: 'Saat Bildirimi (Her Zaman)',
        alwaysNotifyOn: 'Saat bildirimleri aktif (Her yeni mesajda saat titrer)',
        alwaysNotifyOff: 'Saat bildirimleri pasif (Sadece arka planda)',
        switchToDisplay: 'Yansıtma Moduna Geç',
        yes: 'Evet',
        no: 'Hayır',
        requestDisplay: '📺 Karşı Tarafı Ekran Yap',
        displayPromptTitle: 'Ekran Modu İstendi',
        displayPromptBody: (sender) => `${sender} sizin okuma ekranı (yansıtma) moduna geçmenizi istiyor. Bu telefonu sadece okuma amaçlı Ekran Yansıtma moduna geçirmek istiyor musunuz?`
    }
};

export default function IntercomInterface({ roomData, onLeave, language = 'tr-TR', onLanguageChange, theme, onToggleTheme, onlineVisibility = 'everyone', setOnlineVisibility }) {
    const { roomId, nickname } = roomData;
    const isTestBotRoom = Boolean(roomData.isTestBot);
    const [messages, setMessages] = useState([]);
    const [messagesReady, setMessagesReady] = useState(false);
    const messagesRef = useRef([]);
    const faceStateRef = useRef({ splitScreenEnabled: false, faceSessionActive: false, faceSessionStartedAt: 0 });
    const [roomMembers, setRoomMembers] = useState([]);
    const [isListening, setIsListening] = useState(false);
    const [, setIsSpeechStarting] = useState(false);
    const isListeningRef = useRef(false);
    const [interimText, setInterimText] = useState('');
    const [manualText, setManualText] = useState('');
    const [editingMessage, setEditingMessage] = useState(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [forwardingMessage, setForwardingMessage] = useState(null);
    const [toast, setToast] = useState('');
    const [messageLimit, setMessageLimit] = useState(60);
    const [deletingMessage, setDeletingMessage] = useState(null);
    const [hiddenMessageIds, setHiddenMessageIds] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`eary_hidden_${roomData.roomId}`) || '[]'); } catch { return []; }
    });
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [isChatViewportReady, setIsChatViewportReady] = useState(false);
    const [hasPinnedInitialChat, setHasPinnedInitialChat] = useState(false);
    const scrollHintTimerRef = useRef(null);
    const scrollDragRef = useRef({ active: false, moved: false, y: 0, scrollTop: 0 });
    const manualInputRef = useRef(null);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [sidebarSection] = useState('profile');
    const [account, setAccount] = useState(null);
    const [history, setHistory] = useState([]);
    const [alwaysNotify, setAlwaysNotify] = useState(() => localStorage.getItem('eary_always_notify') !== 'false');


    const activeStreamRef = useRef(null);
    const [replyToMsg, setReplyToMsg] = useState(null); // { id, text, senderName }
    const [chatFontSize, setChatFontSize] = useState(() => Number(localStorage.getItem('eary_chat_font_size')) || 16);
    const visualizerCanvasRef = useRef(null);

    useEffect(() => {
        localStorage.setItem('eary_chat_font_size', String(chatFontSize));
    }, [chatFontSize]);

    useEffect(() => {
        let audioCtx = null;
        let analyser = null;
        let source = null;
        let animationFrameId = null;

        const startVisualizer = async () => {
            if (!isListening) return;

            if (Capacitor.isNativePlatform()) {
                // On native platforms, simulate a sound wave animation using requestAnimationFrame
                // to prevent audio hardware conflicts (getUserMedia blocks native speech recognition on Android).
                const canvas = visualizerCanvasRef.current;
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                const drawSimulation = () => {
                    if (!visualizerCanvasRef.current) return;
                    animationFrameId = requestAnimationFrame(drawSimulation);
                    const width = canvas.width;
                    const height = canvas.height;
                    ctx.clearRect(0, 0, width, height);

                    const bufferLength = 16;
                    const barWidth = (width / bufferLength) * 1.5;
                    let x = 0;
                    for (let i = 0; i < bufferLength; i++) {
                        const barHeight = (Math.random() * 0.4 + 0.2) * height * (Math.sin(Date.now() / 200 + i) * 0.5 + 0.5);
                        ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + Math.random() * 0.4})`;
                        const y = (height - barHeight) / 2;
                        ctx.fillRect(x, y, barWidth - 2, barHeight);
                        x += barWidth;
                    }
                };
                drawSimulation();
                return;
            }

            let stream = activeStreamRef.current;
            if (!stream) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    activeStreamRef.current = stream;
                } catch (e) {
                    console.warn("Failed to get audio stream for visualizer:", e);
                    return;
                }
            }

            if (!stream) return;

            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AudioContextClass();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 64;

                source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);

                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);

                const canvas = visualizerCanvasRef.current;
                if (!canvas) return;
                const ctx = canvas.getContext('2d');

                const draw = () => {
                    if (!visualizerCanvasRef.current) return;
                    animationFrameId = requestAnimationFrame(draw);
                    analyser.getByteFrequencyData(dataArray);

                    const width = canvas.width;
                    const height = canvas.height;
                    ctx.clearRect(0, 0, width, height);

                    const barWidth = (width / bufferLength) * 1.5;
                    let barHeight;
                    let x = 0;

                    for (let i = 0; i < bufferLength; i++) {
                        barHeight = (dataArray[i] / 255) * height * 0.8;
                        ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + (dataArray[i] / 255) * 0.6})`;
                        const y = (height - barHeight) / 2;
                        ctx.fillRect(x, y, barWidth - 2, barHeight);
                        x += barWidth;
                    }
                };

                draw();
            } catch (err) {
                console.error("Visualizer Error:", err);
            }
        };

        if (isListening) {
            startVisualizer();
        }

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            if (source) {
                source.disconnect();
            }
            if (audioCtx) {
                audioCtx.close();
            }
        };
    }, [isListening]);

    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [typingStatus, setTypingStatus] = useState(null);
    const [typingUsers, setTypingUsers] = useState({});
    // Dynamic languages and Translation states
    const [speechLang, setSpeechLangState] = useState(() => normalizeAppLanguage(localStorage.getItem('eary_speech_lang') || language));
    const [translationTargetLang, setTranslationTargetLangState] = useState(() => normalizeAppLanguage(localStorage.getItem('eary_translation_target_lang') || 'tr-TR'));
    const [topSpeechLang, setTopSpeechLangState] = useState(() => normalizeAppLanguage(localStorage.getItem('eary_top_speech_lang') || 'tr-TR'));
    const [autoTranslate, setAutoTranslate] = useState(() => localStorage.getItem('eary_auto_translate') === 'true');
    const [showChatTranslationSettings, setShowChatTranslationSettings] = useState(false);
    const [splitScreenEnabled, setSplitScreenEnabled] = useState(false);
    const [faceSessionActive, setFaceSessionActive] = useState(false);
    const [faceSessionStartedAt, setFaceSessionStartedAt] = useState(0);
    const [faceSaveAfterSession, setFaceSaveAfterSession] = useState(false);
    const [showFaceEnd, setShowFaceEnd] = useState(false);
    const [faceSpeaker, setFaceSpeaker] = useState('guest');
    const faceSpeakerRef = useRef('guest');
    const [translations, setTranslations] = useState({});
    const [showOriginalTranslations, setShowOriginalTranslations] = useState({});
    const [topTranslations, setTopTranslations] = useState({});
    const [, setActiveRecognitionLang] = useState(() => localStorage.getItem('eary_speech_lang') || 'tr-TR');

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    useEffect(() => {
        faceStateRef.current = { splitScreenEnabled, faceSessionActive, faceSessionStartedAt };
    }, [splitScreenEnabled, faceSessionActive, faceSessionStartedAt]);
    const [activeReactionMenuId, setActiveReactionMenuId] = useState(null);
    const [activeMessageMenuId, setActiveMessageMenuId] = useState(null);
    const [messageMenuPosition, setMessageMenuPosition] = useState({ top: 0, left: 0, placement: 'right' });
    const [isParticipantsModalOpen, setIsParticipantsModalOpen] = useState(false);
    const [chatTheme, setChatThemeState] = useState(() => localStorage.getItem(`eary_chat_theme_${roomId}`) || 'green');
    const [roomMetadata, setRoomMetadata] = useState({});

    const isReadyForSmoothScroll = useRef(false);
    const translatedIdsRef = useRef(new Set());
    const topTranslatedIdsRef = useRef(new Set());

    useEffect(() => onValue(ref(db, `rooms/${roomId}/metadata`), snapshot => {
        setRoomMetadata(snapshot.val() || {});
    }), [roomId]);

    const setChatTheme = value => {
        setChatThemeState(value);
        localStorage.setItem(`eary_chat_theme_${roomId}`, value);
    };

    const isDirectConversation = roomMetadata.kind === 'direct' || roomData.kind === 'direct' || roomId.startsWith('dm-');
    const currentUsername = account?.username ||
        roomData.username ||
        Object.entries(roomMetadata.memberNames || {}).find(([, memberName]) => memberName === nickname)?.[0] ||
        '';
    const currentDeviceId = getDeviceId();
    const conversationParticipants = [...new Set([
        nickname,
        ...roomMembers.map(member => member.nickname),
        ...messages.map(message => message.senderName)
    ].filter(name => name && (!isDirectConversation || name !== 'Karşı taraf')))];
    const isGroupConversation = !isDirectConversation && (roomMetadata.kind === 'group' || conversationParticipants.length > 2);
    const otherParticipant = conversationParticipants.find(name => name !== nickname);
    const configuredPeerName = Object.values(roomMetadata.memberNames || {}).find(name => name !== nickname);
    const conversationTitle = (!isDirectConversation && roomMetadata.name) || (isGroupConversation
        ? conversationParticipants.join(', ')
        : (roomData.title || configuredPeerName || otherParticipant || roomData.peerUsername || 'Sohbet'));
    const peerUsername = roomData.peerUsername || (isDirectConversation && currentUsername && roomId.startsWith('dm-')
        ? roomId.slice(3).split('-').find(value => value !== currentUsername)
        : '');
    const roomUsernames = roomId.startsWith('dm-') ? roomId.slice(3).split('-') : [];
    const inferredPeerUsername = peerUsername || roomUsernames.find(username => username !== currentUsername) || '';
    const peerDisplayName = roomData.title || configuredPeerName || otherParticipant || peerUsername;
    const otherParticipantOnline = roomMembers.some(member => {
        const isMe = (currentUsername && member.username === currentUsername) || member.deviceId === currentDeviceId;
        if (isMe) return false;
        return isDirectConversation
            ? ((inferredPeerUsername && member.username === inferredPeerUsername) || member.nickname === peerDisplayName || member.nickname === conversationTitle)
            : member.nickname === otherParticipant;
    });
    const conversationStatus = isTestBotRoom ? 'Test modu' : isGroupConversation
        ? (roomMembers.length ? `${roomMembers.length} kişi çevrimiçi` : 'Kimse çevrimiçi değil')
        : (otherParticipantOnline ? 'Çevrimiçi' : 'Çevrimdışı');

    const clearChatForMe = () => {
        const ids = messages.map(message => message.id);
        setHiddenMessageIds(ids);
        localStorage.setItem(`eary_hidden_messages_${roomId}`, JSON.stringify(ids));
        setIsParticipantsModalOpen(false);
    };

    const themeColors = {
        green: { brand: '#176b5b', strong: '#115347', soft: '#dceee9', outgoing: '#d9eee5' },
        blue: { brand: '#316fa8', strong: '#24567f', soft: '#deebf5', outgoing: '#dceaf4' },
        purple: { brand: '#7651a8', strong: '#5d3d89', soft: '#e9e1f3', outgoing: '#e8dff2' },
        rose: { brand: '#a94f68', strong: '#853b50', soft: '#f3e1e6', outgoing: '#f1dfe4' }
    }[chatTheme];

    useEffect(() => {
        const handleBack = event => {
            if (showFaceEnd) {
                event.preventDefault();
                setShowFaceEnd(false);
            } else if (splitScreenEnabled && faceSessionActive) {
                event.preventDefault();
                setShowFaceEnd(true);
            } else if (splitScreenEnabled) {
                event.preventDefault();
                exitFaceSetup();
            } else if (isParticipantsModalOpen) {
                event.preventDefault();
                setIsParticipantsModalOpen(false);
            } else if (isSidebarOpen) {
                event.preventDefault();
                setIsSidebarOpen(false);
            }
        };
        window.addEventListener('eary:back', handleBack);
        return () => window.removeEventListener('eary:back', handleBack);
    }, [faceSessionActive, isParticipantsModalOpen, isSidebarOpen, showFaceEnd, splitScreenEnabled]);

    // Scroll stabilization lock on room mount
    useEffect(() => {
        isReadyForSmoothScroll.current = false;
        const timer = setTimeout(() => {
            isReadyForSmoothScroll.current = true;
        }, 1500);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const savedAccount = localStorage.getItem('duotalk_account');
        if (savedAccount) {
            try {
                setAccount(JSON.parse(savedAccount));
            } catch (e) {
                console.error(e);
            }
        }
        const savedHistory = localStorage.getItem('duotalk_history');
        if (savedHistory) {
            try {
                setHistory(JSON.parse(savedHistory));
            } catch (e) {
                console.error(e);
            }
        }
    }, []);

    // Sync settings to localStorage
    useEffect(() => {
        localStorage.setItem('eary_speech_lang', speechLang);
    }, [speechLang]);

    const setSpeechLang = nextLanguage => {
        const normalized = normalizeAppLanguage(nextLanguage);
        setSpeechLangState(normalized);
        localStorage.setItem('eary_speech_lang', normalized);
        onLanguageChange?.(normalized);
    };

    const setTranslationTargetLang = nextLanguage => {
        setTranslationTargetLangState(normalizeAppLanguage(nextLanguage));
    };

    const setTopSpeechLang = nextLanguage => {
        setTopSpeechLangState(normalizeAppLanguage(nextLanguage));
    };

    useEffect(() => {
        localStorage.setItem('eary_translation_target_lang', translationTargetLang);
    }, [translationTargetLang]);

    useEffect(() => {
        localStorage.setItem('eary_top_speech_lang', topSpeechLang);
    }, [topSpeechLang]);

    useEffect(() => {
        localStorage.setItem('eary_auto_translate', String(autoTranslate));
    }, [autoTranslate]);

    useEffect(() => {
        localStorage.setItem('eary_always_notify', String(alwaysNotify));
    }, [alwaysNotify]);

    const handleToggleAlwaysNotify = () => {
        setAlwaysNotify(prev => !prev);
    };



    const handleToggleAutoTranslate = () => {
        setAutoTranslate(prev => !prev);
    };

    const openChatTranslationSettings = () => {
        setShowChatTranslationSettings(value => !value);
    };

    const handleToggleSplitScreen = () => {
        if (splitScreenEnabled && faceSessionActive) setShowFaceEnd(true);
        else {
            setFaceSessionActive(false);
            setSplitScreenEnabled(prev => !prev);
        }
    };

    const exitFaceSetup = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        setShowFaceEnd(false);
        setFaceSessionActive(false);
        setSplitScreenEnabled(false);
        localStorage.setItem('eary_split_screen', 'false');
    };

    const startFaceSession = saveAfter => {
        setTopSpeechLang('tr-TR');
        setSpeechLang('tr-TR');
        setTranslationTargetLang('tr-TR');
        localStorage.setItem('eary_top_speech_lang', 'tr-TR');
        localStorage.setItem('eary_speech_lang', 'tr-TR');
        localStorage.setItem('eary_translation_target_lang', 'tr-TR');
        setFaceSaveAfterSession(saveAfter);
        setFaceSessionStartedAt(Date.now());
        faceSpeakerRef.current = 'guest';
        setFaceSpeaker('guest');
        setFaceSessionActive(true);
    };

    const finishFaceSession = async saveSession => {
        if (isListening) {
            try { recognitionRef.current?.abort(); } catch (error) { console.warn('Speech recognition could not be stopped:', error); }
            setIsListening(false);
            stopActiveStream();
        }
        const sessionMessages = messages.filter(message => Number(message.timestamp || 0) >= faceSessionStartedAt);
        if (saveSession && sessionMessages.length) {
            const sessions = JSON.parse(localStorage.getItem('eary_face_sessions') || '[]');
            localStorage.setItem('eary_face_sessions', JSON.stringify([{ id: Date.now(), roomId, startedAt: faceSessionStartedAt, endedAt: Date.now(), messages: sessionMessages }, ...sessions].slice(0, 20)));
        } else if (!saveSession && sessionMessages.length) {
            await Promise.all(sessionMessages.map(message => remove(ref(db, `rooms/${roomId}/messages/${message.id}`))));
        }
        setShowFaceEnd(false);
        setFaceSessionActive(false);
        setSplitScreenEnabled(false);
    };

    const selectFaceSpeaker = side => {
        faceSpeakerRef.current = side;
        setFaceSpeaker(side);
    };

    const toggleFaceSpeakerListening = async (side, lang) => {
        if (isListeningRef.current && faceSpeakerRef.current !== side) {
            suppressNextSpeechEndRef.current = true;
            try {
                await recognitionRef.current?.stop?.();
            } catch (error) {
                console.warn('Speech recognition could not switch speaker:', error);
            }
            isListeningRef.current = false;
            setIsListening(false);
            stopActiveStream();
            resetSpeechCapture();
            recognitionRef.current = null;
        }
        selectFaceSpeaker(side);
        speechOwnerRef.current = side;
        await toggleListening(lang);
    };

    const handleFaceMicPress = (event, side, lang) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const now = Date.now();
        const lastPress = faceMicPressLockRef.current;
        if (lastPress.side === side && now - lastPress.timestamp < 1500) return;
        faceMicPressLockRef.current = { side, timestamp: now };
        toggleFaceSpeakerListening(side, lang);
    };

    const speakText = textToSpeak => {
        if (!textToSpeak?.trim() || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak.trim());
        utterance.lang = speechLang;
        window.speechSynthesis.speak(utterance);
    };

    const sendQuickPhrase = async phrase => {
        await sendMessageToCloud(phrase, false, speechLang);
        speakText(phrase);
    };

    // Clear translations cache when languages change
    useEffect(() => {
        setTranslations({});
        setShowOriginalTranslations({});
        translatedIdsRef.current = new Set();
    }, [translationTargetLang]);

    useEffect(() => {
        setTopTranslations({});
        topTranslatedIdsRef.current = new Set();
    }, [topSpeechLang]);

    // Google Translation API Helper
    const translateText = async (text, targetLang, sourceLang = 'auto') => {
        try {
            const tl = targetLang.split('-')[0];
            const sl = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0];
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("Translation request failed");
            const data = await res.json();
            if (data && data[0] && data[0][0] && data[0][0][0]) {
                return data[0].map(item => item[0]).join('');
            }
        } catch (e) {
            console.error("Translation helper error:", e);
        }
        return null;
    };

    // Automatic translation hook for host
    useEffect(() => {
        if (!autoTranslate) return;

        messages.forEach(async (msg) => {
            if (msg.senderName === nickname) return;
            if (translatedIdsRef.current.has(msg.id)) return;

            translatedIdsRef.current.add(msg.id);
            const translated = await translateText(msg.text, translationTargetLang, 'auto');
            if (translated && translated.trim().toLowerCase() !== msg.text.trim().toLowerCase()) {
                setTranslations(prev => ({
                    ...prev,
                    [msg.id]: translated
                }));
            }
        });
    }, [messages, autoTranslate, translationTargetLang, nickname]);

    // Automatic translation hook for guest (top panel)
    useEffect(() => {
        if (!autoTranslate || !splitScreenEnabled) return;

        messages.forEach(async (msg) => {
            if (topTranslatedIdsRef.current.has(msg.id)) return;

            topTranslatedIdsRef.current.add(msg.id);
            const translated = await translateText(msg.text, topSpeechLang, msg.senderLang || 'auto');
            if (translated && translated.trim().toLowerCase() !== msg.text.trim().toLowerCase()) {
                setTopTranslations(prev => ({
                    ...prev,
                    [msg.id]: translated
                }));
            }
        });
    }, [messages, autoTranslate, topSpeechLang, splitScreenEnabled]);

    // Scroll to bottom for both split feeds
    useEffect(() => {
        if (splitScreenEnabled && messages.length > 0) {
            const scrollSplit = () => {
                if (topChatContainerRef.current) {
                    topChatContainerRef.current.scrollTop = topChatContainerRef.current.scrollHeight;
                }
                if (bottomChatContainerRef.current) {
                    bottomChatContainerRef.current.scrollTop = bottomChatContainerRef.current.scrollHeight;
                }
            };

            if (!isReadyForSmoothScroll.current) {
                scrollSplit();
            } else {
                messagesEndTopRef.current?.scrollIntoView({ behavior: 'smooth' });
                messagesEndBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
            const frame = requestAnimationFrame(scrollSplit);
            const settleTimer = setTimeout(scrollSplit, 180);

            return () => {
                cancelAnimationFrame(frame);
                clearTimeout(settleTimer);
            };
        }
        return undefined;
    }, [messages, splitScreenEnabled]);

    // Toggle Message Reaction in Firebase
    const toggleReaction = async (msgId, emoji) => {
        try {
            const userKey = nickname.replace(/[.$#[\]/]/g, '_');
            const currentMessage = messages.find(message => message.id === msgId);
            const shouldRemove = currentMessage?.reactions?.[userKey] === emoji;

            if (shouldRemove) {
                setMessages(current => current.map(message => {
                    if (message.id !== msgId) return message;
                    const nextReactions = { ...(message.reactions || {}) };
                    delete nextReactions[userKey];
                    return { ...message, reactions: nextReactions };
                }));
                await updateRest({ [`rooms/${roomId}/messages/${msgId}/reactions/${userKey}`]: null });
            } else {
                setMessages(current => current.map(message => (
                    message.id === msgId
                        ? { ...message, reactions: { ...(message.reactions || {}), [userKey]: emoji } }
                        : message
                )));
                await updateRest({ [`rooms/${roomId}/messages/${msgId}/reactions/${userKey}`]: emoji });
            }
            setActiveReactionMenuId(null);
        } catch (e) {
            console.error("Error toggling reaction:", e);
        }
    };

    // Render group of reactions under a message bubble
    const renderMessageReactions = (msg) => {
        if (!msg.reactions) return null;

        const reactionCounts = {};
        Object.entries(msg.reactions).forEach(([, emoji]) => {
            reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
        });

        return (
            <div className="flex flex-wrap gap-1 mt-1 z-10">
                {Object.entries(reactionCounts).map(([emoji, count]) => {
                    const hasMyReaction = Object.entries(msg.reactions).some(
                        ([user, e]) => user === nickname.replace(/[.$#[\]/]/g, '_') && e === emoji
                    );

                    return (
                        <button
                            key={emoji}
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleReaction(msg.id, emoji);
                            }}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer select-none ${
                                hasMyReaction
                                    ? 'bg-indigo-650/40 border-indigo-500/50 text-indigo-200 shadow-sm'
                                    : 'bg-slate-800/80 border-slate-700/50 text-slate-350 hover:bg-slate-700/60'
                            }`}
                        >
                            <span>{emoji}</span>
                            {count > 1 && <span className="text-[9px] opacity-90">{count}</span>}
                        </button>
                    );
                })}
            </div>
        );
    };

    // Monitor online/offline status
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Monitor typing and speaking status
    useEffect(() => {
        if (isListening) {
            setTypingStatus('speaking');
        } else if (manualText.trim().length > 0) {
            setTypingStatus('typing');
        } else {
            setTypingStatus(null);
        }
    }, [isListening, manualText]);

    // Sync typing status to Firebase
    useEffect(() => {
        if (!roomId || !nickname) return;
        const typingRef = ref(db, `rooms/${roomId}/typing/${nickname.replace(/[.$#[\]/]/g, '_')}`);

        if (typingStatus) {
            set(typingRef, typingStatus).catch(e => console.error(e));
        } else {
            remove(typingRef).catch(e => console.error(e));
        }

        return () => {
            remove(typingRef).catch(e => console.error(e));
        };
    }, [roomId, nickname, typingStatus]);

    // Listen to other users' typing status
    useEffect(() => {
        if (!roomId) return;
        const typingRootRef = ref(db, `rooms/${roomId}/typing`);
        const unsubscribe = onValue(typingRootRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const others = {};
                Object.keys(data).forEach(userKey => {
                    if (userKey !== nickname.replace(/[.$#[\]/]/g, '_')) {
                        others[userKey] = data[userKey];
                    }
                });
                setTypingUsers(others);
            } else {
                setTypingUsers({});
            }
        });
        return () => unsubscribe();
    }, [roomId, nickname]);

    const getTypingText = () => {
        const users = Object.keys(typingUsers);
        if (users.length === 0) return null;

        const formattedUsers = users.map(user => {
            const status = typingUsers[user];
            const cleanName = user.split('_')[0] || user;
            if (status === 'speaking') {
                return `${cleanName} konuşuyor... 🎤`;
            } else {
                return `${cleanName} yazıyor...`;
            }
        });

        return formattedUsers.join(', ');
    };
    const typingText = getTypingText();

    const stopActiveStream = () => {
        if (activeStreamRef.current) {
            activeStreamRef.current.getTracks().forEach(track => track.stop());
            activeStreamRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            stopActiveStream();
        };
    }, []);

    const handleUpdateAccount = async (updatedAcc) => {
        setAccount(updatedAcc);
        localStorage.setItem('duotalk_account', JSON.stringify(updatedAcc));

        if (updatedAcc && updatedAcc.username) {
            try {
                const profileRef = ref(db, `users/${updatedAcc.username}/profile`);
                await update(profileRef, {
                    nickname: updatedAcc.nickname,
                    bio: updatedAcc.profile.bio,
                    preference: updatedAcc.profile.preference,
                    languages: updatedAcc.profile.languages,
                    interests: updatedAcc.profile.interests,
                    privacy: updatedAcc.profile.privacy || {}
                });
                await update(ref(db, `publicProfiles/${updatedAcc.username}`), {
                    username: updatedAcc.username,
                    nickname: updatedAcc.nickname,
                    bio: updatedAcc.profile.bio || '',
                    discoverable: updatedAcc.profile.privacy?.discoverByUsername !== 'nobody'
                });
                const phone = auth.currentUser?.phoneNumber;
                if (phone) {
                    const key = await phoneLookupKey(phone);
                    if (updatedAcc.profile.privacy?.discoverByPhone === 'contacts') await set(ref(db, `phoneDirectory/${key}`), { username: updatedAcc.username });
                    else await remove(ref(db, `phoneDirectory/${key}`));
                }
            } catch (err) {
                console.error("Firebase Profile Update Error:", err);
            }
        }
    };
    const handleDeleteAccount = async () => {
        if (!account?.username) throw new Error('Oturum bulunamadı.');
        const usernameClean = account.username.trim().toLowerCase();
        await update(ref(db), {
            [`users/${usernameClean}/profile`]: null,
            [`publicProfiles/${usernameClean}`]: null
        });
        await handleLogout();
    };

    const handleExplicitLeave = async () => {
        onLeave();
    };

    const handleLogout = async () => {
        setAccount(null);
        localStorage.removeItem('duotalk_account');
        setHistory([]);
        localStorage.removeItem('duotalk_history');
        onLeave();
    };



    // Presence and Signaling states
    const [showWatchModal, setShowWatchModal] = useState(false);

    // Register only fresh, foreground presence and remove it on connection loss.
    useEffect(() => {
        const presenceName = nickname || 'Guest';
        const deviceId = getDeviceId();
        const presenceUsername = account?.username || roomData.username || '';
        const presenceBaseKey = presenceUsername || presenceName;
        const presenceKey = `${presenceBaseKey.replace(/[.$#[\]/]/g, '_')}_${deviceId}`;
        const presenceRef = ref(db, `rooms/${roomId}/presence/${presenceKey}`);

        const presencePayload = () => ({
            nickname: presenceName, role: 'intercom', active: true,
            username: presenceUsername,
            deviceId,
            lastActive: Date.now()
        });

        const markOnline = () => {
            if (onlineVisibility === 'nobody') {
                remove(presenceRef).catch(console.error);
                return;
            }
            set(presenceRef, presencePayload()).catch(err => console.error("Error setting presence:", err));
            onDisconnect(presenceRef).remove().catch(err => console.error("Presence disconnect setup failed:", err));
        };
        const handleVisibility = () => markOnline();

        markOnline();
        document.addEventListener('visibilitychange', handleVisibility);
        const heartbeat = setInterval(markOnline, 20000);

        // Cleanup on unmount or tab close
        return () => {
            clearInterval(heartbeat);
            document.removeEventListener('visibilitychange', handleVisibility);
            remove(presenceRef).catch(err => console.error("Error cleaning presence:", err));
        };
    }, [roomId, nickname, roomData.username, account, onlineVisibility]);

    // Listen to active users in room
    useEffect(() => {
        const presenceRef = ref(db, `rooms/${roomId}/presence`);
        let currentPresence = {};
        const applyFreshMembers = (value = currentPresence) => {
            const freshThreshold = Date.now() - 90000;
            currentPresence = value || {};
            const data = currentPresence;
            if (data) {
                // Map all members in presence
                const members = Object.values(data)
                    .filter(u => u.active && Number(u.lastActive || 0) >= freshThreshold)
                    .map(u => ({
                        nickname: u.nickname,
                        role: u.role,
                        username: u.username || '',
                        deviceId: u.deviceId || ''
                    }));

                // Remove duplicates by username/device first; nickname alone is not stable enough.
                const uniqueMembers = [];
                const seenMembers = new Set();
                members.forEach(m => {
                    const key = m.username || m.deviceId || m.nickname;
                    if (!seenMembers.has(key)) {
                        seenMembers.add(key);
                        uniqueMembers.push(m);
                    }
                });

                setRoomMembers(uniqueMembers);
            } else {
                setRoomMembers([]);
            }
        };
        const unsubscribe = onValue(presenceRef, (snapshot) => {
            applyFreshMembers(snapshot.val() || {});
        });
        const refreshPresence = async () => {
            try {
                const restPresence = await getRest(`rooms/${roomId}/presence`, { timeoutMs: 5000 });
                applyFreshMembers(restPresence || {});
            } catch (presenceError) {
                console.error('Presence refresh failed:', presenceError);
                applyFreshMembers();
            }
        };
        refreshPresence();
        const staleTimer = setInterval(refreshPresence, 5000);
        return () => { unsubscribe(); clearInterval(staleTimer); };
    }, [roomId, nickname]);
    // Remote prompt listeners removed for UI simplification



    // Bulk Selection State
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);

    // App state tracking (Foreground / Background)
    const isAppBackground = useRef(false);

    useEffect(() => {
        const handleVisibility = () => {
            isAppBackground.current = (document.visibilityState === 'hidden');
        };
        document.addEventListener('visibilitychange', handleVisibility);
        isAppBackground.current = (document.visibilityState === 'hidden');

        let appStateListener = null;
        try {
            appStateListener = App.addListener('appStateChange', ({ isActive }) => {
                isAppBackground.current = !isActive;
                console.log("App state changed: isAppBackground =", isAppBackground.current);
            });
        } catch (e) {
            console.warn("App state listener not supported on this platform:", e);
        }

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            if (appStateListener) {
                appStateListener.then(l => l.remove()).catch(e => console.error(e));
            }
        };
    }, []);

    // Speech Recognition references
    const recognitionRef = useRef(null);
    const messagesEndRef = useRef(null);
    const messagesEndTopRef = useRef(null);
    const messagesEndBottomRef = useRef(null);
    const chatContainerRef = useRef(null);
    const topChatContainerRef = useRef(null);
    const bottomChatContainerRef = useRef(null);
    const hasInitiated = useRef(false);
    const longPressTimeout = useRef(null);
    const pressOriginRef = useRef(null);
    const suppressNextClickRef = useRef(false);
    const shouldAutoScrollRef = useRef(true);
    const faceMicPressLockRef = useRef({ side: '', timestamp: 0 });
    const programmaticScrollTimerRef = useRef(null);

    const cancelLongPress = () => {
        if (longPressTimeout.current) {
            clearTimeout(longPressTimeout.current);
            longPressTimeout.current = null;
        }
        pressOriginRef.current = null;
    };

    const handlePressStart = (event, msg) => {
        if (isSelectMode) return;
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        pressOriginRef.current = {
            x: event.clientX,
            y: event.clientY,
            msgId: msg.id
        };
        longPressTimeout.current = setTimeout(() => {
            suppressNextClickRef.current = true;
            setActiveReactionMenuId(null);
            setActiveMessageMenuId(msg.id);
            const bubble = event.currentTarget?.querySelector('[data-message-bubble]');
            const rect = (bubble || event.currentTarget)?.getBoundingClientRect();
            if (rect) {
                const menuWidth = 176;
                const menuHeight = msg.senderName === nickname && msg.text ? 236 : 196;
                const gap = 8;
                const viewportPad = 10;
                const chatRect = chatContainerRef.current?.getBoundingClientRect();
                const minTop = Math.max(viewportPad, (chatRect?.top || 0) + gap);
                const maxTop = Math.min(window.innerHeight - menuHeight - viewportPad, (chatRect?.bottom || window.innerHeight) - menuHeight - gap);
                const hasRightSpace = window.innerWidth - rect.right >= menuWidth + gap + viewportPad;
                const hasLeftSpace = rect.left >= menuWidth + gap + viewportPad;
                const opensUp = (chatRect?.bottom || window.innerHeight) - rect.bottom < menuHeight + 16;
                const preferredLeft = hasRightSpace || !hasLeftSpace
                    ? rect.right + gap
                    : rect.left - menuWidth - gap;
                const preferredTop = opensUp ? rect.bottom - menuHeight : rect.top;

                setMessageMenuPosition({
                    top: Math.max(minTop, Math.min(preferredTop, Math.max(minTop, maxTop))),
                    left: Math.max(viewportPad, Math.min(preferredLeft, window.innerWidth - menuWidth - viewportPad)),
                    placement: opensUp ? 'up' : (hasRightSpace || !hasLeftSpace ? 'right' : 'left')
                });
            }
            shouldAutoScrollRef.current = false;
            if ('vibrate' in navigator) {
                navigator.vibrate(50);
            }
            cancelLongPress();
        }, 550);
    };

    const handlePressMove = (event) => {
        if (!pressOriginRef.current) return;
        const movedX = Math.abs(event.clientX - pressOriginRef.current.x);
        const movedY = Math.abs(event.clientY - pressOriginRef.current.y);
        if (movedX > 10 || movedY > 10) {
            cancelLongPress();
        }
    };

    const handleMessageClick = (event, msgId) => {
        event.stopPropagation();
        if (scrollDragRef.current.moved) {
            scrollDragRef.current.moved = false;
            return;
        }
        if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
        }
        if (isSelectMode) {
            toggleSelectMessage(msgId);
            return;
        }
        setActiveMessageMenuId(null);
        setActiveReactionMenuId(prev => prev === msgId ? null : msgId);
    };

    useEffect(() => {
        if (!activeMessageMenuId) return undefined;
        const closeMenu = (event) => {
            if (!event.target.closest('[data-message-actions]')) {
                setActiveMessageMenuId(null);
            }
        };
        document.addEventListener('pointerdown', closeMenu);
        return () => document.removeEventListener('pointerdown', closeMenu);
    }, [activeMessageMenuId]);

    const langKey = 'tr-TR';
    const text = TRANSLATIONS[langKey];
    const [speechError, setSpeechError] = useState(null);

    // 1. Initial Permission Request Setup
    useEffect(() => {
        // Ask for permissions
        requestNotificationPermission();
    }, []);

    useEffect(() => {
        let unregister = () => {};

        registerRoomPushNotifications({ roomId, nickname })
            .then(cleanup => { unregister = cleanup; })
            .catch(error => console.error('Push notification setup failed:', error));

        return () => unregister();
    }, [roomId, nickname]);

    // Sync active speaker status to Firebase
    useEffect(() => {
        const speakerRef = ref(db, `rooms/${roomId}/speakers/${nickname}`);
        if (isListening) {
            set(speakerRef, true).catch(e => console.error(e));
        } else {
            remove(speakerRef).catch(e => console.error(e));
        }

        return () => {
            remove(speakerRef).catch(e => console.error(e));
        };
    }, [isListening, roomId, nickname]);

    // Keep track of messages length to prevent resubscription loop
    const messagesLengthRef = useRef(0);
    const pendingLocalMessagesRef = useRef({});
    const lastOutboundMessageRef = useRef({ roomId: '', text: '', isVoice: false, lang: '', timestamp: 0 });
    const manualSubmitLockRef = useRef(false);
    useEffect(() => {
        messagesLengthRef.current = messages.length;
    }, [messages]);

    // 2. Real-time Message Stream & Background Notification Dispatch
    useEffect(() => {
        let active = true;
        setMessagesReady(false);

        if (isTestBotRoom) {
            const savedMessages = JSON.parse(localStorage.getItem(`eary_test_bot_messages_${roomId}`) || '[]');
            const initialMessages = savedMessages.length ? savedMessages : [{
                id: `bot-${Date.now()}`,
                senderName: TEST_BOT_NAME,
                senderUsername: 'eary-test-bot',
                senderDeviceId: 'local-test-bot',
                text: 'Merhaba, ben Eary Test Bot. Burada mesaj gönderme, balonlar, cevaplar ve kaydırmayı güvenle test edebilirsin.',
                timestamp: Date.now(),
                isVoice: false,
                status: 'read',
                senderLang: speechLang
            }];
            setMessages(initialMessages);
            setMessagesReady(true);
            localStorage.setItem(`eary_test_bot_messages_${roomId}`, JSON.stringify(initialMessages));
            hasInitiated.current = true;
            return () => { active = false; };
        }

        const applyMessageData = data => {
            if (!active) return;
            if (data) {
                const messageList = Object.keys(data).map(key => ({
                    id: key,
                    ...data[key]
                }));

                // Sort by timestamp
                messageList.sort((a, b) => a.timestamp - b.timestamp);
                const cloudIds = new Set(messageList.map(message => message.id));
                Object.keys(pendingLocalMessagesRef.current).forEach(messageId => {
                    if (cloudIds.has(messageId)) {
                        delete pendingLocalMessagesRef.current[messageId];
                    }
                });
                messageList.push(...Object.values(pendingLocalMessagesRef.current));
                messageList.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

                // Check for new messages to trigger local notifications
                if (hasInitiated.current && messageList.length > messagesLengthRef.current) {
                    const newMsg = messageList[messageList.length - 1];
                    // Notify for incoming messages when the app is backgrounded, or when the user explicitly wants all alerts.
                    if (newMsg.senderName !== nickname && (isAppBackground.current || alwaysNotify)) {
                        scheduleNotification(
                            `${text.newMessage}${newMsg.senderName}`,
                            newMsg.text || 'Yeni mesaj',
                            Math.floor(Math.random() * 100000),
                            { roomId }
                        );
                    }

                    // Simple accessibility vibration for incoming message (if device supports it)
                    if ('vibrate' in navigator && newMsg.senderName !== nickname) {
                        navigator.vibrate([150, 100, 150]);
                    }
                }

                // Update delivery/read status for messages sent by others.
                messageList.forEach(m => {
                    const sentByThisDevice = Boolean(m.senderDeviceId && m.senderDeviceId === currentDeviceId);
                    const sentByThisUser = Boolean(currentUsername && m.senderUsername && m.senderUsername === currentUsername);
                    const readReceiptsEnabled = account?.profile?.privacy?.readReceipts !== false;
                    const nextStatus = document.visibilityState === 'visible' && readReceiptsEnabled ? 'read' : 'delivered';
                    if (!sentByThisDevice && !sentByThisUser && m.status !== 'read' && m.status !== nextStatus) {
                        updateRest({ [`rooms/${roomId}/messages/${m.id}/status`]: nextStatus })
                            .catch(err => console.error("Error updating read status:", err));
                    }
                });

                setMessages(messageList);
                setMessagesReady(true);
                hasInitiated.current = true;
            } else {
                setMessages([]);
                setMessagesReady(true);
                hasInitiated.current = true;
            }
        };

        const roomMessagesRef = query(ref(db, `rooms/${roomId}/messages`), limitToLast(messageLimit));
        const unsubscribe = onValue(roomMessagesRef, snapshot => applyMessageData(snapshot.val()));
        const refreshMessages = async () => {
            try {
                const data = await getRest(`rooms/${roomId}/messages`);
                if (!data) {
                    applyMessageData(null);
                    return;
                }
                const recentEntries = Object.entries(data)
                    .sort(([, first], [, second]) => Number(first.timestamp || 0) - Number(second.timestamp || 0))
                    .slice(-messageLimit);
                applyMessageData(Object.fromEntries(recentEntries));
            } catch (messageError) {
                console.error('Message refresh failed:', messageError);
                if (active) setMessagesReady(true);
            }
        };
        refreshMessages();
        const refreshInterval = setInterval(refreshMessages, 1500);

        return () => {
            active = false;
            unsubscribe();
            clearInterval(refreshInterval);
        };
    }, [isTestBotRoom, roomId, nickname, text.newMessage, messageLimit, speechLang, currentDeviceId, currentUsername, alwaysNotify, account?.profile?.privacy?.readReceipts]);

    const setProgrammaticScroll = useCallback(() => {
        if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = setTimeout(() => {
            programmaticScrollTimerRef.current = null;
        }, 260);
    }, []);

    const pinChatToBottom = useCallback(() => {
        const container = chatContainerRef.current;
        if (!container) return;
        setProgrammaticScroll();
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    }, [setProgrammaticScroll]);

    useEffect(() => {
        shouldAutoScrollRef.current = true;
        setIsChatViewportReady(false);
        setHasPinnedInitialChat(false);
        setShowScrollToBottom(false);
        pinChatToBottom();
        const frame = requestAnimationFrame(() => {
            pinChatToBottom();
        });
        return () => cancelAnimationFrame(frame);
    }, [pinChatToBottom, roomId]);

    useLayoutEffect(() => {
        if (!messagesReady) return;
        if (splitScreenEnabled || isSelectMode || hasPinnedInitialChat) return;
        if (!messages.length) {
            setIsChatViewportReady(true);
            setHasPinnedInitialChat(true);
            return;
        }
        pinChatToBottom();
        setIsChatViewportReady(true);
        setHasPinnedInitialChat(true);
    }, [hasPinnedInitialChat, isSelectMode, messages.length, messagesReady, pinChatToBottom, splitScreenEnabled]);

    // Scroll to bottom on new message
    useEffect(() => {
        if (!isSelectMode && hasPinnedInitialChat && shouldAutoScrollRef.current && messages.length > 0) {
            pinChatToBottom();
            const frame = requestAnimationFrame(pinChatToBottom);
            const settleTimer = setTimeout(pinChatToBottom, 180);
            const lateTimer = setTimeout(pinChatToBottom, 520);
            return () => {
                cancelAnimationFrame(frame);
                clearTimeout(settleTimer);
                clearTimeout(lateTimer);
            };
        }
        return undefined;
    }, [messages, isSelectMode, hasPinnedInitialChat, pinChatToBottom]);

    // Translations increase bubble height after messages arrive. Keep the last
    // message anchored before paint so opening a translated chat never jumps.
    useLayoutEffect(() => {
        if (!messagesReady) return;
        if (splitScreenEnabled || isSelectMode || !hasPinnedInitialChat || !shouldAutoScrollRef.current || !messages.length) {
            if (!messages.length) setIsChatViewportReady(true);
            return;
        }
        pinChatToBottom();
        setIsChatViewportReady(true);
        const frame = requestAnimationFrame(() => {
            pinChatToBottom();
            setIsChatViewportReady(true);
        });
        const settleTimer = setTimeout(() => {
            pinChatToBottom();
            setIsChatViewportReady(true);
        }, 220);
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(settleTimer);
        };
    }, [roomId, messages.length, messagesReady, translations, autoTranslate, splitScreenEnabled, isSelectMode, hasPinnedInitialChat, pinChatToBottom]);

    useLayoutEffect(() => {
        if (!messagesReady || splitScreenEnabled || isSelectMode || !isListening || !interimText || !shouldAutoScrollRef.current) return;
        pinChatToBottom();
    }, [interimText, isListening, isSelectMode, messagesReady, pinChatToBottom, splitScreenEnabled]);

    const handleChatScroll = () => {
        if (programmaticScrollTimerRef.current) return;
        const container = chatContainerRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        const isNearBottom = distanceFromBottom < 120;
        shouldAutoScrollRef.current = isNearBottom;
        if (isNearBottom) {
            if (scrollHintTimerRef.current) {
                clearTimeout(scrollHintTimerRef.current);
                scrollHintTimerRef.current = null;
            }
            setShowScrollToBottom(false);
        } else if (!scrollHintTimerRef.current) {
            scrollHintTimerRef.current = setTimeout(() => {
                setShowScrollToBottom(true);
                scrollHintTimerRef.current = null;
            }, 1200);
        }
        if (!isNearBottom) {
            cancelLongPress();
        }
    };

    const scrollToBottom = () => {
        shouldAutoScrollRef.current = true;
        setShowScrollToBottom(false);
        if (scrollHintTimerRef.current) {
            clearTimeout(scrollHintTimerRef.current);
            scrollHintTimerRef.current = null;
        }
        const container = chatContainerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight - container.clientHeight, behavior: 'smooth' });
    };

    const handleChatPointerDown = (event) => {
        if (event.pointerType !== 'mouse') return;
        if (event.target.closest('button,input,textarea,select,a,[data-message-actions]')) return;
        const container = chatContainerRef.current;
        if (!container) return;
        scrollDragRef.current = {
            active: true,
            moved: false,
            y: event.clientY,
            scrollTop: container.scrollTop
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const handleChatPointerMove = (event) => {
        const drag = scrollDragRef.current;
        if (!drag.active || event.pointerType !== 'mouse') return;
        const container = chatContainerRef.current;
        if (!container) return;
        const deltaY = event.clientY - drag.y;
        if (Math.abs(deltaY) > 3) {
            drag.moved = true;
            container.scrollTop = drag.scrollTop - deltaY;
            handleChatScroll();
            event.preventDefault();
        }
    };

    const stopChatPointerDrag = () => {
        scrollDragRef.current.active = false;
    };

    useEffect(() => () => {
        if (scrollHintTimerRef.current) {
            clearTimeout(scrollHintTimerRef.current);
        }
        if (programmaticScrollTimerRef.current) {
            clearTimeout(programmaticScrollTimerRef.current);
        }
    }, []);

    // Ref to hold the last captured text from speech recognition (used for native finalize)
    const lastCapturedTextRef = useRef('');
    const finalizedSpeechRef = useRef('');
    const interimTextRef = useRef('');
    const speechCommittedTextRef = useRef('');
    const speechLiveTextRef = useRef('');
    const speechSessionTextRef = useRef('');
    const speechStopSentRef = useRef(false);
    const speechSessionRef = useRef(0);
    const speechOwnerRef = useRef('host');
    const suppressNextSpeechEndRef = useRef(false);
    const ignoreSpeechResultsRef = useRef(false);
    const speechStartInFlightRef = useRef(false);
    const speechClosingRef = useRef(false);
    const recentVoiceMessagesRef = useRef([]);
    const lastSentSpeechSnapshotRef = useRef({ text: '', owner: '', timestamp: 0 });
    const speechSessionBaselinesRef = useRef([]);

    const setSpeechPreview = (value) => {
        const clean = String(value || '').replace(/\s+/g, ' ').trim();
        const limited = clean.length > MAX_VOICE_MESSAGE_CHARS ? clean.slice(0, MAX_VOICE_MESSAGE_CHARS).trim() : clean;
        interimTextRef.current = limited;
        setInterimText(limited);
        if (limited) lastCapturedTextRef.current = limited;
    };

    const clearSpeechPreview = () => {
        interimTextRef.current = '';
        setInterimText('');
    };

    const joinSpeechTape = (committed, live) => {
        const base = String(committed || '').trim();
        const tail = String(live || '').trim();
        if (!base) return tail;
        if (!tail) return base;
        return mergeSpeechTranscriptChunk(base, tail);
    };

    const mergeSpeechTranscriptChunk = (previousText, nextText) => {
        const previous = String(previousText || '').trim();
        const next = String(nextText || '').trim();
        if (!previous) return next;
        if (!next) return previous;
        const previousKey = normalizeSpeechWords(previous).join(' ');
        const nextKey = normalizeSpeechWords(next).join(' ');
        if (!previousKey) return next;
        if (!nextKey) return previous;
        if (nextKey === previousKey || previousKey.endsWith(` ${nextKey}`) || previousKey.includes(` ${nextKey} `)) return previous;
        if (nextKey.startsWith(`${previousKey} `)) return next;

        const previousWords = previous.split(/\s+/);
        const nextWords = next.split(/\s+/);
        const maxOverlap = Math.min(previousWords.length, nextWords.length);
        for (let size = maxOverlap; size >= 1; size -= 1) {
            const previousTail = previousWords.slice(-size).join(' ').toLocaleLowerCase('tr-TR');
            const nextHead = nextWords.slice(0, size).join(' ').toLocaleLowerCase('tr-TR');
            if (previousTail === nextHead) {
                return [...previousWords, ...nextWords.slice(size)].join(' ').trim();
            }
        }
        return `${previous} ${next}`.trim();
    };

    const reconcileSpeechDraft = (previousDraft, nextDraft) => {
        const previous = String(previousDraft || '').trim();
        const next = String(nextDraft || '').trim();
        if (!previous) return next;
        if (!next) return previous;
        const previousKey = normalizeSpeechWords(previous).join(' ');
        const nextKey = normalizeSpeechWords(next).join(' ');
        if (!previousKey) return next;
        if (!nextKey) return previous;
        if (nextKey === previousKey) return previous;
        if (nextKey.startsWith(`${previousKey} `)) return next;
        if (previousKey.startsWith(`${nextKey} `) || previousKey.endsWith(` ${nextKey}`) || previousKey.includes(` ${nextKey} `)) return previous;
        return mergeSpeechTranscriptChunk(previous, next);
    };

    const syncSpeechDraftFromTape = () => {
        const tapeDraft = joinSpeechTape(speechCommittedTextRef.current, speechLiveTextRef.current);
        const stableDraft = reconcileSpeechDraft(speechSessionTextRef.current, tapeDraft)
            .slice(0, MAX_VOICE_MESSAGE_CHARS)
            .trim();
        speechSessionTextRef.current = stableDraft;
        finalizedSpeechRef.current = speechCommittedTextRef.current || stableDraft;
        setSpeechPreview(stableDraft);
        return stableDraft;
    };

    const looksLikeFullSpeechDraft = (candidate, committed) => {
        const next = String(candidate || '').trim();
        const base = String(committed || '').trim();
        if (!next || !base) return false;
        const nextLower = next.toLocaleLowerCase('tr-TR');
        const baseLower = base.toLocaleLowerCase('tr-TR');
        if (nextLower.startsWith(baseLower)) return true;
        const nextWords = normalizeSpeechWords(next);
        const baseWords = normalizeSpeechWords(base);
        if (nextWords.length <= baseWords.length) return false;
        const overlap = countWordOverlap(baseWords, nextWords.slice(0, Math.max(baseWords.length + 4, 4)));
        return baseWords.length >= 3 && overlap / baseWords.length >= 0.75;
    };

    const mergeSpeechLiveRevision = (previousLive, incomingText) => {
        const previous = String(previousLive || '').trim();
        const incoming = String(incomingText || '').trim();
        if (!previous) return incoming;
        if (!incoming) return previous;
        const previousLower = previous.toLocaleLowerCase('tr-TR');
        const incomingLower = incoming.toLocaleLowerCase('tr-TR');
        if (incomingLower.startsWith(previousLower)) return incoming;
        if (previousLower.startsWith(incomingLower) || previousLower.endsWith(incomingLower)) return previous;
        return mergeSpeechTranscriptChunk(previous, incoming);
    };

    const commitSpeechLiveSegment = incomingText => {
        const incoming = String(incomingText || '').trim();
        if (!incoming && !speechLiveTextRef.current.trim()) return syncSpeechDraftFromTape();

        if (looksLikeFullSpeechDraft(incoming, speechCommittedTextRef.current)) {
            speechCommittedTextRef.current = incoming.slice(0, MAX_VOICE_MESSAGE_CHARS).trim();
            speechLiveTextRef.current = '';
            return syncSpeechDraftFromTape();
        }

        const segment = mergeSpeechLiveRevision(speechLiveTextRef.current, incoming);
        speechCommittedTextRef.current = mergeSpeechTranscriptChunk(speechCommittedTextRef.current, segment)
            .slice(0, MAX_VOICE_MESSAGE_CHARS)
            .trim();
        speechLiveTextRef.current = '';
        return syncSpeechDraftFromTape();
    };

    const updateSpeechLiveSegment = incomingText => {
        const incoming = String(incomingText || '').trim();
        if (!incoming) return syncSpeechDraftFromTape();

        if (looksLikeFullSpeechDraft(incoming, speechCommittedTextRef.current)) {
            speechCommittedTextRef.current = incoming.slice(0, MAX_VOICE_MESSAGE_CHARS).trim();
            speechLiveTextRef.current = '';
            return syncSpeechDraftFromTape();
        }

        speechLiveTextRef.current = mergeSpeechLiveRevision(speechLiveTextRef.current, incoming)
            .slice(0, MAX_VOICE_MESSAGE_CHARS)
            .trim();
        return syncSpeechDraftFromTape();
    };

    const handleSpeechDraftWordClick = event => {
        const index = Number(event.currentTarget.dataset.wordIndex || -1);
        const currentText = String(interimText || '').trim();
        if (!currentText) return;
        const words = currentText.split(/\s+/);
        if (index < 0 || index >= words.length) return;
        const currentWord = words[index] || '';
        const nextWord = window.prompt('Kelimeyi düzeltin', currentWord);
        if (nextWord === null) return;
        const cleanWord = nextWord.replace(/\s+/g, ' ').trim();
        if (!cleanWord) words.splice(index, 1);
        else words[index] = cleanWord;
        const nextText = words.join(' ').trim().slice(0, MAX_VOICE_MESSAGE_CHARS).trim();
        speechCommittedTextRef.current = nextText;
        speechLiveTextRef.current = '';
        speechSessionTextRef.current = nextText;
        finalizedSpeechRef.current = nextText;
        lastCapturedTextRef.current = nextText;
        setSpeechPreview(nextText);
    };

    const resetSpeechCapture = () => {
        lastCapturedTextRef.current = '';
        finalizedSpeechRef.current = '';
        speechCommittedTextRef.current = '';
        speechLiveTextRef.current = '';
        speechSessionTextRef.current = '';
        clearSpeechPreview();
    };

    const resetSpeechSessionBuffers = () => {
        lastCapturedTextRef.current = '';
        finalizedSpeechRef.current = '';
        interimTextRef.current = '';
        speechCommittedTextRef.current = '';
        speechLiveTextRef.current = '';
        speechSessionTextRef.current = '';
        speechStopSentRef.current = false;
        ignoreSpeechResultsRef.current = false;
        clearSpeechPreview();
    };

    const runAfterUiPaint = callback => {
        requestAnimationFrame(() => {
            setTimeout(callback, 30);
        });
    };

    const closeSpeechCaptureAfterSend = async () => {
        ignoreSpeechResultsRef.current = true;
        speechClosingRef.current = true;
        speechStartInFlightRef.current = true;
        isListeningRef.current = false;
        setIsSpeechStarting(false);
        setIsListening(false);
        stopActiveStream();
        clearSpeechPreview();

        const recognizer = recognitionRef.current;
        if (recognitionRef.current === recognizer) {
            recognitionRef.current = null;
        }

        runAfterUiPaint(() => {
            try {
                if (recognizer && typeof recognizer.abort === 'function') {
                    recognizer.abort();
                } else if (recognizer && typeof recognizer.stop === 'function') {
                    recognizer.stop();
                }
            } catch (error) {
                console.warn('Speech recognition could not be closed after send:', error);
            }
        });
        resetSpeechCapture();
        speechClosingRef.current = false;
        speechStartInFlightRef.current = false;
    };

    const normalizeSpeechWords = value => String(value || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[^A-Za-z0-9\u00C0-\u024F\u0100-\u017F\s]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const countWordOverlap = (firstWords, secondWords) => {
        const counts = new Map();
        secondWords.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
        return firstWords.reduce((total, word) => {
            const count = counts.get(word) || 0;
            if (!count) return total;
            counts.set(word, count - 1);
            return total + 1;
        }, 0);
    };

    const findLikelyCachedPrefixLength = (currentWords, previousWords) => {
        if (currentWords.length < 3 || previousWords.length < 3) return 0;
        const maxStartOffset = Math.min(3, currentWords.length - 3);
        let bestLength = 0;
        let bestScore = 0;

        for (let startOffset = 0; startOffset <= maxStartOffset; startOffset += 1) {
            const maxPrefixLength = Math.min(currentWords.length - startOffset - 1, previousWords.length + 4);
            for (let length = 3; length <= maxPrefixLength; length += 1) {
                const prefixWords = currentWords.slice(startOffset, startOffset + length);
                const overlap = countWordOverlap(prefixWords, previousWords);
                const score = overlap / Math.min(length, previousWords.length);
                const enoughWords = overlap >= Math.min(4, previousWords.length);
                if (enoughWords && score >= 0.58 && score >= bestScore) {
                    bestScore = score;
                    bestLength = startOffset + length;
                }
            }
        }

        return bestLength;
    };

    const findLikelyCachedSegment = (currentWords, previousWords) => {
        if (currentWords.length < 5 || previousWords.length < 3) return null;
        let bestMatch = null;
        let bestScore = 0;

        for (let startOffset = 0; startOffset <= currentWords.length - 3; startOffset += 1) {
            const maxLength = Math.min(currentWords.length - startOffset, previousWords.length + 4);
            for (let length = 3; length <= maxLength; length += 1) {
                const segmentWords = currentWords.slice(startOffset, startOffset + length);
                const overlap = countWordOverlap(segmentWords, previousWords);
                const score = overlap / Math.min(length, previousWords.length);
                const enoughWords = overlap >= Math.min(4, previousWords.length);
                const leavesNewText = currentWords.length - length >= 2;
                if (enoughWords && leavesNewText && score >= 0.72 && score > bestScore) {
                    bestScore = score;
                    bestMatch = { start: startOffset, end: startOffset + length };
                }
            }
        }

        return bestMatch;
    };

    const stripKnownSpeechPrefix = (value, baselines = []) => {
        const text = String(value || '').trim();
        if (!text) return '';

        const currentWords = text.split(/\s+/).filter(Boolean);
        const currentNormalized = normalizeSpeechWords(text);
        if (currentNormalized.length < 2) return text;

        for (const baseline of baselines) {
            const previousNormalized = normalizeSpeechWords(baseline?.text);
            if (previousNormalized.length < 2) continue;

            let exactPrefixLength = 0;
            const comparableLength = Math.min(currentNormalized.length, previousNormalized.length);
            for (let index = 0; index < comparableLength; index += 1) {
                if (currentNormalized[index] !== previousNormalized[index]) break;
                exactPrefixLength += 1;
            }

            const exactCoverage = exactPrefixLength / previousNormalized.length;
            if (exactPrefixLength >= Math.min(3, previousNormalized.length) && exactCoverage >= 0.72 && currentWords.length > exactPrefixLength) {
                return currentWords.slice(exactPrefixLength).join(' ').trim();
            }

            const fuzzyPrefixLength = findLikelyCachedPrefixLength(currentNormalized, previousNormalized);
            if (fuzzyPrefixLength && currentWords.length > fuzzyPrefixLength) {
                return currentWords.slice(fuzzyPrefixLength).join(' ').trim();
            }
        }

        return text;
    };

    const stripSentSpeechSnapshot = (value, owner) => {
        const snapshot = lastSentSpeechSnapshotRef.current || {};
        const snapshotText = String(snapshot.text || '').trim();
        const snapshotIsFresh = Date.now() - Number(snapshot.timestamp || 0) < 2 * 60 * 1000;
        const baselines = [
            ...speechSessionBaselinesRef.current,
            ...(snapshotText && snapshot.owner === owner && snapshotIsFresh ? [{ text: snapshotText }] : [])
        ];
        return stripKnownSpeechPrefix(value, baselines);
    };

    const getSpeechSenderName = (owner) => {
        const faceState = faceStateRef.current;
        return faceState.splitScreenEnabled && faceState.faceSessionActive && owner === 'guest'
            ? 'Karşı taraf'
            : nickname;
    };

    const rememberRecentVoiceMessage = (text, owner) => {
        const clean = String(text || '').trim();
        if (!clean) return;
        const now = Date.now();
        recentVoiceMessagesRef.current = [
            ...recentVoiceMessagesRef.current.filter(message => now - Number(message.timestamp || 0) < 10 * 60 * 1000),
            {
                text: clean,
                senderName: getSpeechSenderName(owner),
                timestamp: now,
                isVoice: true
            }
        ].slice(-12);
    };

    const buildSpeechSessionBaselines = (owner) => {
        const faceState = faceStateRef.current;
        const isFaceSession = faceState.splitScreenEnabled && faceState.faceSessionActive;
        const senderName = getSpeechSenderName(owner);
        const now = Date.now();
        const candidates = [
            ...recentVoiceMessagesRef.current,
            ...Object.values(pendingLocalMessagesRef.current || {}),
            ...messagesRef.current
        ]
            .filter(message => message?.text)
            .filter(message => now - Number(message.timestamp || 0) < 10 * 60 * 1000)
            .filter(message => {
                if (isFaceSession) {
                    return Number(message.timestamp || 0) >= faceState.faceSessionStartedAt - 5000;
                }
                return (
                    message.senderName === senderName ||
                    Boolean(currentUsername && message.senderUsername === currentUsername) ||
                    Boolean(currentDeviceId && message.senderDeviceId === currentDeviceId)
                );
            })
            .sort((first, second) => Number(second.timestamp || 0) - Number(first.timestamp || 0));

        const seen = new Set();
        return candidates.filter(message => {
            const key = normalizeSpeechWords(message.text).join(' ');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 8);
    };

    const stripPreviousSpeakerPrefix = (value, owner) => {
        const faceState = faceStateRef.current;
        const words = String(value || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '';

        const normalizedWords = normalizeSpeechWords(value);
        const isFaceSession = faceState.splitScreenEnabled && faceState.faceSessionActive;
        const senderName = getSpeechSenderName(owner);
        const now = Date.now();
        const recentCachedMessages = [
            ...recentVoiceMessagesRef.current,
            ...Object.values(pendingLocalMessagesRef.current || {}),
            ...messagesRef.current
        ]
            .filter(message => now - Number(message.timestamp || 0) < 10 * 60 * 1000)
            .filter(message => message.text)
            .filter(message => isFaceSession
                ? Number(message.timestamp || 0) >= faceState.faceSessionStartedAt - 5000
                : message.senderName === senderName)
            .sort((first, second) => Number(second.timestamp || 0) - Number(first.timestamp || 0))
            .filter((message, index, list) => list.findIndex(item => item.text === message.text && item.senderName === message.senderName) === index)
            .slice(0, isFaceSession ? 10 : 8);

        if (!recentCachedMessages.length) return value.trim();

        for (const message of recentCachedMessages) {
            const previousWords = normalizeSpeechWords(message.text);
            if (!previousWords.length || normalizedWords.length < 2) continue;

            let matchingPrefixLength = 0;
            const comparableLength = Math.min(previousWords.length, normalizedWords.length);
            for (let index = 0; index < comparableLength; index += 1) {
                if (normalizedWords[index] !== previousWords[index]) break;
                matchingPrefixLength += 1;
            }

            const previousCoverage = matchingPrefixLength / previousWords.length;
            const currentCoverage = matchingPrefixLength / normalizedWords.length;
            const shouldStrip = matchingPrefixLength >= 3 && (previousCoverage >= 0.55 || currentCoverage >= 0.45);
            if (shouldStrip && words.length > matchingPrefixLength) {
                return words.slice(matchingPrefixLength).join(' ').trim();
            }

            const fuzzyPrefixLength = findLikelyCachedPrefixLength(normalizedWords, previousWords);
            if (fuzzyPrefixLength && words.length > fuzzyPrefixLength) {
                return words.slice(fuzzyPrefixLength).join(' ').trim();
            }

            const cachedSegment = findLikelyCachedSegment(normalizedWords, previousWords);
            if (cachedSegment) {
                return [
                    ...words.slice(0, cachedSegment.start),
                    ...words.slice(cachedSegment.end)
                ].join(' ').trim();
            }
        }

        return value.trim();
    };

    const cleanSpeechCandidate = (value, owner) => {
        const clean = String(value || '').trim();
        if (!clean) return '';
        const faceState = faceStateRef.current;
        if (!faceState.splitScreenEnabled || !faceState.faceSessionActive) return clean;
        return stripPreviousSpeakerPrefix(
            stripSentSpeechSnapshot(clean, owner),
            owner
        );
    };

    const isLikelyDuplicateFaceSpeech = (value, owner) => {
        const faceState = faceStateRef.current;
        if (!faceState.splitScreenEnabled || !faceState.faceSessionActive) return false;
        const candidateWords = normalizeSpeechWords(value);
        if (candidateWords.length < 2) return false;

        const senderName = owner === 'guest' ? 'Karşı taraf' : nickname;
        const recentSameSpeakerMessages = messagesRef.current
            .filter(message => Number(message.timestamp || 0) >= faceState.faceSessionStartedAt - 5000)
            .filter(message => message.senderName === senderName && message.text)
            .slice(-8)
            .reverse();

        return recentSameSpeakerMessages.some(message => {
            const previousWords = normalizeSpeechWords(message.text);
            if (previousWords.length < 2) return false;
            const overlap = countWordOverlap(candidateWords, previousWords);
            const candidateCoverage = overlap / candidateWords.length;
            const previousCoverage = overlap / previousWords.length;
            const isSubsetOfPrevious = candidateWords.length <= previousWords.length && candidateCoverage >= 0.9;
            const isNearSameMessage = candidateCoverage >= 0.85 && previousCoverage >= 0.75;
            return isSubsetOfPrevious || isNearSameMessage;
        });
    };

    const sendCapturedSpeechText = async (textToSend, lang) => {
        const speechOwner = speechOwnerRef.current;
        const rawText = String(textToSend || '').trim();
        const pendingText = cleanSpeechCandidate(rawText, speechOwner);
        if (!pendingText || speechStopSentRef.current || isLikelyDuplicateFaceSpeech(pendingText, speechOwner)) {
            resetSpeechCapture();
            await closeSpeechCaptureAfterSend();
            return;
        }
        speechStopSentRef.current = true;
        lastSentSpeechSnapshotRef.current = {
            text: pendingText,
            owner: speechOwner,
            timestamp: Date.now()
        };
        rememberNativeSpeechTranscript(pendingText);
        rememberRecentVoiceMessage(pendingText, speechOwner);
        lastCapturedTextRef.current = '';
        finalizedSpeechRef.current = '';
        await closeSpeechCaptureAfterSend();
        sendMessageToCloud(pendingText, true, lang, { speechOwner });
    };

    const showSpeechFallback = () => {
        setToast('');
        setTimeout(() => manualInputRef.current?.focus(), 0);
    };

    const sendTestBotVoiceMessage = (lang) => {
        setActiveRecognitionLang(lang);
        setSpeechPreview('Test sesli mesaj hazirlaniyor...');
        setIsListening(true);
        playBeep('start');
        setTimeout(() => {
            sendMessageToCloud('Bu bir test sesli mesajidir.', true, lang);
            setIsListening(false);
            clearSpeechPreview();
            playBeep('stop');
        }, 650);
    };

    const getSpeechPersonalTerms = () => {
        const recentNames = messagesRef.current
            .slice(-40)
            .flatMap(message => [message.senderName, message.senderUsername])
            .filter(Boolean);
        return extractPersonalTerms(
            nickname,
            account?.nickname,
            account?.username,
            roomData?.nickname,
            roomData?.username,
            roomData?.title,
            ...recentNames
        );
    };

    // Dynamic Speech Recognition manager
    const getOrInitRecognizer = (lang, sessionToken = speechSessionRef.current) => {
        const isNativeSpeech = Capacitor.isNativePlatform();
        if (!isNativeSpeech && recognitionRef.current && recognitionRef.current.lang === lang) {
            return recognitionRef.current;
        }
        if (recognitionRef.current) {
            try {
                recognitionRef.current.abort();
            } catch (e) {
                console.error(e);
            }
            recognitionRef.current = null;
        }

        const handleResult = (finalText, interimText) => {
            if (speechSessionRef.current !== sessionToken) return;
            if (ignoreSpeechResultsRef.current || speechStopSentRef.current) return;
            if (finalText.trim()) {
                commitSpeechLiveSegment(finalText.trim());
            } else if (interimText.trim()) {
                updateSpeechLiveSegment(interimText.trim());
            }
        };

        const handleEnd = () => {
            if (speechSessionRef.current !== sessionToken) return;
            setIsSpeechStarting(false);
            speechStartInFlightRef.current = false;
            if (suppressNextSpeechEndRef.current) {
                suppressNextSpeechEndRef.current = false;
                setIsListening(false);
                resetSpeechCapture();
                stopActiveStream();
                playBeep('stop');
                return;
            }
            if (ignoreSpeechResultsRef.current || speechStopSentRef.current) {
                setIsListening(false);
                stopActiveStream();
                return;
            }
            if (isListeningRef.current) {
                const pendingText = commitSpeechLiveSegment();
                if (pendingText) {
                    speechCommittedTextRef.current = pendingText;
                    speechLiveTextRef.current = '';
                    finalizedSpeechRef.current = pendingText;
                    lastCapturedTextRef.current = pendingText;
                    setSpeechPreview(pendingText);
                }
                setIsListening(true);
                return;
            }
            const pendingText = commitSpeechLiveSegment();
            const stablePendingText = pendingText || speechSessionTextRef.current;
            setIsListening(false);
            clearSpeechPreview();
            stopActiveStream();
            playBeep('stop');

            if (stablePendingText) {
                sendCapturedSpeechText(stablePendingText, lang);
            } else {
                lastCapturedTextRef.current = '';
                finalizedSpeechRef.current = '';
            }
        };

        const handleError = (e) => {
            if (speechSessionRef.current !== sessionToken) return;
            console.error("Speech Recognition Error:", e);
            setIsSpeechStarting(false);
            speechStartInFlightRef.current = false;
            const errCode = e && (e.error || e.message) ? (e.error || e.message) : String(e || '');
            const errorStr = String(errCode).toLowerCase();
            if (
                errorStr.includes("no match") ||
                errorStr.includes("no_match") ||
                errorStr.includes("no speech") ||
                errorStr.includes("no_speech") ||
                errorStr.includes("konuşma algılanamadı") ||
                errorStr.includes("konusma algilanamadi") ||
                errorStr.includes("aborted") ||
                errorStr.includes("7") ||
                errorStr.includes("busy") ||
                errorStr.includes("already") ||
                errorStr.includes("cancelled") ||
                errorStr.includes("canceled")
            ) {
                commitSpeechLiveSegment();
                syncSpeechDraftFromTape();
                if (isListeningRef.current) setIsListening(true);
                return;
            }
            setIsListening(false);
            clearSpeechPreview();
            lastCapturedTextRef.current = '';
            finalizedSpeechRef.current = '';

            if (!shouldShowSpeechModal(errCode)) {
                if (isTestBotRoom) {
                    sendTestBotVoiceMessage(lang);
                } else {
                    showSpeechFallback();
                }
                return;
            }

            setSpeechError(errCode);
        };

        const rec = getDuoSpeechRecognizer(lang, handleResult, handleEnd, handleError);
        if (rec) {
            rec.lang = lang;
        }
        recognitionRef.current = rec;
        return rec;
    };

    // Clean up speech recognizer when leaving or changing language.
    useEffect(() => {
        return () => {
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.abort();
                } catch (e) {
                    console.error(e);
                }
            }
        };
    }, [speechLang]);

    const toggleListening = async (targetLang = speechLang) => {
        if (speechStartInFlightRef.current || speechClosingRef.current) return;
        const actualLang = (typeof targetLang === 'string') ? targetLang : speechLang;

        if (isListeningRef.current) {
            const rec = recognitionRef.current;
            if (!rec) return;
            const pendingBeforeStop = commitSpeechLiveSegment() || speechSessionTextRef.current;
            ignoreSpeechResultsRef.current = true;
            speechStartInFlightRef.current = true;
            setIsSpeechStarting(false);
            isListeningRef.current = false;
            setIsListening(false);
            stopActiveStream();
            playBeep('stop');

            runAfterUiPaint(async () => {
                try {
                    if (pendingBeforeStop) {
                        lastCapturedTextRef.current = pendingBeforeStop;
                        await sendCapturedSpeechText(pendingBeforeStop, actualLang);
                        return;
                    }
                    if (typeof rec.abort === 'function') rec.abort();
                    else await rec.stop();
                    resetSpeechCapture();
                } catch (error) {
                    console.error("Speech recognition could not be stopped:", error);
                } finally {
                    if (!speechClosingRef.current) {
                        speechStartInFlightRef.current = false;
                    }
                    stopActiveStream();
                }
            });
            return;
        } else {
            speechStartInFlightRef.current = true;
            setIsSpeechStarting(false);
            isListeningRef.current = true;
            setIsListening(true);
            playBeep('start');
            setActiveRecognitionLang(actualLang);
            const sessionToken = speechSessionRef.current + 1;
            speechSessionRef.current = sessionToken;
            speechOwnerRef.current = splitScreenEnabled && faceSessionActive ? faceSpeakerRef.current : 'host';
            speechSessionBaselinesRef.current = buildSpeechSessionBaselines(speechOwnerRef.current);
            resetSpeechSessionBuffers();
            const shouldResetRecognizerBeforeStart = Capacitor.isNativePlatform() || (splitScreenEnabled && faceSessionActive);
            if (shouldResetRecognizerBeforeStart) {
                try {
                    recognitionRef.current?.abort?.();
                } catch (error) {
                    console.warn('Speech recognition could not be reset before capture:', error);
                }
                recognitionRef.current = null;
            }
            try {
                const freshRec = getOrInitRecognizer(actualLang, sessionToken);
                if (!freshRec) {
                    alert("Speech recognition is not supported on this browser/device.");
                    speechStartInFlightRef.current = false;
                    setIsSpeechStarting(false);
                    isListeningRef.current = false;
                    setIsListening(false);
                    return;
                }
                isListeningRef.current = true;
                setIsListening(true);
                await freshRec.start();
                speechStartInFlightRef.current = false;
                setIsSpeechStarting(false);

            } catch (error) {
                speechStartInFlightRef.current = false;
                setIsSpeechStarting(false);
                isListeningRef.current = false;
                setIsListening(false);
                clearSpeechPreview();
                const message = error?.message || String(error || '');
                if (message && shouldShowSpeechModal(message)) {
                    setSpeechError(message);
                } else if (message) {
                    if (isTestBotRoom) {
                        sendTestBotVoiceMessage(actualLang);
                    } else {
                        showSpeechFallback();
                    }
                }
            }
        }
    };

    const cancelSpeechCapture = () => {
        ignoreSpeechResultsRef.current = true;
        suppressNextSpeechEndRef.current = true;
        speechStopSentRef.current = true;
        speechStartInFlightRef.current = false;
        speechClosingRef.current = false;
        isListeningRef.current = false;
        setIsSpeechStarting(false);
        setIsListening(false);
        stopActiveStream();
        const recognizer = recognitionRef.current;
        recognitionRef.current = null;
        lastCapturedTextRef.current = '';
        finalizedSpeechRef.current = '';
        interimTextRef.current = '';
        speechCommittedTextRef.current = '';
        speechLiveTextRef.current = '';
        speechSessionTextRef.current = '';
        clearSpeechPreview();
        playBeep('stop');
        try {
            if (recognizer && typeof recognizer.abort === 'function') recognizer.abort();
            else recognizer?.stop?.();
        } catch (error) {
            console.warn('Speech recognition cancel failed:', error);
        }
    };

    const restoreMemberHistories = async () => {
        const roomSnapshot = await get(ref(db, `rooms/${roomId}`));
        const room = roomSnapshot.val() || {};
        const members = Object.keys(room.members || {});
        const metadata = room.metadata || {};
        if (!members.length) return;
        const timestamp = Date.now();
        const historyUpdates = {};
        members.forEach(username => {
            const peerUsername = members.find(member => member !== username) || '';
            historyUpdates[`users/${username}/history/${roomId}`] = {
                roomId,
                roomPin: room.pin || roomData.roomPin || '',
                nickname: metadata.memberNames?.[username] || nickname,
                role: 'intercom',
                roomType: 'intercom_only',
                kind: metadata.kind || (members.length > 2 ? 'group' : 'direct'),
                title: metadata.kind === 'group' ? (metadata.name || 'Grup') : (metadata.memberNames?.[peerUsername] || peerUsername || roomId),
                peerUsername,
                timestamp
            };
        });
        await update(ref(db), historyUpdates);
    };

    const sendMessageToCloud = async (msgText, isVoice = false, msgLang = speechLang, options = {}) => {
        const limitedMessageText = limitChatMessageText(msgText);
        if (!limitedMessageText) return;
        const shouldCorrect = options.shouldCorrect ?? isVoice;
        const personalTerms = shouldCorrect ? getSpeechPersonalTerms() : [];
        if (personalTerms.length) rememberPersonalTerms(personalTerms);
        const correctedText = shouldCorrect ? limitChatMessageText(correctTranscription(limitedMessageText, msgLang, {
            context: options.transcriptContext || (options.speechOwner ? 'face' : 'chat'),
            finalize: true,
            personalTerms
        })) : limitedMessageText;
        if (!correctedText.trim()) return;
        const normalizedOutboundText = correctedText.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
        const lastOutbound = lastOutboundMessageRef.current;
        const isDuplicateSend = lastOutbound.roomId === roomId &&
            lastOutbound.text === normalizedOutboundText &&
            lastOutbound.isVoice === Boolean(isVoice) &&
            lastOutbound.lang === msgLang &&
            Date.now() - lastOutbound.timestamp < 3500;
        if (isDuplicateSend) return;
        lastOutboundMessageRef.current = {
            roomId,
            text: normalizedOutboundText,
            isVoice: Boolean(isVoice),
            lang: msgLang,
            timestamp: Date.now()
        };

        if (isTestBotRoom) {
            const now = Date.now();
            const senderOwner = options.speechOwner || faceSpeakerRef.current;
            const senderName = splitScreenEnabled && faceSessionActive && senderOwner === 'guest' ? 'Karşı taraf' : nickname;
            const userMessage = {
                id: `local-${now}`,
                senderName,
                senderUsername: account?.username || roomData.username || 'local-user',
                senderDeviceId: getDeviceId(),
                text: correctedText.trim(),
                timestamp: now,
                isVoice,
                status: 'sent',
                senderLang: msgLang,
                ...(replyToMsg ? { quotedMsg: { senderName: replyToMsg.senderName, text: replyToMsg.text } } : {})
            };
            if (replyToMsg) setReplyToMsg(null);
            setMessages(current => {
                const next = [...current, userMessage];
                localStorage.setItem(`eary_test_bot_messages_${roomId}`, JSON.stringify(next));
                return next;
            });
            setTimeout(() => {
                const botMessage = {
                    id: `bot-${Date.now()}`,
                    senderName: TEST_BOT_NAME,
                    senderUsername: 'eary-test-bot',
                    senderDeviceId: 'local-test-bot',
                    text: getTestBotReply(correctedText.trim()),
                    timestamp: Date.now(),
                    isVoice: false,
                    status: 'read',
                    senderLang: msgLang
                };
                setMessages(current => {
                    const next = [...current, botMessage];
                    localStorage.setItem(`eary_test_bot_messages_${roomId}`, JSON.stringify(next));
                    return next;
                });
            }, 450);
            return;
        }

        try {
            const msgRef = ref(db, `rooms/${roomId}/messages`);
            const senderOwner = options.speechOwner || faceSpeakerRef.current;
            const senderName = splitScreenEnabled && faceSessionActive && senderOwner === 'guest' ? 'Karşı taraf' : nickname;

            if (isVoice) {
                const newMsgRef = push(msgRef);
                const payload = {
                    id: newMsgRef.key,
                    senderName,
                    senderUsername: currentUsername,
                    senderDeviceId: getDeviceId(),
                    text: correctedText.trim(),
                    timestamp: Date.now(),
                    isVoice: true,
                    status: 'pending',
                    senderLang: msgLang
                };
                if (replyToMsg) {
                    payload.quotedMsg = {
                        senderName: replyToMsg.senderName,
                        text: replyToMsg.text
                    };
                    setReplyToMsg(null);
                }

                pendingLocalMessagesRef.current[payload.id] = payload;
                setMessages(current => {
                    if (current.some(message => message.id === payload.id)) return current;
                    return [...current, payload].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
                });

                const cloudPayload = { ...payload };
                delete cloudPayload.id;
                await updateRest({
                    [`rooms/${roomId}/messages/${payload.id}`]: {
                        ...cloudPayload,
                        status: 'sent'
                    },
                    [`rooms/${roomId}/lastMessage`]: {
                        ...payload,
                        status: 'sent'
                    }
                });
                delete pendingLocalMessagesRef.current[payload.id];
                setMessages(current => current.map(message => (
                    message.id === payload.id ? { ...message, status: 'sent' } : message
                )));
                await restoreMemberHistories();
                return;
            }

            const newMsgRef = push(msgRef);
            const payload = {
                id: newMsgRef.key,
                senderName,
                senderUsername: currentUsername,
                senderDeviceId: getDeviceId(),
                text: correctedText.trim(),
                timestamp: Date.now(),
                isVoice: isVoice,
                status: 'pending',
                senderLang: msgLang
            };
            if (replyToMsg) {
                payload.quotedMsg = {
                    senderName: replyToMsg.senderName,
                    text: replyToMsg.text
                };
                setReplyToMsg(null);
            }

            pendingLocalMessagesRef.current[payload.id] = payload;
            setMessages(current => {
                if (current.some(message => message.id === payload.id)) return current;
                return [...current, payload].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
            });

            const cloudPayload = { ...payload };
            delete cloudPayload.id;
            await updateRest({
                [`rooms/${roomId}/messages/${payload.id}`]: {
                    ...cloudPayload,
                    status: 'sent'
                },
                [`rooms/${roomId}/lastMessage`]: {
                    ...payload,
                    status: 'sent'
                }
            });
            delete pendingLocalMessagesRef.current[payload.id];
            setMessages(current => current.map(message => (
                message.id === payload.id ? { ...message, status: 'sent' } : message
            )));
            await restoreMemberHistories();
        } catch (err) {
            console.error("Database Write/Merge Error:", err);
        }
    };

    const submitManualMessage = async () => {
        const messageText = limitChatMessageText(manualText);
        if (!messageText || manualSubmitLockRef.current) return;
        manualSubmitLockRef.current = true;
        setManualText('');
        setShowEmojiPicker(false);
        try {
            if (splitScreenEnabled && faceSessionActive) selectFaceSpeaker('host');
            if (editingMessage) {
                await update(ref(db, `rooms/${roomId}/messages/${editingMessage.id}`), {
                    text: messageText,
                    editedAt: Date.now()
                });
                setEditingMessage(null);
            } else {
                await sendMessageToCloud(messageText, false, speechLang, { shouldCorrect: false });
            }
        } finally {
            manualSubmitLockRef.current = false;
        }
    };

    const handleManualSubmit = async (e) => {
        e?.preventDefault?.();
        await submitManualMessage();
    };

    const handleManualSendPress = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        submitManualMessage();
    };

    const writeRoomLastMessage = async (targetRoomId, message) => {
        const previewPayload = {
            id: message.id,
            senderName: message.senderName,
            senderUsername: message.senderUsername || '',
            senderDeviceId: message.senderDeviceId || '',
            text: message.text || '',
            timestamp: message.timestamp || Date.now(),
            isVoice: Boolean(message.isVoice),
            status: message.status || 'sent',
            senderLang: message.senderLang || speechLang,
            forwarded: Boolean(message.forwarded)
        };
        await updateRest({ [`rooms/${targetRoomId}/lastMessage`]: previewPayload });
    };

    const appendEmoji = (emoji) => {
        setManualText(prev => `${prev}${emoji}`);
    };

    // Old pairing handlers removed (casting connection forms now managed inside Sidebar settings)

    // Trigger direct local notification for testing permissions
    const triggerTestNotification = async () => {
        const granted = await requestNotificationPermission();
        if (!granted) {
            alert("Bildirim izni etkin değil! Bildirimleri alabilmek için lütfen telefonunuzun uygulama ayarlarından bildirim izinlerini açın.");
        }
        scheduleNotification(text.testAlertTitle, text.testAlertBody);
    };

    // Bulk Delete Logic
    const toggleSelectMessage = (msgId) => {
        setSelectedIds(prev => (
            prev.includes(msgId)
                ? prev.filter(id => id !== msgId)
                : [...prev, msgId]
        ));
    };

    const executeBulkDelete = () => {
        if (selectedIds.length === 0) return;

        selectedIds.forEach((msgId) => {
            const itemRef = ref(db, `rooms/${roomId}/messages/${msgId}`);
            remove(itemRef).catch(e => console.error("Remove Error:", e));
        });

        setSelectedIds([]);
        setIsSelectMode(false);
    };

    const getMessageShareText = (msg) => msg.text || '';

    const copyMessage = async (msg) => {
        const content = getMessageShareText(msg);
        if (!content) return;
        try {
            await navigator.clipboard.writeText(content);
        } catch {
            const textArea = document.createElement('textarea');
            textArea.value = content;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
        }
        setActiveMessageMenuId(null);
        setToast('Mesaj kopyalandı');
        setTimeout(() => setToast(''), 1600);
    };

    const forwardMessage = async (msg) => {
        setActiveMessageMenuId(null);
        setForwardingMessage(msg);
    };

    const forwardToRoom = async (targetRoomId) => {
        if (!forwardingMessage) return;
        const targetRef = push(ref(db, `rooms/${targetRoomId}/messages`));
        const payload = {
            id: targetRef.key,
            senderName: nickname,
            senderUsername: account?.username || roomData.username || '',
            senderDeviceId: getDeviceId(),
            text: forwardingMessage.text || '',
            timestamp: Date.now(),
            status: 'sent',
            senderLang: speechLang,
            forwarded: true
        };
        const cloudPayload = { ...payload };
        delete cloudPayload.id;
        await set(targetRef, cloudPayload);
        await writeRoomLastMessage(targetRoomId, payload);
        setForwardingMessage(null);
        setToast('Mesaj iletildi');
        setTimeout(() => setToast(''), 1800);
    };

    const shareExternally = async () => {
        if (!forwardingMessage) return;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Eary mesajı', text: forwardingMessage.text || undefined });
            } else {
                await copyMessage(forwardingMessage);
            }
        } catch (error) {
            if (error?.name !== 'AbortError') console.error('Share failed:', error);
        }
    };

    const startEditingMessage = (msg) => {
        setEditingMessage({ id: msg.id });
        setReplyToMsg(null);
        setManualText(msg.text || '');
        setActiveMessageMenuId(null);
        setTimeout(() => manualInputRef.current?.focus(), 0);
    };

    const deleteMessage = async (msg) => {
        setActiveMessageMenuId(null);
        setDeletingMessage(msg);
    };

    const deleteMessageForMe = () => {
        if (!deletingMessage) return;
        const next = [...new Set([...hiddenMessageIds, deletingMessage.id])];
        setHiddenMessageIds(next);
        localStorage.setItem(`eary_hidden_${roomId}`, JSON.stringify(next));
        setDeletingMessage(null);
    };

    const deleteMessageForEveryone = async () => {
        if (!deletingMessage || deletingMessage.senderName !== nickname) return;
        await remove(ref(db, `rooms/${roomId}/messages/${deletingMessage.id}`));
        setDeletingMessage(null);
    };

    const renderMessageActions = (msg, isSelf) => activeMessageMenuId === msg.id && (
        <div
            data-message-actions
            className="fixed z-[160] w-44 overflow-hidden rounded-2xl border border-[#DCD0EC] bg-white/95 py-1.5 shadow-2xl backdrop-blur-xl animate-scaleUp"
            style={{ top: messageMenuPosition.top, left: messageMenuPosition.left }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <div className={`absolute h-3 w-3 rotate-45 border-[#DCD0EC] bg-white ${
                messageMenuPosition.placement === 'left'
                    ? '-right-1 top-5 border-r border-t'
                    : messageMenuPosition.placement === 'up'
                        ? 'bottom-3 -right-1 border-r border-b'
                        : '-left-1 top-5 border-b border-l'
            }`} />
            <div className="relative z-10 flex items-center justify-between border-b border-[#E6DFF0] bg-white/95 px-2 py-1.5">
                {['👍', '❤️', '😂', '😮', '🙏'].map(emoji => (
                    <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                            toggleReaction(msg.id, emoji);
                            setActiveMessageMenuId(null);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition hover:bg-[#F4F0F8]"
                        aria-label={`${emoji} tepkisi ver`}
                    >
                        {emoji}
                    </button>
                ))}
            </div>
            <button type="button" onClick={() => {
                setReplyToMsg({ id: msg.id, text: msg.text || 'Mesaj', senderName: msg.senderName });
                setEditingMessage(null);
                setActiveMessageMenuId(null);
                setTimeout(() => manualInputRef.current?.focus(), 0);
            }} className="relative z-10 flex w-full items-center gap-3 px-3 py-2 text-left text-xs font-semibold text-[#2D1F47] hover:bg-[#F4F0F8]">
                <Reply size={16} /> Cevapla
            </button>
            <button type="button" onClick={() => forwardMessage(msg)} className="relative z-10 flex w-full items-center gap-3 px-3 py-2 text-left text-xs font-semibold text-[#2D1F47] hover:bg-[#F4F0F8]">
                <Forward size={16} /> İlet
            </button>
            {isSelf && msg.text && (
                <button type="button" onClick={() => startEditingMessage(msg)} className="relative z-10 flex w-full items-center gap-3 px-3 py-2 text-left text-xs font-semibold text-[#2D1F47] hover:bg-[#F4F0F8]">
                    <Pencil size={16} /> Düzenle
                </button>
            )}
            <button type="button" onClick={() => copyMessage(msg)} className="relative z-10 flex w-full items-center gap-3 px-3 py-2 text-left text-xs font-semibold text-[#2D1F47] hover:bg-[#F4F0F8]">
                <Copy size={16} /> Kopyala
            </button>
            <div className="my-1 border-t border-[#E6DFF0]" />
            <button type="button" onClick={() => deleteMessage(msg)} className="relative z-10 flex w-full items-center gap-3 px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50">
                <Trash2 size={16} /> Sil
            </button>
        </div>
    );

    const renderSpeechDraftBubble = draftText => {
        if (!isListening || !draftText || splitScreenEnabled) return null;
        const words = draftText.split(/\s+/).filter(Boolean);

        return (
            <div className="flex items-start justify-end gap-2.5">
                <div className="flex max-w-[85%] flex-col items-end">
                    <span className="px-1 text-[10px] font-semibold tracking-wider text-[#8A7E9F]">
                        {nickname}
                    </span>
                    <div className="rounded-2xl rounded-br-sm border border-[#DCD0EC]/70 bg-white/35 px-4 py-3 text-[#111827] shadow-sm">
                        <p style={{ fontSize: `${chatFontSize}px` }} className="font-medium leading-relaxed opacity-45">
                            {words.map((word, index) => (
                                <button
                                    key={`${word}-${index}`}
                                    type="button"
                                    data-word-index={index}
                                    onClick={handleSpeechDraftWordClick}
                                    className="mx-0.5 rounded px-0.5 text-left underline decoration-dotted underline-offset-2 transition hover:bg-white/70 hover:opacity-100"
                                    title="Kelimeyi düzelt"
                                >
                                    {word}
                                </button>
                            ))}
                        </p>
                    </div>
                    <span className="mt-1 px-1 text-[9px] font-semibold text-[#8A7E9F] opacity-70">
                        Taslak - mik kapanınca gönderilir
                    </span>
                </div>
            </div>
        );
    };

    if (splitScreenEnabled && !faceSessionActive) {
        return (
            <main className="eary-shell relative mx-auto flex h-screen w-full max-w-md flex-col px-5 pb-6 pt-[max(92px,calc(env(safe-area-inset-top)+68px))] sm:h-[800px] sm:rounded-xl sm:border sm:eary-line">
                <button
                    type="button"
                    onPointerUp={exitFaceSetup}
                    onClick={exitFaceSetup}
                    className="eary-soft eary-muted absolute left-5 top-[max(48px,calc(env(safe-area-inset-top)+14px))] z-[120] flex h-12 w-12 items-center justify-center rounded-xl border eary-line shadow-sm active:scale-95"
                    aria-label="Geri dön"
                    title="Geri dön"
                >
                    <ArrowLeft size={24} />
                </button>
                <div className="flex flex-1 flex-col justify-center"><div className="eary-brand-soft mb-5 flex h-16 w-16 items-center justify-center rounded-xl"><PanelsTopLeft size={28} /></div><h1 className="text-2xl font-bold">Yüz Yüze Konuşma</h1><p className="eary-muted mt-2 text-sm leading-6">Telefonu iki kişinin arasına yerleştirin. Her taraf kendi mikrofonuna dokunarak konuşur; Eary konuşmayı iki yöne okunabilir metne çevirir.</p><div className="mt-6 space-y-3"><div className="flex gap-3"><span className="eary-brand-soft flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold">1</span><p className="text-sm">Karşı taraf üst ekrandaki mikrofonu kullanır.</p></div><div className="flex gap-3"><span className="eary-brand-soft flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold">2</span><p className="text-sm">Siz yazabilir, konuşabilir veya hazır ifadeleri seçebilirsiniz.</p></div><div className="flex gap-3"><span className="eary-brand-soft flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold">3</span><p className="text-sm">Görüşme bittiğinde kaydetmeyi veya tamamen silmeyi seçersiniz.</p></div></div></div>
                <div className="space-y-2"><button type="button" onClick={() => startFaceSession(false)} className="eary-brand-bg w-full rounded-lg py-3.5 text-sm font-bold">Geçici görüşme başlat</button><button type="button" onClick={() => startFaceSession(true)} className="eary-soft eary-brand w-full rounded-lg py-3.5 text-sm font-bold">Kaydedilecek görüşme başlat</button><p className="eary-muted text-center text-[10px]">Seçiminizi görüşme sonunda değiştirebilirsiniz.</p></div>
            </main>
        );
    }

    const faceMessages = messages.filter(message => Number(message.timestamp || 0) >= faceSessionStartedAt && !hiddenMessageIds.includes(message.id));
    const guestListening = isListening && faceSpeaker === 'guest';
    const hostListening = isListening && faceSpeaker === 'host';

    if (splitScreenEnabled) {
        return (
            <div className="flex flex-col h-screen max-h-screen bg-[#FAF8F5] text-[#2D1F47] overflow-hidden relative select-none">
                {/* Neon Dividier line */}
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-[#FAF8F5] via-[#7B52AB]/50 to-[#FAF8F5] z-20 shadow-lg flex items-center justify-center pointer-events-none">
                    <div className="px-3 py-1 bg-[#EBE5F7] border border-[#DCD0EC] rounded-full text-[9px] font-extrabold uppercase tracking-widest text-[#7B52AB] shadow-md">
                        ⇄ YÜZ YÜZE MODU ⇄
                    </div>
                </div>

                {/* 1. TOP HALF (Guest - Rotated 180 degrees) */}
                <div className="h-1/2 flex flex-col transform rotate-180 bg-[#FAF8F5]/30 relative border-b border-[#DCD0EC]/60">
                    {/* Header bar / status */}
                    <div className="flex items-center justify-between p-3 bg-white/90 border-t border-[#DCD0EC]/50 z-10 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${faceSpeaker === 'guest' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                            <span className="text-xs font-bold text-[#2D1F47]">Karşı taraf {faceSpeaker === 'guest' && '· konuşma sırası'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-[#8A7E9F] font-bold uppercase">Türkçe</span>
                        </div>
                    </div>

                    {/* Messages feed */}
                    <div ref={topChatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                        {faceMessages.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-center text-xs text-[#8A7E9F] italic font-medium">
                                Konuşma kaydı yok.
                            </div>
                        ) : (
                            faceMessages.map((msg) => {
                                const isSelf = msg.senderName === nickname;
                                return (
                                    <div
                                        key={msg.id}
                                        style={{ overflowAnchor: 'none' }}
                                        onPointerDown={(event) => handlePressStart(event, msg)}
                                        onPointerMove={handlePressMove}
                                        onPointerUp={cancelLongPress}
                                        onPointerCancel={cancelLongPress}
                                        onPointerLeave={cancelLongPress}
                                        className="flex items-start gap-2.5"
                                    >
                                        <div className={`flex items-center gap-2 w-full ${isSelf ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`flex flex-col max-w-[85%] relative ${isSelf ? 'items-end' : 'items-start'}`}>
                                                <span className="text-[10px] text-[#8A7E9F] font-semibold tracking-wider mb-1 px-1">
                                                    {msg.senderName}
                                                </span>
                                                <div
                                                    onClick={(event) => handleMessageClick(event, msg.id)}
                                                    className={`px-3 py-2 rounded-2xl text-xs leading-relaxed cursor-pointer relative shadow-sm ${
                                                        isSelf
                                                            ? 'bg-[#D9FDD3] text-[#17351F] rounded-tl-none border border-[#B8E6B1]/80 shadow-sm'
                                                            : 'bg-white text-[#2D1F47] rounded-tr-none border border-[#E6DFF0] shadow-sm'
                                                    }`}
                                                >
                                                    {/* Quoted Message inside bubble */}
                                                    {msg.forwarded && <span className="mb-1 flex items-center gap-1 text-[9px] font-semibold opacity-60"><Forward size={10} /> İletildi</span>}
                                                    {msg.quotedMsg && (
                                                        <div className="mb-1.5 p-1 bg-[#FAF8F5]/85 border-l-3 border-[#7B52AB] rounded-r-md text-[9px] leading-tight select-none">
                                                            <span className="font-extrabold text-[#7B52AB] block">
                                                                {msg.quotedMsg.senderName}
                                                            </span>
                                                            <span className="text-slate-550 line-clamp-1 block font-medium">
                                                                {msg.quotedMsg.text}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {msg.text && <p style={{ fontSize: `${chatFontSize}px` }} className="font-medium">{msg.text}</p>}
                                                    {msg.editedAt && <span className="mt-1 block text-[9px] italic opacity-60">düzenlendi</span>}
                                                    {autoTranslate && topTranslations[msg.id] && (
                                                        <div className="mt-1.5 pt-1.5 border-t border-[#DCD0EC]/50 text-[11px] text-emerald-600 font-bold">
                                                            <span className="text-[9px] text-slate-500 block font-semibold mb-0.5 uppercase tracking-wider">Çeviri ({topSpeechLang.split('-')[0].toUpperCase()}):</span>
                                                            {topTranslations[msg.id]}
                                                        </div>
                                                    )}

                                                    {/* Floating reaction bar */}
                                                    {activeReactionMenuId === msg.id && (
                                                        <div className={`absolute z-35 -top-11 flex gap-1.5 p-1 bg-white border border-[#DCD0EC]/70 backdrop-blur-md rounded-full shadow-lg animate-scaleUp ${
                                                            isSelf ? 'left-0' : 'right-0'
                                                        }`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                                            {['👍', '❤️', '😂', '😮', '🙏'].map(emoji => (
                                                                <button
                                                                    key={emoji}
                                                                    type="button"
                                                                    onPointerDown={(e) => e.stopPropagation()}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        toggleReaction(msg.id, emoji);
                                                                    }}
                                                                    className="hover:scale-125 active:scale-95 transition-all text-base p-1 cursor-pointer"
                                                                >
                                                                    {emoji}
                                                                </button>
                                                            ))}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setReplyToMsg({ id: msg.id, text: msg.text, senderName: msg.senderName });
                                                                    setActiveReactionMenuId(null);
                                                                }}
                                                                className="hover:scale-110 active:scale-95 transition-all text-[9px] px-2 py-0.5 bg-[#FAF8F5] hover:bg-[#EBE5F7] text-[#7B52AB] font-extrabold rounded-full cursor-pointer flex items-center justify-center shrink-0 border border-[#DCD0EC]"
                                                                title="Cevapla"
                                                            >
                                                                💬 Cevapla
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                {renderMessageActions(msg, isSelf)}
                                                {renderMessageReactions(msg)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                        <div ref={messagesEndTopRef} />
                    </div>

                    {/* Microphone control */}
                    <div className="p-3 bg-[#FAF8F5]/80 border-b border-[#DCD0EC]/60 flex flex-col items-center justify-center gap-1.5 shrink-0">
                        {guestListening && interimText && (
                            <div className="w-full p-2 bg-white border border-[#DCD0EC] rounded-xl mb-1 text-center">
                                <p className="text-xs text-[#2D1F47] italic">{interimText}</p>
                            </div>
                        )}

                        <button
                            type="button"
                            onPointerDown={(event) => handleFaceMicPress(event, 'guest', topSpeechLang)}
                            onClick={(event) => handleFaceMicPress(event, 'guest', topSpeechLang)}
                            className={`p-3.5 rounded-full transition-all active:scale-90 flex items-center justify-center cursor-pointer relative ${
                                guestListening
                                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                                    : 'bg-[#7B52AB] hover:bg-[#663F93] text-white shadow-md'
                            }`}
                        >
                            {guestListening ? (
                                <>
                                    <span className="absolute -inset-1.5 rounded-full bg-rose-600/20 border border-rose-600/40 animate-ping" />
                                    <Send size={18} className="text-white fill-white" />
                                </>
                            ) : (
                                <Mic size={18} />
                            )}
                        </button>
                        <span className={`text-[9px] font-bold uppercase tracking-wider mt-1.5 ${
                            guestListening ? 'text-rose-500 animate-pulse' : 'text-[#8A7E9F]'
                        }`}>
                            {guestListening ? 'Dinliyor...' : 'Konuşmak İçin Basın'}
                        </span>
                    </div>
                </div>

                {/* 2. BOTTOM HALF (Host - Normal) */}
                <div className="h-1/2 flex flex-col bg-[#FAF8F5] relative">
                    {/* Header bar / status */}
                    <div className="flex items-center justify-between p-3 bg-white/90 border-b border-[#DCD0EC]/60 z-10 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${faceSpeaker === 'host' ? 'bg-[#7B52AB] animate-pulse' : 'bg-slate-300'}`} />
                            <span className="text-xs font-bold text-[#2D1F47]">Ben ({nickname}) {faceSpeaker === 'host' && '· konuşma sırası'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] bg-[#EBE5F7] border border-[#DCD0EC]/50 text-[#7B52AB] px-2 py-0.5 rounded-md font-bold">
                                {speechLang.split('-')[0].toUpperCase()}
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowFaceEnd(true)}
                                className="px-2.5 py-1 bg-white hover:bg-[#EBE5F7] text-[#7B52AB] hover:text-[#663F93] rounded-lg text-[10px] font-bold border border-[#DCD0EC] transition-all cursor-pointer"
                            >
                                Kapat
                            </button>
                        </div>
                    </div>

                    {/* Messages feed */}
                    <div ref={bottomChatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                        {faceMessages.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-center text-xs text-[#8A7E9F] italic font-medium">
                                Konuşma kaydı yok.
                            </div>
                        ) : (
                            faceMessages.map((msg) => {
                                const isSelf = msg.senderName === nickname;
                                return (
                                    <div
                                        key={msg.id}
                                        style={{ overflowAnchor: 'none' }}
                                        onPointerDown={(event) => handlePressStart(event, msg)}
                                        onPointerMove={handlePressMove}
                                        onPointerUp={cancelLongPress}
                                        onPointerCancel={cancelLongPress}
                                        onPointerLeave={cancelLongPress}
                                        className="flex items-start gap-2.5"
                                    >
                                        <div className={`flex items-center gap-2 w-full ${isSelf ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`flex flex-col max-w-[85%] relative ${isSelf ? 'items-end' : 'items-start'}`}>
                                                <span className="text-[10px] text-[#8A7E9F] font-semibold tracking-wider mb-1 px-1">
                                                    {msg.senderName}
                                                </span>
                                                <div
                                                    onClick={(event) => handleMessageClick(event, msg.id)}
                                                    className={`px-3 py-2 rounded-2xl text-xs leading-relaxed cursor-pointer relative shadow-sm ${
                                                        isSelf
                                                            ? 'bg-[#D9FDD3] text-[#17351F] rounded-tr-none border border-[#B8E6B1]/80 shadow-sm'
                                                            : 'bg-[#F7F3FA] text-[#2D1F47] rounded-tl-none border border-[#E6DFF0] shadow-sm'
                                                    }`}
                                                >
                                                    {/* Quoted Message inside bubble */}
                                                    {msg.forwarded && <span className="mb-1 flex items-center gap-1 text-[9px] font-semibold opacity-60"><Forward size={10} /> İletildi</span>}
                                                    {msg.quotedMsg && (
                                                        <div className="mb-1.5 p-1 bg-[#FAF8F5]/85 border-l-3 border-[#7B52AB] rounded-r-md text-[9px] leading-tight select-none">
                                                            <span className="font-extrabold text-[#7B52AB] block">
                                                                {msg.quotedMsg.senderName}
                                                            </span>
                                                            <span className="text-slate-550 line-clamp-1 block font-medium">
                                                                {msg.quotedMsg.text}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {msg.text && <p style={{ fontSize: `${chatFontSize}px` }} className="font-medium">{msg.text}</p>}
                                                    {msg.editedAt && <span className="mt-1 block text-[9px] italic opacity-60">düzenlendi</span>}
                                                    {!isSelf && autoTranslate && translations[msg.id] && (
                                                        <div className="mt-1.5 pt-1.5 border-t border-[#DCD0EC]/50 text-[11px] text-emerald-600 font-bold">
                                                    <span className="text-[9px] text-slate-500 block font-semibold mb-0.5 uppercase tracking-wider">Çeviri ({translationTargetLang.split('-')[0].toUpperCase()}):</span>
                                                            {translations[msg.id]}
                                                        </div>
                                                    )}

                                                    {/* Floating reaction bar */}
                                                    {activeReactionMenuId === msg.id && (
                                                        <div className={`absolute z-35 -top-11 flex gap-1.5 p-1 bg-white border border-[#DCD0EC]/70 backdrop-blur-md rounded-full shadow-lg animate-scaleUp ${
                                                            isSelf ? 'right-0' : 'left-0'
                                                        }`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                                            {['👍', '❤️', '😂', '😮', '🙏'].map(emoji => (
                                                                <button
                                                                    key={emoji}
                                                                    type="button"
                                                                    onPointerDown={(e) => e.stopPropagation()}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        toggleReaction(msg.id, emoji);
                                                                    }}
                                                                    className="hover:scale-125 active:scale-95 transition-all text-base p-1 cursor-pointer"
                                                                >
                                                                    {emoji}
                                                                </button>
                                                            ))}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setReplyToMsg({ id: msg.id, text: msg.text, senderName: msg.senderName });
                                                                    setActiveReactionMenuId(null);
                                                                }}
                                                                className="hover:scale-110 active:scale-95 transition-all text-[9px] px-2 py-0.5 bg-[#FAF8F5] hover:bg-[#EBE5F7] text-[#7B52AB] font-extrabold rounded-full cursor-pointer flex items-center justify-center shrink-0 border border-[#DCD0EC]"
                                                                title="Cevapla"
                                                            >
                                                                💬 Cevapla
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                {renderMessageActions(msg, isSelf)}
                                                {renderMessageReactions(msg)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                        <div ref={messagesEndBottomRef} />
                    </div>

                    {/* Controls */}
                    <div className="p-3 bg-white/95 border-t border-[#DCD0EC]/60 flex flex-col gap-2 shrink-0">
                        {hostListening && interimText && (
                            <div className="w-full p-2 bg-[#FAF8F5] border border-[#DCD0EC] rounded-xl text-center">
                                <p className="text-xs text-[#2D1F47] italic">{interimText}</p>
                            </div>
                        )}

                        {/* Quoted Message Preview in Splitscreen */}
                        {editingMessage && (
                            <div className="flex items-center justify-between p-2 bg-[#F4F0F8] border-l-4 border-emerald-500 rounded-r-lg text-[10px] shrink-0">
                                <span className="font-bold text-[#2D1F47]">Mesaj düzenleniyor</span>
                                <button type="button" onClick={() => { setEditingMessage(null); setManualText(''); }} className="p-1 text-[#8A7E9F] hover:text-[#7B52AB]">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                        {replyToMsg && (
                            <div className="flex items-center justify-between p-2 bg-[#FAF8F5] border-l-4 border-[#7B52AB] rounded-r-lg animate-fadeIn text-[10px] shrink-0">
                                <div className="truncate">
                                    <span className="font-extrabold text-[#7B52AB] block">Cevaplanan: {replyToMsg.senderName}</span>
                                    <span className="text-[#8A7E9F] truncate block font-semibold">{replyToMsg.text}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setReplyToMsg(null)}
                                    className="p-1 hover:bg-[#EBE5F7] text-[#8A7E9F] hover:text-[#7B52AB] rounded-full transition-all shrink-0 cursor-pointer"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}

                        <div className="flex gap-1.5 overflow-x-auto pb-1">{FACE_TO_FACE_PHRASES.map(phrase => <button key={phrase} type="button" onClick={() => sendQuickPhrase(phrase)} className="shrink-0 rounded-full border border-[#DCD0EC] bg-[#FAF8F5] px-3 py-1.5 text-[9px] font-bold text-[#5F4B7A]">{phrase}</button>)}</div>
                        <form onSubmit={handleManualSubmit} className="flex gap-2">
                            <input
                                ref={manualInputRef}
                                type="text"
                                value={manualText}
                                onChange={(e) => setManualText(e.target.value)}
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                placeholder="Buraya yazın..."
                                className="flex-1 bg-white border border-[#DCD0EC] rounded-xl px-3 py-1.5 text-xs text-[#2D1F47] focus:outline-none focus:border-[#7B52AB]"
                            />
                            <button type="button" onClick={() => speakText(manualText)} disabled={!manualText.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#DCD0EC] bg-[#FAF8F5] text-[#7B52AB] disabled:opacity-35" title="Metni sesli oku"><Volume2 size={16} /></button>
                            <button
                                type="button"
                                onTouchStart={handleManualSendPress}
                                onMouseDown={handleManualSendPress}
                                onPointerDown={handleManualSendPress}
                                onClick={handleManualSendPress}
                                disabled={!manualText.trim()}
                                className="px-3 py-1.5 bg-[#7B52AB] hover:bg-[#663F93] disabled:opacity-40 rounded-xl text-xs font-bold transition-all text-white"
                            >
                                Gönder
                            </button>
                        </form>

                        <div className="flex flex-col items-center justify-center pt-1">
                            <button
                            type="button"
                                onPointerDown={(event) => handleFaceMicPress(event, 'host', speechLang)}
                                onClick={(event) => handleFaceMicPress(event, 'host', speechLang)}
                            className={`p-3.5 rounded-full transition-all active:scale-90 flex items-center justify-center cursor-pointer relative ${
                                    hostListening
                                        ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                                        : 'bg-[#7B52AB] hover:bg-[#663F93] text-white shadow-md'
                                }`}
                            >
                                {hostListening ? (
                                    <>
                                        <span className="absolute -inset-1.5 rounded-full bg-rose-600/20 border border-rose-600/40 animate-ping" />
                                        <Send size={18} className="text-white fill-white" />
                                    </>
                                ) : (
                                    <Mic size={18} />
                                )}
                            </button>
                            <span className={`text-[9px] font-bold uppercase tracking-wider mt-1.5 ${
                                hostListening ? 'text-rose-500 animate-pulse' : 'text-[#8A7E9F]'
                            }`}>
                                {hostListening ? 'Dinliyor...' : 'Konuşmak İçin Basın'}
                            </span>
                        </div>
                    </div>
                </div>
                {showFaceEnd && <div className="absolute inset-0 z-50 flex items-end bg-black/35"><section className="w-full rounded-t-xl bg-white p-5 text-[#2D1F47] shadow-2xl"><div className="mb-5"><h2 className="text-lg font-bold">Görüşme tamamlandı mı?</h2><p className="mt-1 text-xs leading-5 text-[#8A7E9F]">Bu oturumdaki {faceMessages.length} mesaj için ne yapmak istediğinizi seçin.</p></div><button type="button" onClick={() => finishFaceSession(true)} className="mb-2 flex w-full items-center gap-3 rounded-lg bg-[#7B52AB] px-4 py-3.5 text-left text-sm font-bold text-white"><Save size={18} /> Görüşmeyi kaydet</button><button type="button" onClick={() => finishFaceSession(false)} className="mb-2 flex w-full items-center gap-3 rounded-lg bg-rose-50 px-4 py-3.5 text-left text-sm font-bold text-rose-700"><Eraser size={18} /> Görüşmeyi tamamen sil</button><button type="button" onClick={() => setShowFaceEnd(false)} className="w-full rounded-lg bg-[#F4F0F8] py-3 text-sm font-bold text-[#5F4B7A]">Görüşmeye dön</button>{faceSaveAfterSession && <p className="mt-3 text-center text-[10px] text-[#8A7E9F]">Başlangıç tercihiniz: kaydet</p>}</section></div>}
            </div>
        );
    }

    const speechDraftBubble = renderSpeechDraftBubble(interimText);

    return (
        <div
            className="eary-shell relative mx-auto flex h-screen max-w-md flex-col overflow-hidden sm:h-[800px] sm:rounded-xl sm:border sm:eary-line sm:shadow-xl"
            style={{ '--brand': themeColors.brand, '--brand-strong': themeColors.strong, '--brand-soft': themeColors.soft, '--outgoing': themeColors.outgoing }}
        >
            {!isOnline && (
                <div className="bg-rose-600 text-white text-[10px] font-semibold py-1.5 px-4 text-center animate-pulse flex items-center justify-center gap-1.5 shadow-inner z-40 select-none">
                    <span>⚠️ İnternet Bağlantısı Yok. Bağlanıyor...</span>
                </div>
            )}
            {/* Header */}
            {isSelectMode ? (
                <header className="eary-ios-safe-header flex items-center justify-between bg-white border-b border-[#DCD0EC] px-4 pb-4 shadow-sm transition-all duration-200">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                setIsSelectMode(false);
                                setSelectedIds([]);
                            }}
                            className="p-2 bg-[#FAF8F5] hover:bg-[#EBE5F7] border border-[#DCD0EC] text-[#7B52AB] hover:text-[#663F93] rounded-xl transition-all active:scale-95 cursor-pointer shadow-sm"
                            title="İptal Et"
                        >
                            <X size={18} />
                        </button>
                        <span className="text-sm font-bold text-[#2D1F47]">
                            {selectedIds.length} Mesaj Seçildi
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={executeBulkDelete}
                        disabled={selectedIds.length === 0}
                        className="p-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 rounded-xl text-white transition-all active:scale-95 cursor-pointer shadow-md shadow-rose-600/10"
                        title="Seçilenleri Sil"
                    >
                        <Trash2 size={18} />
                    </button>
                </header>
            ) : (
                <header className="eary-chat-safe-header eary-shell border-b eary-line px-4 pb-3">
                    <div className="grid min-h-[56px] grid-cols-[48px_minmax(0,1fr)_88px] items-center gap-2">
                        <div className="flex items-center justify-start">
                            <button
                                type="button"
                                onClick={handleExplicitLeave}
                                onTouchEnd={(event) => {
                                    event.preventDefault();
                                    handleExplicitLeave();
                                }}
                                className="eary-soft eary-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all active:scale-95"
                                title="Geri Dön"
                            >
                                <ArrowLeft size={22} />
                            </button>
                        </div>

                        {/* Interactive Header: Click to view participants */}
                        <div className="min-w-0">
                            <div
                                onClick={() => setIsParticipantsModalOpen(true)}
                                className="eary-row flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-lg px-1 py-1 transition-all"
                                title="Grup Bilgisi ve Katılımcılar"
                            >
	                                {/* Avatar Stack */}
	                                <div className="hidden -space-x-2 overflow-hidden shrink-0 sm:flex">
	                                    {isTestBotRoom && (
	                                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#EBE5F7] text-xs font-extrabold text-[#7B52AB] ring-2 ring-[var(--surface)]">
	                                            E
	                                        </div>
	                                    )}
	                                    {roomMembers.map((member, idx) => {
                                        const initials = member.nickname ? member.nickname.charAt(0).toUpperCase() : '?';
                                        const colors = [
                                            'bg-[#EBE5F7] text-[#7B52AB]',
                                            'bg-emerald-500/10 text-emerald-600',
                                            'bg-amber-500/10 text-amber-600',
                                            'bg-rose-500/10 text-rose-600',
                                            'bg-purple-500/10 text-purple-600',
                                            'bg-pink-500/10 text-pink-600',
                                            'bg-cyan-500/10 text-cyan-600'
                                        ];
                                        const colorClass = colors[(member.nickname?.length || 0) % colors.length];
                                        return (
                                            <div
                                                key={idx}
                                                className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold ring-2 ring-[var(--surface)] ${colorClass}`}
                                            >
                                                {initials}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Titles */}
                                <div className="min-w-0 flex-1">
                                    <h1 className="truncate text-[15px] font-bold leading-5">
                                        <span className="truncate">
                                            {conversationTitle || text.title}
                                        </span>
                                    </h1>
                                    <p className="eary-muted mt-0.5 truncate text-[11px] font-medium leading-4">
                                        {typingText ? (
                                            <span className="text-[#7B52AB] font-bold animate-pulse">{typingText}</span>
                                        ) : (
                                            <>
                                                <span className={conversationStatus.toLocaleLowerCase('tr-TR').includes('çevrimiçi') ? 'text-emerald-600' : ''}>{conversationStatus}</span>
                                                {!isDirectConversation && roomMetadata.name && <><span className="eary-muted mx-1">•</span><span>{roomMetadata.name}</span></>}
                                            </>
                                        )}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={openChatTranslationSettings}
                                className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all active:scale-95 ${autoTranslate ? 'eary-brand-bg' : 'eary-soft eary-muted'}`}
                                title="Mesaj çevirisi"
                                aria-label="Mesaj çevirisi"
                            >
                                <Languages size={18} />
                            </button>
                            {/* Menu/Settings button to open Sidebar */}
                            <button
                                type="button"
                                onClick={() => {
                                    setIsParticipantsModalOpen(true);
                                }}
                                className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg transition-all active:scale-95"
                                title="Menü"
                            >
                                <Menu size={18} />
                            </button>

                        </div>
                    </div>
                </header>
            )}

            {showChatTranslationSettings && (
                <section className="eary-shell border-b eary-line px-3 py-2">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleToggleAutoTranslate}
                            className={`rounded-lg px-3 py-2 text-[11px] font-black ${autoTranslate ? 'eary-brand-bg' : 'eary-soft eary-brand'}`}
                        >
                            {autoTranslate ? 'Çeviri açık' : 'Çeviriyi aç'}
                        </button>
                        <select
                            value={translationTargetLang}
                            onChange={event => setTranslationTargetLang(event.target.value)}
                            disabled={!autoTranslate}
                            className="eary-input min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-45"
                            aria-label="Okuma dili"
                        >
                            <option value="tr-TR">Okuma dilim: Türkçe</option>
                            <option value="de-DE">Okuma dilim: Deutsch</option>
                            <option value="en-US">Okuma dilim: English</option>
                            <option value="es-ES">Okuma dilim: Español</option>
                            <option value="fr-FR">Okuma dilim: Français</option>
                            <option value="it-IT">Okuma dilim: Italiano</option>
                        </select>
                    </div>
                    <p className="eary-muted mt-1 text-[10px] leading-4">Mesajlar karşı tarafa orijinal gider. Çeviri yalnızca gelen mesajları bu ekranda gösterir.</p>
                </section>
            )}

            {/* Conversation Messages */}
            <main
                ref={chatContainerRef}
                onScroll={handleChatScroll}
                onPointerDown={handleChatPointerDown}
                onPointerMove={handleChatPointerMove}
                onPointerUp={stopChatPointerDrag}
                onPointerCancel={stopChatPointerDrag}
                onPointerLeave={stopChatPointerDrag}
                className="eary-soft min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3"
                style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overflowAnchor: 'none' }}
            >
                <div className={`flex min-h-full flex-col justify-end gap-3 ${isChatViewportReady ? 'opacity-100' : 'opacity-0'}`} style={{ overflowAnchor: 'none' }}>
                    {messages.length >= messageLimit && (
                        <div className="flex justify-center pb-1">
                            <button type="button" onClick={() => setMessageLimit(limit => limit + 60)} className="eary-shell eary-muted rounded-full border eary-line px-4 py-1.5 text-[10px] font-semibold shadow-sm">Daha eski mesajları yükle</button>
                        </div>
                    )}
                    {!messagesReady ? (
                        <div className="min-h-full" />
                    ) : messages.length === 0 && !speechDraftBubble ? (
                        <div className="flex min-h-full items-center justify-center p-6 text-center">
                            <p className="text-sm font-light leading-relaxed text-slate-500">
                                {text.noMessages}
                            </p>
                        </div>
                    ) : (
                        <>
                        {messages.filter(msg => !hiddenMessageIds.includes(msg.id)).map((msg) => {
                        const isSelf = msg.senderName === nickname;
                        const isSelected = selectedIds.includes(msg.id);

                        return (
                            <div
                                key={msg.id}
                                onClick={() => isSelectMode && toggleSelectMessage(msg.id)}
                                onPointerDown={(event) => handlePressStart(event, msg)}
                                onPointerMove={handlePressMove}
                                onPointerUp={cancelLongPress}
                                onPointerCancel={cancelLongPress}
                                onPointerLeave={cancelLongPress}
                                onContextMenu={(event) => event.preventDefault()}
                                className={`flex items-start gap-2.5 transition-all duration-150 select-none ${
                                    isSelectMode ? `cursor-pointer hover:bg-slate-900/20 p-1.5 rounded-2xl ${isSelected ? 'bg-[#EBE5F7] ring-2 ring-[#7B52AB]/35' : ''}` : ''
                                }`}
                                style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none', overflowAnchor: 'none' }}
                            >
                                {/* Checkbox inside selection mode */}
                                              <div className={`flex items-center gap-2 w-full ${isSelf ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`flex flex-col max-w-[85%] relative ${isSelf ? 'items-end' : 'items-start'}`}>
                                        {/* Sender tag */}
                                        <span className="text-[10px] text-[#8A7E9F] font-semibold tracking-wider mb-1 px-1">
                                            {msg.senderName}
                                        </span>
                                        {/* Message Bubble */}
                                        <div
                                            data-message-bubble
                                            onClick={(event) => handleMessageClick(event, msg.id)}
                                            className={`px-4 py-3 rounded-2xl text-sm leading-relaxed cursor-pointer relative ${
                                                isSelf
                                                    ? 'eary-outgoing rounded-br-sm border eary-line'
                                                    : 'eary-incoming rounded-bl-sm border eary-line'
                                            }`}
                                        >
                                            {/* Quoted Message inside bubble */}
                                            {msg.forwarded && <span className="mb-1 flex items-center gap-1 text-[9px] font-semibold opacity-60"><Forward size={10} /> İletildi</span>}
                                            {msg.quotedMsg && (
                                                <div className="mb-2 p-1.5 bg-[#FAF8F5]/85 border-l-4 border-[#7B52AB] rounded-r-lg text-[10px] leading-tight select-none">
                                                    <span className="font-extrabold text-[#7B52AB] block">
                                                        {msg.quotedMsg.senderName}
                                                    </span>
                                                    <span className="text-slate-550 line-clamp-2 block font-medium">
                                                        {msg.quotedMsg.text}
                                                    </span>
                                                </div>
                                            )}

                                            {msg.text && (
                                                <p style={{ fontSize: `${chatFontSize}px` }} className="font-medium">
                                                    {!isSelf && autoTranslate && translations[msg.id] && !showOriginalTranslations[msg.id] ? translations[msg.id] : msg.text}
                                                </p>
                                            )}
                                            {msg.editedAt && <span className="mt-1 block text-[9px] italic opacity-60">düzenlendi</span>}
                                            {!isSelf && autoTranslate && translations[msg.id] && (
                                                <button
                                                    type="button"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        setShowOriginalTranslations(current => ({ ...current, [msg.id]: !current[msg.id] }));
                                                    }}
                                                    className="ml-auto mt-1.5 block text-[9px] font-black uppercase text-[#8A7E9F] underline decoration-dotted"
                                                >
                                                    {showOriginalTranslations[msg.id] ? 'Çeviriyi göster' : 'Orijinalini göster'}
                                                </button>
                                            )}

                                            {/* Floating reaction bar */}
                                            {activeReactionMenuId === msg.id && (
                                                <div className={`absolute z-35 -top-11 flex gap-1.5 p-1 bg-white border border-[#DCD0EC]/70 backdrop-blur-md rounded-full shadow-lg animate-scaleUp ${
                                                    isSelf ? 'right-0' : 'left-0'
                                                }`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                                    {['👍', '❤️', '😂', '😮', '🙏'].map(emoji => (
                                                        <button
                                                            key={emoji}
                                                            type="button"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                toggleReaction(msg.id, emoji);
                                                            }}
                                                            className="hover:scale-125 active:scale-95 transition-all text-base p-1 cursor-pointer"
                                                        >
                                                            {emoji}
                                                        </button>
                                                    ))}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setReplyToMsg({ id: msg.id, text: msg.text, senderName: msg.senderName });
                                                            setActiveReactionMenuId(null);
                                                        }}
                                                        className="hover:scale-110 active:scale-95 transition-all text-[10px] px-2 py-0.5 bg-[#FAF8F5] hover:bg-[#EBE5F7] text-[#7B52AB] font-extrabold rounded-full cursor-pointer flex items-center justify-center shrink-0 border border-[#DCD0EC]"
                                                        title="Cevapla"
                                                    >
                                                        💬 Cevapla
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {renderMessageActions(msg, isSelf)}
                                        {renderMessageReactions(msg)}
                                        <div className="flex items-center gap-1 mt-1 px-1 select-none">
                                            <span className="text-[9px] text-slate-650">
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            {isSelf && (
                                                msg.status === 'pending' ? (
                                                    <span className="eary-muted ml-0.5 text-[10px]" title="Gönderiliyor">◷</span>
                                                ) : msg.status === 'read' ? (
                                                    <span className="text-[10px] text-sky-400 font-bold ml-0.5" title="Okundu">✓✓</span>
                                                ) : msg.status === 'delivered' ? (
                                                    <span className="text-[10px] text-slate-400 font-bold ml-0.5" title="Teslim edildi">✓✓</span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-400 font-bold ml-0.5" title="Gönderildi">✓</span>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                        })}
                    </>
                )}
                    {speechDraftBubble}
                    <div ref={messagesEndRef} className="h-px shrink-0" />
                </div>
            </main>

            {showScrollToBottom && (
                <button
                    type="button"
                    onClick={scrollToBottom}
                    className="absolute right-4 bottom-[176px] z-30 flex h-10 w-10 animate-slideIn items-center justify-center rounded-full border border-[#DCD0EC] bg-white text-[#7B52AB] shadow-lg transition-all active:scale-90 cursor-pointer"
                    title="En son mesaja git"
                >
                    <ChevronDown size={22} />
                </button>
            )}

            {/* Bottom Panel - Input & Speech Control */}
            <footer className="eary-shell space-y-2 border-t eary-line px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
                {/* Quoted Message Preview */}
                {editingMessage && (
                    <div className="flex items-center justify-between p-2.5 bg-[#F4F0F8] border-l-4 border-emerald-500 rounded-r-xl text-xs shadow-sm">
                        <span className="font-bold text-[#2D1F47]">Mesaj düzenleniyor</span>
                        <button type="button" onClick={() => { setEditingMessage(null); setManualText(''); }} className="p-1 text-[#8A7E9F] hover:text-[#7B52AB] rounded-full">
                            <X size={14} />
                        </button>
                    </div>
                )}
                {replyToMsg && (
                    <div className="flex items-center justify-between p-2.5 bg-[#FAF8F5] border-l-4 border-[#7B52AB] rounded-r-xl animate-fadeIn text-xs shadow-sm">
                        <div className="truncate">
                            <span className="font-extrabold text-[#7B52AB] block text-[10px]">Cevaplanan: {replyToMsg.senderName}</span>
                            <span className="text-[#8A7E9F] truncate block font-semibold text-[11px]">{replyToMsg.text}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setReplyToMsg(null)}
                            className="p-1 hover:bg-[#EBE5F7] text-[#8A7E9F] hover:text-[#7B52AB] rounded-full transition-all shrink-0 cursor-pointer border-0 bg-transparent"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {FACE_TO_FACE_PHRASES.map(phrase => (
                        <button
                            key={phrase}
                            type="button"
                            onClick={() => sendQuickPhrase(phrase)}
                            className="shrink-0 rounded-full border border-[#DCD0EC] bg-[#FAF8F5] px-3 py-1.5 text-[9px] font-bold text-[#5F4B7A]"
                        >
                            {phrase}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleManualSubmit} className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setShowEmojiPicker(prev => !prev)}
                        className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                            showEmojiPicker ? 'bg-[#EBE5F7] text-[#7B52AB]' : 'text-[#8A7E9F] hover:bg-[#FAF8F5]'
                        }`}
                        title="Emoji"
                    >
                        <Smile size={21} />
                    </button>

                    <div className="relative flex-1 min-w-0">
                        <input
                            ref={manualInputRef}
                            type="text"
                            value={manualText}
                            onChange={(e) => setManualText(e.target.value.slice(0, MAX_CHAT_MESSAGE_CHARS))}
                            maxLength={MAX_CHAT_MESSAGE_CHARS}
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder={text.inputPlaceholder}
                            className="eary-input w-full rounded-full border py-2.5 pl-4 pr-11 text-xs transition-all"
                        />
                        {manualText.trim() && (
                            <button
                                type="button"
                                onTouchStart={handleManualSendPress}
                                onMouseDown={handleManualSendPress}
                                onPointerDown={handleManualSendPress}
                                onClick={handleManualSendPress}
                                className="eary-brand-bg absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full"
                                title="Gönder"
                            >
                                <Send size={16} />
                            </button>
                        )}
                    </div>

                </form>

                {showEmojiPicker && (
                    <div className="flex gap-1 overflow-x-auto py-2 px-1 border-t border-[#EFEAF5]">
                        {[
                            '\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F60A}',
                            '\u{1F60D}', '\u{1F618}', '\u{1F602}', '\u{1F923}', '\u{1F609}',
                            '\u{1F914}', '\u{1F44D}', '\u{1F44F}', '\u{2764}\u{FE0F}', '\u{1F64F}'
                        ].map(emoji => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => appendEmoji(emoji)}
                                className="w-10 h-10 shrink-0 rounded-lg hover:bg-[#F4F0FC] text-xl flex items-center justify-center cursor-pointer"
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}

                {/* Pulsating Microphone Action Box */}
                <div className="eary-soft flex items-center gap-2 rounded-lg px-3 py-2">

                        <button
                            type="button"
                            onClick={toggleListening}
	                            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-300 active:scale-90 ${
	                                isListening
	                                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30'
	                                    : 'eary-brand-bg'
	                            }`}
	                        >
                            {isListening ? (
                                <>
                                    {/* Web Audio API Waveform Visualizer */}
                                    <canvas
                                        ref={visualizerCanvasRef}
                                        width="64"
                                        height="64"
                                        className="absolute inset-0 w-full h-full rounded-full opacity-65 pointer-events-none"
                                    />
                                    <Square size={18} className="relative z-10 fill-white text-white" />
                                </>
                            ) : (
                                <Mic size={24} />
                            )}
                        </button>
                        {isListening && (
                            <button
                                type="button"
                                onClick={cancelSpeechCapture}
                                className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 text-[10px] font-black text-rose-600 shadow-sm active:scale-95"
                                title="Sesli mesajı iptal et"
                            >
                                <X size={15} />
                                İptal
                            </button>
                        )}
	                        <span className={`min-w-0 flex-1 text-[11px] font-semibold flex items-center gap-1.5 ${
	                            isListening ? 'text-rose-500 animate-pulse' : 'eary-muted'
	                        }`}>
	                            {isListening ? (
	                                <>
	                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-ping shrink-0" />
	                                    Dinliyor / Kayıt Ediyor... (Bitirmek İçin Basın)
                                </>
                            ) : (
                                isTestBotRoom ? 'Test sesli mesaj gönder' : 'Başlatmak için dokun'
                            )}
                        </span>
                    </div>
            </footer>

            {/* TV Connection Modal removed */}

            {/* Speech Error Modal */}
            {speechError && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-6">
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-xs shadow-2xl relative animate-scaleUp text-center space-y-4">
                        <div className="flex justify-center text-rose-500">
                            <AlertTriangle size={48} className="animate-bounce" />
                        </div>

                        <h3 className="text-lg font-bold text-slate-200">
                            Speech Recognition Error
                        </h3>

                        <p className="text-xs text-slate-400 leading-relaxed">
                            {`An error occurred: ${speechError}`}
                        </p>

                        <div className="flex flex-col gap-2 pt-2">
                            <button
                                onClick={() => setSpeechError(null)}
                                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-all active:scale-95 cursor-pointer"
                            >
                                Tamam
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Smartwatch / Bluetooth Pairing Modal */}
            {showWatchModal && (
                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-5 w-full max-w-sm shadow-2xl relative animate-scaleUp text-left space-y-4">
                        <button
                            type="button"
                            onClick={() => setShowWatchModal(false)}
                            className="absolute top-3.5 right-3.5 p-1.5 text-slate-400 hover:text-slate-200 rounded-full hover:bg-slate-800 transition-all cursor-pointer"
                        >
                            <X size={16} />
                        </button>

                        <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                            <div className="flex justify-center text-indigo-400 bg-indigo-950/40 w-10 h-10 rounded-xl items-center border border-indigo-900/50">
                                <Watch size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                                    Saat & Arka Plan Ayarları
                                </h3>
                                <p className="text-[10px] text-slate-450 font-medium mt-0.5">
                                    Kesintisiz bildirimler ve saat titreşimi rehberi
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {/* Step 1 */}
                            <div className="p-3 bg-slate-950/40 border border-slate-850 rounded-2xl space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">1. ADIM</span>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (Capacitor.isNativePlatform()) {
                                                try {
                                                    await VoiceSettings.openNotificationSettings();
                                                } catch {
                                                    alert("Bildirim ayarları açılırken hata oluştu.");
                                                }
                                            } else {
                                                alert("Bildirim Ayarları sadece Android uygulaması üzerinden açılabilir. Lütfen Ayarlar -> Uygulamalar -> Eary -> Bildirimler yolunu izleyin.");
                                            }
                                        }}
                                        className="text-[10px] font-bold bg-indigo-650 hover:bg-indigo-500 text-slate-100 px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-sm shadow-indigo-650/10"
                                    >
                                        🔔 Bildirim İzinlerini Aç
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-normal font-medium">
                                    Eary bildirimlerini <strong>"Uyarılı/Sesli"</strong> ve <strong>"Kilit ekranında göster"</strong> olarak etkinleştirin.
                                </p>
                            </div>

                            {/* Step 2 */}
                            <div className="p-3 bg-slate-950/40 border border-slate-850 rounded-2xl space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">2. ADIM</span>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (Capacitor.isNativePlatform()) {
                                                try {
                                                    await VoiceSettings.openBatterySettings();
                                                } catch {
                                                    alert("Pil ayarları açılırken hata oluştu.");
                                                }
                                            } else {
                                                alert("Pil Ayarları sadece Android uygulaması üzerinden açılabilir. Lütfen Ayarlar -> Uygulamalar -> Eary -> Pil bölümünden 'Sınırsız' yapın.");
                                            }
                                        }}
                                        className="text-[10px] font-bold bg-amber-650 hover:bg-amber-500 text-slate-100 px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-sm shadow-amber-650/10"
                                    >
                                        🔋 Pil Tasarrufunu Kapat
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-normal font-medium">
                                    Uygulamayı pil tasarrufundan muaf <strong>(Sınırsız / Kısıtlamasız)</strong> yapın. Bu, ekran kapalıyken uygulamanın uykuya dalmasını engeller.
                                </p>
                            </div>

                            {/* Step 3 */}
                            <div className="p-3 bg-slate-950/40 border border-slate-850 rounded-2xl space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">3. ADIM</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            triggerTestNotification();
                                            if ('vibrate' in navigator) {
                                                navigator.vibrate([0, 400, 150, 400, 150, 400]);
                                            }
                                        }}
                                        className="text-[10px] font-bold bg-emerald-650 hover:bg-emerald-500 text-slate-950 px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-sm shadow-emerald-650/10"
                                    >
                                        📳 Titreşim Testi Gönder
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-normal font-medium">
                                    Bağlantıyı doğrulamak için **ekran kilidini kapatıp** bu teste basarak saatinizin titreşmesini bekleyin.
                                </p>
                            </div>

                            {/* Step 4 */}
                            <div className="p-3 bg-slate-950/40 border border-slate-850 rounded-2xl space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">SORUN GİDERME</span>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (Capacitor.isNativePlatform()) {
                                                try {
                                                    await VoiceSettings.openBluetoothSettings();
                                                } catch {
                                                    alert("Bluetooth ayarları açılamadı.");
                                                }
                                            } else {
                                                alert("Bluetooth ayarları sadece Android üzerinden açılabilir.");
                                            }
                                        }}
                                        className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-350 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                                    >
                                        🔗 Bluetooth Ayarları
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-normal font-medium">
                                    Saat bağlantınız koptuysa, Bluetooth ayarlarına giderek saatinizi telefonunuza tekrar bağlayın.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isParticipantsModalOpen && (
                <ConversationInfo
                    roomId={roomId}
                    members={roomMembers}
                    messages={messages}
                    nickname={nickname}
                    displayTitle={conversationTitle}
                    directConversation={isDirectConversation}
                    onClose={() => setIsParticipantsModalOpen(false)}
                    chatTheme={chatTheme}
                    setChatTheme={setChatTheme}
                    onClearChat={clearChatForMe}
                />
            )}
            {forwardingMessage && (
                <div className="fixed inset-0 z-[110] flex items-end bg-black/35" onClick={() => setForwardingMessage(null)}>
                    <div className="eary-shell max-h-[70vh] w-full rounded-t-xl p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="mb-4 flex items-center justify-between"><div><h3 className="font-bold">Mesajı ilet</h3><p className="eary-muted text-[11px]">Bir sohbet seçin</p></div><button type="button" onClick={() => setForwardingMessage(null)} className="eary-soft eary-muted flex h-9 w-9 items-center justify-center rounded-lg"><X size={18} /></button></div>
                        <div className="max-h-72 overflow-y-auto border-y eary-line">
                            {(JSON.parse(localStorage.getItem('duotalk_history') || '[]')).filter(item => item.roomId !== roomId).map(item => (
                                <button key={item.roomId} type="button" onClick={() => forwardToRoom(item.roomId)} className="eary-row flex w-full items-center gap-3 border-b eary-line px-2 py-3 text-left last:border-b-0"><span className="eary-brand-soft flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold">{item.roomId.slice(0, 2).toUpperCase()}</span><span className="text-sm font-semibold capitalize">{item.roomId}</span></button>
                            ))}
                        </div>
                        <button type="button" onClick={shareExternally} className="eary-soft eary-brand mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold"><Share2 size={17} /> Başka uygulamayla paylaş</button>
                    </div>
                </div>
            )}
            {deletingMessage && (
                <div className="fixed inset-0 z-[115] flex items-end bg-black/35" onClick={() => setDeletingMessage(null)}>
                    <div className="eary-shell w-full rounded-t-xl p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold">Mesajı sil</h3>
                        <p className="eary-muted mb-4 mt-1 text-xs">Bu işlem için bir seçenek belirleyin.</p>
                        {deletingMessage.senderName === nickname && <button type="button" onClick={deleteMessageForEveryone} className="flex w-full items-center gap-3 border-b eary-line px-2 py-3 text-sm font-semibold text-rose-600"><Trash2 size={18} /> Herkesten sil</button>}
                        <button type="button" onClick={deleteMessageForMe} className="flex w-full items-center gap-3 px-2 py-3 text-sm font-semibold text-rose-600"><Trash2 size={18} /> Benden sil</button>
                        <button type="button" onClick={() => setDeletingMessage(null)} className="eary-soft mt-3 w-full rounded-lg py-3 text-sm font-semibold">Vazgeç</button>
                    </div>
                </div>
            )}
            {toast && <div className="fixed bottom-24 left-1/2 z-[130] -translate-x-1/2 rounded-full bg-[#17221f] px-4 py-2 text-xs font-semibold text-white shadow-xl">{toast}</div>}
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                language={language}
                account={account}
                onLogout={handleLogout}
                onAuthClick={() => {
                    handleExplicitLeave();
                }}
                history={history}
                onSelectRoom={(item) => {
                    window.location.search = `?roomId=${encodeURIComponent(item.roomId)}&pin=${encodeURIComponent(item.roomPin)}&role=${item.role || 'intercom'}&lang=tr-TR`;
                }}
                onRemoveRoom={(e, targetRoomId) => {
                    e.stopPropagation();
                    const updatedHistory = history.filter(h => h.roomId !== targetRoomId);
                    setHistory(updatedHistory);
                    localStorage.setItem('duotalk_history', JSON.stringify(updatedHistory));
                    if (account) {
                        remove(ref(db, `users/${account.username}/history/${targetRoomId}`)).catch(e => console.error(e));
                    }
                }}
                alwaysNotify={alwaysNotify}
                onToggleAlwaysNotify={handleToggleAlwaysNotify}
                roomData={roomData}
                onUpdateAccount={handleUpdateAccount}
                onDeleteAccount={handleDeleteAccount}
                initialSection={sidebarSection}
                speechLang={speechLang}
                setSpeechLang={setSpeechLang}
                translationTargetLang={translationTargetLang}
                setTranslationTargetLang={setTranslationTargetLang}
                autoTranslate={autoTranslate}
                onToggleAutoTranslate={handleToggleAutoTranslate}
                splitScreenEnabled={splitScreenEnabled}
                onToggleSplitScreen={handleToggleSplitScreen}
                chatFontSize={chatFontSize}
                setChatFontSize={setChatFontSize}
                theme={theme}
                onToggleTheme={onToggleTheme}
                onlineVisibility={onlineVisibility}
                setOnlineVisibility={setOnlineVisibility}
            />
        </div>
    );
}
