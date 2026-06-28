import { useState, useEffect } from 'react';
import { History, MessageSquare, Shield, User, Lock, Key, Trash2, Menu } from 'lucide-react';
import {
    db, auth, ref, set, get, getRest, updateRest, remove, onValue, update, query, limitToLast,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
    signInWithPhoneNumber, RecaptchaVerifier
} from '../firebase';
import Sidebar from './Sidebar';
import ChatHome from './ChatHome';
import { normalizeAppLanguage } from '../utils/language';
import { sha256Hex } from '../utils/hash';
import { phoneLookupKey } from '../utils/identity';
import { registerUserPushNotifications } from '../utils/pushNotifications';

const TRANSLATIONS = {
    'tr-TR': {
        title: 'Eary',
        subtitle: 'İşitme Engelliler İçin Konuşma-Metin İnterkomu',
        roomId: 'Oda Numarası',
        roomPin: 'Oda PIN / Şifresi',
        nickname: 'Adınız / Takma Ad',
        role: 'Cihaz Kullanım Amacı',
        roleIntercom: 'Karşılıklı konuşma, mesajlaşma ve buton kontrollü ses gönderme.',
        roleDisplay: 'Smart TV / Tablet gibi sadece okuma amaçlı büyük ekranlar.',
        history: 'Giriş Geçmişi',
        submit: 'Odaya Bağlan',
        errorFill: 'Lütfen tüm alanları doldurun.',
        errorSelectRoomType: 'Lütfen oda iletişim türünü (amacını) seçin.',
        placeholderRoom: 'Örn: salon-tv veya 12345',
        placeholderPin: 'Oda güvenlik şifresi',
        placeholderNickname: 'Örn: Ahmet veya Ayşe',
        noHistory: 'Kayıtlı geçmiş oda bulunmuyor.',
        offlineHelpTitle: 'Çevrimdışı Dil Paketleri (Android)',
        offlineHelpText: 'Sorunsuz ve pop-upsız ses kaydı için telefonunuza çevrimdışı dil paketi yüklemeniz önerilir.',
        offlineHelpBtn: 'Ses Ayarlarını Aç',
        offlineHelpGuide: 'Açılan sayfada "Çevrimdışı ses tanıma" -> "Tümü" kısmından seçtiğiniz dili indirin.',
        authLogin: 'Giriş Yap',
        authRegister: 'Kayıt Ol',
        authUsername: 'Kullanıcı Adı',
        authPassword: 'Şifre',
        authNickname: 'Adınız / Takma Ad',
        authBtnLogin: 'Giriş Yap',
        authBtnRegister: 'Kayıt Ol',
        authOr: 'veya',
        authBack: 'Giriş Yapmadan Devam Et',
        authErrExists: 'Bu kullanıcı adı zaten alınmış.',
        authErrNotFound: 'Kullanıcı bulunamadı.',
        authErrWrongPass: 'Hatalı şifre.',
        authSuccessLogin: 'Giriş başarılı!',
        authSuccessRegister: 'Kayıt başarılı! Giriş yapıldı.',
        authLogout: 'Çıkış Yap',
        authCloudSync: 'Bulut Geçmişi',
        tabJoin: 'Odaya Katıl',
        tabCreate: 'Yeni Oda Oluştur',
        recentRooms: 'Son Konuşulan Odalar',
        recentRoomsSubtitle: 'Bağlanmak istediğiniz odaya dokunarak anında katılabilirsiniz.',
        addNewRoom: '➕ Yeni Odaya Katıl veya Oluştur',
        backToRooms: '⬅️ Kayıtlı Odaları Göster',
        roomType: 'Oda İletişim Türü',
        typeIntercomOnly: '💬 Karşılıklı Konuşma Odası',
        typeIntercomOnlyDesc: 'İki kişi arasında doğrudan sesli ve yazılı sohbet. Ekstra mikrofon veya ekran yansıtma gerektirmez.',
    }
};


export default function RoomSetup({ onJoin, language, onLanguageChange, theme, onToggleTheme, onlineVisibility, setOnlineVisibility }) {
    const [roomId, setRoomId] = useState('');
    const [roomPin, setRoomPin] = useState('');
    const [nickname, setNickname] = useState('');
    const [role, setRole] = useState('intercom');
    const [roomType, setRoomType] = useState('intercom_only')
    const [actionTab, setActionTab] = useState('join'); // 'join' or 'create'
    const [history, setHistory] = useState([]);
    const [error, setError] = useState('');
    const [authBusy, setAuthBusy] = useState(false);
    const [showNewRoomForm, setShowNewRoomForm] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [alwaysNotify, setAlwaysNotify] = useState(() => localStorage.getItem('eary_always_notify') !== 'false');
    const [autoTranslate, setAutoTranslate] = useState(() => localStorage.getItem('eary_auto_translate') === 'true');
    const [splitScreenEnabled, setSplitScreenEnabled] = useState(() => localStorage.getItem('eary_split_screen') === 'true');
    const [speechLang, setSpeechLangState] = useState(() => localStorage.getItem('eary_speech_lang') || normalizeAppLanguage(language));
    const [translationTargetLang, setTranslationTargetLang] = useState(() => localStorage.getItem('eary_translation_target_lang') || 'tr-TR');
    const [chatFontSize, setChatFontSize] = useState(() => Number(localStorage.getItem('eary_chat_font_size')) || 16);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'active', 'past'
    const [lastMessages, setLastMessages] = useState({});
    const [presenceData, setPresenceData] = useState({});
    const [presenceTick, setPresenceTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setPresenceTick(value => value + 1), 15000);
        return () => clearInterval(timer);
    }, []);

    const setSpeechLang = nextLanguage => {
        const normalized = normalizeAppLanguage(nextLanguage);
        setSpeechLangState(normalized);
        localStorage.setItem('eary_speech_lang', normalized);
        onLanguageChange?.(normalized);
    };

    useEffect(() => {
        const unsubs = [];
        let active = true;
        history.forEach(item => {
            const rId = item.roomId;
            
            // 1. Listen to last message
            const messagesRef = ref(db, `rooms/${rId}/messages`);
            const lastMsgQuery = query(messagesRef, limitToLast(1));
            const unsubMsg = onValue(lastMsgQuery, (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    const keys = Object.keys(data);
                    if (keys.length > 0) {
                        setLastMessages(prev => ({
                            ...prev,
                            [rId]: data[keys[0]]
                        }));
                    }
                } else {
                    setLastMessages(prev => ({
                        ...prev,
                        [rId]: null
                    }));
                }
            });
            unsubs.push(unsubMsg);

            // 2. Listen to active room presence
            const presenceRef = ref(db, `rooms/${rId}/presence`);
            const unsubPresence = onValue(presenceRef, (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    const freshThreshold = Date.now() - 45000;
                    const membersList = Object.values(data).filter(member => member.active && Number(member.lastActive || 0) >= freshThreshold);
                    const count = new Set(membersList.map(member => member.nickname)).size;
                    setPresenceData(prev => ({
                        ...prev,
                        [rId]: { count }
                    }));
                } else {
                    setPresenceData(prev => ({
                        ...prev,
                        [rId]: { count: 0 }
                    }));
                }
            });
            unsubs.push(unsubPresence);
        });

        const refreshLastMessages = async () => {
            const results = await Promise.all(history.map(async item => {
                if (item.isTestBot || item.roomId === 'local-test-bot') {
                    try {
                        const saved = JSON.parse(localStorage.getItem(`eary_test_bot_messages_${item.roomId}`) || '[]');
                        const latest = saved.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0] || null;
                        return [item.roomId, latest];
                    } catch {
                        return [item.roomId, null];
                    }
                }
                try {
                    const data = await getRest(`rooms/${item.roomId}/messages`, { timeoutMs: 5000 });
                    const messages = Object.values(data || {});
                    const latest = messages.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0] || null;
                    return [item.roomId, latest];
                } catch {
                    return null;
                }
            }));
            if (!active) return;
            setLastMessages(previous => {
                const next = { ...previous };
                results.forEach(result => {
                    if (result) next[result[0]] = result[1];
                });
                return next;
            });
        };
        refreshLastMessages();
        const restTimer = setInterval(refreshLastMessages, 1500);
        return () => {
            active = false;
            clearInterval(restTimer);
            unsubs.forEach(unsub => unsub());
        };
    }, [history, presenceTick]);

    useEffect(() => {
        localStorage.setItem('eary_always_notify', String(alwaysNotify));
    }, [alwaysNotify]);

    useEffect(() => {
        localStorage.setItem('eary_auto_translate', String(autoTranslate));
    }, [autoTranslate]);

    useEffect(() => {
        localStorage.setItem('eary_translation_target_lang', translationTargetLang);
    }, [translationTargetLang]);

    useEffect(() => {
        localStorage.setItem('eary_split_screen', String(splitScreenEnabled));
    }, [splitScreenEnabled]);

    useEffect(() => {
        localStorage.setItem('eary_chat_font_size', String(chatFontSize));
    }, [chatFontSize]);

    const handleToggleAlwaysNotify = () => setAlwaysNotify(prev => !prev);
    const handleToggleAutoTranslate = () => setAutoTranslate(prev => !prev);
    const handleToggleSplitScreen = () => setSplitScreenEnabled(prev => !prev);

    // User Account & Authentication States
    const [account, setAccount] = useState(null); // { username, nickname }
    const [authMode, setAuthMode] = useState('room'); // 'room' (main UI), 'login' (sign in form), 'register' (sign up form)
    const [authUsername, setAuthUsername] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const [authNickname, setAuthNickname] = useState('');
    const [authMethod, setAuthMethod] = useState('legacy');
    const [authContact, setAuthContact] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [phoneConfirmation, setPhoneConfirmation] = useState(null);
    const [pendingPhoneProfile, setPendingPhoneProfile] = useState(null);

    useEffect(() => {
        if (!account?.username) return undefined;
        let cleanup = () => {};
        registerUserPushNotifications({ username: account.username, nickname: account.nickname })
            .then(unregister => { cleanup = unregister; })
            .catch(error => console.error('Push notification setup failed:', error));
        return () => cleanup();
    }, [account?.username, account?.nickname]);

    // Keep accepted direct chats and group invitations in sync across devices.
    useEffect(() => {
        if (!account?.username) return undefined;
        const applyCloudHistory = value => {
            const cloudItems = Object.values(value || {});
            if (!cloudItems.length) return;
            setHistory(current => {
                const merged = new Map(current.map(item => [item.roomId, item]));
                cloudItems.forEach(item => merged.set(item.roomId, item));
                const next = [...merged.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 100);
                localStorage.setItem('duotalk_history', JSON.stringify(next));
                return next;
            });
        };
        const historyRef = ref(db, `users/${account.username}/history`);
        const unsubscribe = onValue(historyRef, snapshot => applyCloudHistory(snapshot.val()));
        const refresh = async () => {
            try {
                const restValue = await getRest(`users/${account.username}/history`);
                applyCloudHistory(restValue);
            } catch (refreshError) {
                console.error('Cloud history refresh failed:', refreshError);
            }
        };
        refresh();
        const interval = setInterval(refresh, 5000);
        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, [account?.username]);

    useEffect(() => {
        const applyExternalHistory = event => setHistory(event.detail || []);
        window.addEventListener('eary:history-updated', applyExternalHistory);
        return () => window.removeEventListener('eary:history-updated', applyExternalHistory);
    }, []);

    const langKey = 'tr-TR';
    const text = TRANSLATIONS[langKey];

    const defaultPrivacy = {
        discoverByUsername: 'everyone',
        discoverByPhone: 'nobody',
        profilePhoto: 'contacts',
        onlineStatus: 'contacts',
        lastSeen: 'contacts',
        groupInvites: 'contacts',
        messageRequests: 'everyone',
        readReceipts: true
    };

    const createAccountSession = (username, profile) => {
        const acc = {
            username,
            nickname: profile.nickname,
            profile: {
                photo: profile.photo || '', bio: profile.bio || '',
                preference: profile.preference || 'all', languages: profile.languages || ['TR'],
                interests: profile.interests || [], privacy: { ...defaultPrivacy, ...(profile.privacy || {}) },
                contactMethod: profile.contactMethod || 'legacy', contactHint: profile.contactHint || '',
                contactVerified: Boolean(profile.contactVerified)
            }
        };
        setAccount(acc);
        setNickname(profile.nickname);
        setAuthMode('room');
        localStorage.setItem('duotalk_account', JSON.stringify(acc));
        update(ref(db, `publicProfiles/${username}`), {
            username,
            nickname: profile.nickname,
            photo: acc.profile.privacy.profilePhoto === 'everyone' ? (profile.photo || '') : '',
            bio: profile.bio || '',
            discoverable: acc.profile.privacy.discoverByUsername !== 'nobody'
        }).catch(error => console.error('Public profile sync error:', error));
        const savedHistory = localStorage.getItem('duotalk_history');
        syncCloudHistory(username, savedHistory ? JSON.parse(savedHistory) : []);
        return acc;
    };

    useEffect(() => {
        const handleBack = event => {
            if (!isSidebarOpen) return;
            event.preventDefault();
            setIsSidebarOpen(false);
        };
        window.addEventListener('eary:back', handleBack);
        return () => window.removeEventListener('eary:back', handleBack);
    }, [isSidebarOpen]);

    // Synchronize cloud history on mount or account login
    const syncCloudHistory = async (username, localHistory) => {
        try {
            const restValue = await getRest(`users/${username}/history`).catch(() => null);
            const cloudVal = restValue || (await get(ref(db, `users/${username}/history`))).val();
            if (cloudVal) {
                const cloudList = Object.values(cloudVal);
                // Merge cloud and local, sort by timestamp
                const mergedMap = new Map();
                // Add local first
                localHistory.forEach(item => mergedMap.set(item.roomId, item));
                // Add cloud, cloud overrides because it's the source of truth
                cloudList.forEach(item => mergedMap.set(item.roomId, item));
                
                const mergedList = Array.from(mergedMap.values())
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 8); // Keep last 8

                setHistory(mergedList);
                localStorage.setItem('duotalk_history', JSON.stringify(mergedList));
                if (mergedList.length > 0) {
                    setShowNewRoomForm(false);
                } else {
                    setShowNewRoomForm(false);
                }
            }
        } catch (e) {
            console.error("Cloud history sync error:", e);
        }
    };

    // Load room history on mount
    useEffect(() => {
        const invitedUsername = new URLSearchParams(window.location.search).get('invite');
        // Load local history
        const savedHistory = localStorage.getItem('duotalk_history');
        let localHistory = [];
        if (savedHistory) {
            try {
                localHistory = JSON.parse(savedHistory);
                setHistory(localHistory);
                if (localHistory.length > 0) {
                    setShowNewRoomForm(false);
                } else {
                    setShowNewRoomForm(false);
                }
            } catch (e) {
                console.error(e);
                setShowNewRoomForm(false);
            }
        } else {
            setShowNewRoomForm(false);
        }

        // Load account
        const savedAccount = localStorage.getItem('duotalk_account');
        if (savedAccount) {
            try {
                const acc = JSON.parse(savedAccount);
                setAccount(acc);
                setNickname(acc.nickname);
                
                // Fetch cloud history for this user
                syncCloudHistory(acc.username, localHistory);
            } catch (e) {
                console.error(e);
            }
        } else {
            // Guest nickname fallback
            const savedNickname = localStorage.getItem('duotalk_nickname');
            if (savedNickname) {
                setNickname(savedNickname);
            }
            setAuthMode('room');
        }
        if (invitedUsername) {
            setSearchQuery(`@${invitedUsername}`);
            setShowNewRoomForm(false);
        }
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!roomId.trim() || !roomPin.trim() || !nickname.trim()) {
            setError(text.errorFill);
            return;
        }

        const cleanRoomId = roomId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
        if (!cleanRoomId) {
            setError("Lütfen geçerli bir oda adı girin (harf, rakam, - ve _).");
            return;
        }
        const cleanPin = roomPin.trim();
        const cleanNickname = nickname.trim();

        try {
            // Check Firebase if joining or creating
            const roomRef = ref(db, `rooms/${cleanRoomId}`);
            const roomSnapshot = await get(roomRef);
            
            let detectedRoomType = roomType;

            if (actionTab === 'create') {
                if (roomSnapshot.exists()) {
                    setError("Bu oda adı zaten alınmış. Lütfen başka bir oda adı seçin ya da odaya katılmayı deneyin.");
                    return;
                }
                // Save PIN and Room Type under room
                await set(ref(db, `rooms/${cleanRoomId}/pin`), cleanPin);
                await set(ref(db, `rooms/${cleanRoomId}/type`), roomType);
            } else { // 'join'
                if (!roomSnapshot.exists()) {
                    setError("Oda bulunamadı. Lütfen oda ismini kontrol edin veya yeni bir oda oluşturun.");
                    return;
                }
                const dbPin = roomSnapshot.child('pin').val();
                if (dbPin && dbPin !== cleanPin) {
                    setError("Hatalı Oda PIN'i. Lütfen şifrenizi kontrol edin.");
                    return;
                }
                // Read type from Firebase
                const dbType = roomSnapshot.child('type').val();
                if (dbType) {
                    detectedRoomType = dbType;
                }
            }

            // Save nickname locally
            localStorage.setItem('duotalk_nickname', cleanNickname);

            const newHistoryItem = {
                roomId: cleanRoomId,
                roomPin: cleanPin,
                nickname: cleanNickname,
                role: role,
                roomType: detectedRoomType,
                timestamp: Date.now()
            };

            const updatedHistory = [
                newHistoryItem,
                ...history.filter(item => item.roomId !== cleanRoomId)
            ].slice(0, 100);

            setHistory(updatedHistory);
            localStorage.setItem('duotalk_history', JSON.stringify(updatedHistory));

            // Save to cloud history if logged in
            if (account) {
                set(ref(db, `users/${account.username}/history/${cleanRoomId}`), newHistoryItem)
                    .catch(e => console.error("Cloud history write error:", e));
            }

            onJoin({
                roomId: cleanRoomId,
                roomPin: cleanPin,
                nickname: cleanNickname,
                role: role,
                roomType: detectedRoomType
            });
        } catch (err) {
            setError("Bağlantı Hatası: " + err.message);
        }
    };

    const handleSelectHistory = async (item) => {
        setError('');
        if (item.isTestBot) {
            const existingBot = history.find(historyItem => historyItem.roomId === (item.roomId || 'local-test-bot'));
            const botHistoryItem = {
                ...item,
                roomId: item.roomId || 'local-test-bot',
                roomPin: '',
                nickname: account?.nickname || nickname || 'Ben',
                role: 'intercom',
                roomType: 'intercom_only',
                kind: 'direct',
                title: 'Eary Test Bot',
                peerUsername: 'eary-test-bot',
                isTestBot: true,
                timestamp: item.timestamp || existingBot?.timestamp || Date.now()
            };
            const updatedHistory = [
                botHistoryItem,
                ...history.filter(h => h.roomId !== botHistoryItem.roomId)
            ].slice(0, 100);
            setHistory(updatedHistory);
            localStorage.setItem('duotalk_history', JSON.stringify(updatedHistory));
            onJoin(botHistoryItem);
            return;
        }
        try {
            const cleanRoomId = item.roomId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
            const roomData = await getRest(`rooms/${cleanRoomId}`);
            
            const pinToUse = item.roomPin || '';
            let detectedRoomType = item.roomType || 'intercom_only';

            if (!roomData) {
                // If the room doesn't exist on Firebase anymore, automatically recreate it using the saved PIN & Type
                await updateRest({
                    [`rooms/${cleanRoomId}/pin`]: pinToUse,
                    [`rooms/${cleanRoomId}/type`]: detectedRoomType
                });
            } else {
                const protectedKind = roomData.metadata?.kind;
                if ((protectedKind === 'direct' || protectedKind === 'group') && (!account?.username || !roomData.members?.[account.username])) {
                    setError('Bu sohbet yalnızca davet edilen üyelere açıktır.');
                    return;
                }
                const dbPin = roomData.pin;
                if (dbPin && dbPin !== pinToUse) {
                    setError("Oda şifresi değişmiş. Lütfen yeni şifreyle tekrar bağlanın.");
                    setRoomId(item.roomId);
                    setRoomPin('');
                    setNickname(item.nickname || nickname);
                    setRole(item.role || 'intercom');
                    setRoomType(item.roomType || 'intercom_only');
                    setShowNewRoomForm(true);
                    return;
                }
                const dbType = roomData.type;
                if (dbType) {
                    detectedRoomType = dbType;
                }
            }

            const activeNickname = account ? account.nickname : (item.nickname || nickname || 'Guest');

            const newHistoryItem = {
                ...item,
                roomId: cleanRoomId,
                roomPin: pinToUse,
                nickname: activeNickname,
                role: item.role || 'intercom',
                roomType: detectedRoomType,
                timestamp: item.timestamp || item.createdAt || Date.now()
            };

            const updatedHistory = [
                newHistoryItem,
                ...history.filter(h => h.roomId !== cleanRoomId)
            ].slice(0, 100);

            setHistory(updatedHistory);
            localStorage.setItem('duotalk_history', JSON.stringify(updatedHistory));

            if (account) {
                updateRest({ [`users/${account.username}/history/${cleanRoomId}`]: newHistoryItem })
                    .catch(e => console.error("Cloud history write error:", e));
            }

            onJoin({
                roomId: cleanRoomId,
                roomPin: pinToUse,
                nickname: activeNickname,
                role: item.role || 'intercom',
                roomType: detectedRoomType
            });
        } catch (err) {
            setError("Bağlantı Hatası: " + err.message);
        }
    };

    const handleAcceptedRequest = (item, showAcceptedNotice = true) => {
        const acceptedChat = {
            ...item,
            nickname: account?.nickname || item.nickname || nickname || 'Ben',
            timestamp: Date.now()
        };
        const updatedHistory = [
            acceptedChat,
            ...history.filter(historyItem => historyItem.roomId !== acceptedChat.roomId)
        ].slice(0, 100);
        setHistory(updatedHistory);
        localStorage.setItem('duotalk_history', JSON.stringify(updatedHistory));
        onJoin(acceptedChat);
        if (showAcceptedNotice) window.dispatchEvent(new CustomEvent('eary:toast', { detail: 'İsteği kabul ettiniz' }));
    };

    const handleRemoveHistoryItem = async (e, targetRoomId) => {
        e.stopPropagation(); // Prevent selecting the item
        
        const updatedHistory = history.filter(item => item.roomId !== targetRoomId);
        setHistory(updatedHistory);
        localStorage.setItem('duotalk_history', JSON.stringify(updatedHistory));
        
        if (updatedHistory.length === 0) setShowNewRoomForm(false);

        if (account) {
            try {
                await remove(ref(db, `users/${account.username}/history/${targetRoomId}`));
            } catch (e) {
                console.error("Cloud history delete error:", e);
            }
        }
    };

    const hashPassword = async (username, password) => {
        return sha256Hex(`eary:${username}:${password}`);
    };

    const createPhoneVerifier = () => {
        window.earyRecaptchaVerifier?.clear?.();
        window.earyRecaptchaVerifier = new RecaptchaVerifier(auth, 'eary-recaptcha', { size: 'invisible' });
        return window.earyRecaptchaVerifier;
    };

    const syncPhoneDiscovery = async updatedAccount => {
        const phone = auth.currentUser?.phoneNumber;
        if (!phone) return;
        const key = await phoneLookupKey(phone);
        if (updatedAccount.profile?.privacy?.discoverByPhone === 'contacts') {
            await set(ref(db, `phoneDirectory/${key}`), { username: updatedAccount.username });
        } else {
            await remove(ref(db, `phoneDirectory/${key}`));
        }
    };

    const authErrorMessage = error => ({
        'auth/invalid-credential': 'E-posta veya şifre doğru değil.',
        'auth/email-already-in-use': 'Bu e-posta ile daha önce hesap oluşturulmuş.',
        'auth/invalid-email': 'Geçerli bir e-posta adresi girin.',
        'auth/weak-password': 'Daha güçlü bir şifre seçin. Şifre en az 6 karakter olmalıdır.',
        'auth/invalid-phone-number': 'Telefon numarasını ülke koduyla girin. Örnek: +43 660…',
        'auth/too-many-requests': 'Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.',
        'auth/operation-not-allowed': 'Bu doğrulama yöntemi henüz Firebase panelinde etkin değil.',
        'auth/configuration-not-found': 'Hesap sistemi henüz etkinleştirilmemiş. Firebase Authentication ayarlarında E-posta/Şifre yöntemini açın.',
        'auth/unauthorized-domain': 'Bu adres Firebase doğrulaması için yetkilendirilmemiş.'
    }[error.code] || error.message || 'Hesap işlemi tamamlanamadı.');

    const withAuthTimeout = (promise, timeoutMs = 12000) => {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Bağlantı zaman aşımına uğradı. İnternet/Firebase bağlantısını kontrol edip tekrar deneyin.')), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
    };

    const readUserProfile = async username => {
        const restProfile = await getRest(`users/${username}/profile`, { timeoutMs: 6000 }).catch(() => null);
        if (restProfile) return restProfile;
        const snapshot = await withAuthTimeout(get(ref(db, `users/${username}/profile`)), 6000);
        return snapshot.val();
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        if (authBusy) return;
        setAuthBusy(true);
        setError('');

        const activeAuthMethod = authUsername.includes('@') ? 'email' : 'legacy';
        if (!authUsername.trim() || (activeAuthMethod !== 'phone' && !authPassword.trim())) {
            setError(text.errorFill);
            setAuthBusy(false);
            return;
        }

        try {
            if (activeAuthMethod === 'email') {
                const credential = await withAuthTimeout(signInWithEmailAndPassword(auth, authUsername.trim(), authPassword));
                const indexSnapshot = await withAuthTimeout(get(ref(db, `authUsers/${credential.user.uid}`)));
                const username = indexSnapshot.val()?.username;
                if (!username) throw new Error('Bu doğrulanmış hesaba bağlı kullanıcı adı bulunamadı.');
                const profile = (await withAuthTimeout(get(ref(db, `users/${username}/profile`)))).val();
                profile.contactVerified = credential.user.emailVerified;
                await withAuthTimeout(update(ref(db, `users/${username}/profile`), { contactVerified: credential.user.emailVerified }));
                createAccountSession(username, profile);
                setAuthUsername(''); setAuthPassword('');
                return;
            }

            if (activeAuthMethod === 'phone') {
                const confirmation = await signInWithPhoneNumber(auth, authUsername.trim(), createPhoneVerifier());
                setPhoneConfirmation(confirmation);
                setPendingPhoneProfile({ type: 'login' });
                setAuthMode('verify');
                return;
            }

            const usernameClean = authUsername.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            const profile = await readUserProfile(usernameClean);

            if (!profile) {
                setError(text.authErrNotFound);
                return;
            }

            const passwordHash = await withAuthTimeout(hashPassword(usernameClean, authPassword), 4000);
            const passwordMatches = profile.passwordHash === passwordHash || profile.password === authPassword;
            if (!passwordMatches) {
                setError(text.authErrWrongPass);
                return;
            }

            if (!profile.passwordHash) {
                await withAuthTimeout(update(ref(db, `users/${usernameClean}/profile`), { passwordHash, password: null }));
            }

            createAccountSession(usernameClean, profile);
            setAuthUsername('');
            setAuthPassword('');
        } catch (e) {
            setError(authErrorMessage(e));
        } finally {
            setAuthBusy(false);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (authBusy) return;
        setAuthBusy(true);
        setError('Kayıt oluşturuluyor...');

        const email = authContact.trim();
        const activeAuthMethod = email ? 'email' : 'legacy';
        if (!authUsername.trim() || !authNickname.trim() || !authPassword.trim()) {
            setError(text.errorFill);
            setAuthBusy(false);
            return;
        }

        const usernameClean = authUsername.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (usernameClean.length < 3) {
            setError('Kullanıcı adı en az 3 harf veya rakam içermelidir.');
            setAuthBusy(false);
            return;
        }
        if (authPassword.length < 6) {
            setError('Şifre en az 6 karakter olmalıdır.');
            setAuthBusy(false);
            return;
        }
        if (email && !email.includes('@')) {
            setError('E-posta adresi geçerli görünmüyor. İstersen boş bırakıp sadece kullanıcı adıyla kayıt olabilirsin.');
            setAuthBusy(false);
            return;
        }

        const passwordHash = await hashPassword(usernameClean, authPassword);
        const baseProfile = {
            nickname: authNickname.trim(),
            photo: '',
            bio: '',
            preference: 'all',
            languages: ['TR'],
            interests: [],
            privacy: defaultPrivacy,
            contactMethod: activeAuthMethod,
            contactHint: email ? email.replace(/(^.).*(@.*$)/, '$1***$2') : '',
            contactVerified: false,
            passwordHash,
            createdAt: Date.now()
        };

        try {
            const checkSnapshot = await withAuthTimeout(get(ref(db, `users/${usernameClean}/profile`)));
            if (checkSnapshot.exists()) {
                setError(text.authErrExists);
                return;
            }

            if (email) {
                const credential = await withAuthTimeout(createUserWithEmailAndPassword(auth, email, authPassword));
                await withAuthTimeout(sendEmailVerification(credential.user));
                await withAuthTimeout(set(ref(db, `authUsers/${credential.user.uid}`), { username: usernameClean }));
            }

            await withAuthTimeout(update(ref(db), {
                [`users/${usernameClean}/profile`]: baseProfile,
                [`publicProfiles/${usernameClean}`]: {
                    username: usernameClean,
                    nickname: baseProfile.nickname,
                    photo: '',
                    bio: '',
                    discoverable: true
                }
            }));

            createAccountSession(usernameClean, baseProfile);
            setError('');
            setAuthUsername('');
            setAuthPassword('');
            setAuthNickname('');
            setAuthContact('');
        } catch (error) {
            console.error('Registration failed:', error);
            setError(authErrorMessage(error));
        } finally {
            setAuthBusy(false);
        }
    };

    const handleVerifyPhone = async event => {
        event.preventDefault();
        setError('');
        try {
            const credential = await phoneConfirmation.confirm(verificationCode.trim());
            if (pendingPhoneProfile?.type === 'register') {
                const { username, profile } = pendingPhoneProfile;
                await set(ref(db, `authUsers/${credential.user.uid}`), { username });
                await set(ref(db, `users/${username}/profile`), profile);
                await set(ref(db, `publicProfiles/${username}`), { username, nickname: profile.nickname, photo: '', bio: '', discoverable: true });
                createAccountSession(username, profile);
            } else {
                const username = (await get(ref(db, `authUsers/${credential.user.uid}`))).val()?.username;
                if (!username) throw new Error('Bu telefona bağlı Eary hesabı bulunamadı.');
                const profile = (await get(ref(db, `users/${username}/profile`))).val();
                createAccountSession(username, profile);
            }
            setVerificationCode(''); setPhoneConfirmation(null); setPendingPhoneProfile(null);
        } catch (error) {
            setError(error.code === 'auth/invalid-verification-code' ? 'Doğrulama kodu yanlış.' : authErrorMessage(error));
        }
    };

    const handleLogout = () => {
        setAccount(null);
        setNickname('');
        localStorage.removeItem('duotalk_account');
        setHistory([]);
        localStorage.removeItem('duotalk_history');
        setAuthMode('login');
    };

    const handleUpdateAccount = async (updatedAcc) => {
        setAccount(updatedAcc);
        setNickname(updatedAcc.nickname);
        localStorage.setItem('duotalk_account', JSON.stringify(updatedAcc));

        if (updatedAcc && updatedAcc.username) {
            try {
                const profileRef = ref(db, `users/${updatedAcc.username}/profile`);
                await update(profileRef, {
                    nickname: updatedAcc.nickname,
                    photo: updatedAcc.profile.photo,
                    bio: updatedAcc.profile.bio,
                    preference: updatedAcc.profile.preference,
                    languages: updatedAcc.profile.languages,
                    interests: updatedAcc.profile.interests,
                    privacy: updatedAcc.profile.privacy || defaultPrivacy
                });
                await update(ref(db, `publicProfiles/${updatedAcc.username}`), {
                    username: updatedAcc.username,
                    nickname: updatedAcc.nickname,
                    photo: updatedAcc.profile.privacy?.profilePhoto === 'everyone' ? (updatedAcc.profile.photo || '') : '',
                    bio: updatedAcc.profile.bio || '',
                    discoverable: updatedAcc.profile.privacy?.discoverByUsername !== 'nobody'
                });
                await syncPhoneDiscovery(updatedAcc);
            } catch (err) {
                console.error("Firebase Profile Update Error:", err);
            }
        }
    };

    const filteredHistory = history.filter(item => {
        const matchesSearch = item.roomId.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              item.nickname.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;
        
        const presence = presenceData[item.roomId];
        const isActive = presence && presence.count > 0;
        
        if (activeFilter === 'active') {
            return isActive;
        } else if (activeFilter === 'past') {
            return !isActive;
        }
        return true;
    });

    const modernChatHome = true;
    if (modernChatHome) {
        return (
            <>
                <ChatHome
                    account={account}
                    authMode={authMode}
                    setAuthMode={setAuthMode}
                    authUsername={authUsername}
                    setAuthUsername={setAuthUsername}
                    authPassword={authPassword}
                    setAuthPassword={setAuthPassword}
                    authNickname={authNickname}
                    setAuthNickname={setAuthNickname}
                    authMethod={authMethod}
                    setAuthMethod={setAuthMethod}
                    authContact={authContact}
                    setAuthContact={setAuthContact}
                    verificationCode={verificationCode}
                    setVerificationCode={setVerificationCode}
                    handleVerifyPhone={handleVerifyPhone}
                    handleLogin={handleLogin}
                    handleRegister={handleRegister}
                    authBusy={authBusy}
                    error={error}
                    onOpenTestBot={() => handleSelectHistory({ isTestBot: true })}
                    showNewRoomForm={showNewRoomForm}
                    setShowNewRoomForm={setShowNewRoomForm}
                    actionTab={actionTab}
                    setActionTab={setActionTab}
                    roomId={roomId}
                    setRoomId={setRoomId}
                    roomPin={roomPin}
                    setRoomPin={setRoomPin}
                    nickname={nickname}
                    setNickname={setNickname}
                    handleSubmit={handleSubmit}
                    filteredHistory={filteredHistory}
                    history={history}
                    lastMessages={lastMessages}
                    presenceData={presenceData}
                    handleSelectHistory={handleSelectHistory}
                    handleAcceptedRequest={handleAcceptedRequest}
                    handleRemoveHistoryItem={handleRemoveHistoryItem}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    activeFilter={activeFilter}
                    setActiveFilter={setActiveFilter}
                    onOpenSettings={() => setIsSidebarOpen(true)}
                />
                <Sidebar
                    isOpen={isSidebarOpen}
                    onClose={() => setIsSidebarOpen(false)}
                    account={account}
                    onLogout={handleLogout}
                    onAuthClick={() => setAuthMode('login')}
                    alwaysNotify={alwaysNotify}
                    onToggleAlwaysNotify={handleToggleAlwaysNotify}
                    onUpdateAccount={handleUpdateAccount}
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
            </>
        );
    }

    return (
        <div className="min-h-screen w-full bg-[#FAF8F5] flex flex-col justify-start md:items-center md:justify-center md:p-4 text-[#2D1F47]">
            <div className="w-full min-h-screen md:min-h-0 md:max-w-md bg-[#FAF8F5] md:bg-white md:border md:border-[#DCD0EC]/60 md:rounded-3xl p-6 sm:p-8 md:shadow-xl relative flex flex-col justify-start overflow-y-auto md:overflow-hidden">
                {/* Visual Glow Orbs */}
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-[#E8DDF2]/30 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-[#DCD0EC]/30 rounded-full blur-3xl pointer-events-none" />

                {/* Header */}
                <div className="flex items-center justify-between mb-8 relative z-10">
                    <div className="flex items-center gap-3">
                        {authMode === 'room' && (
                            <button 
                                type="button"
                                onClick={() => setIsSidebarOpen(true)}
                                className="p-2.5 bg-[#F4F0FC] hover:bg-[#EBE5F7] border border-[#DCD0EC]/70 rounded-2xl text-[#7B52AB] transition-all duration-200 active:scale-95 cursor-pointer shadow-sm"
                            >
                                <Menu size={20} />
                            </button>
                        )}
                        <div>
                            <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#7B52AB] via-[#9D72E0] to-[#7D46D1] bg-clip-text text-transparent leading-none">
                                {text.title}
                            </h2>
                            <p className="text-[10px] text-[#8A7E9F] mt-1 font-semibold max-w-[200px] sm:max-w-none">
                                {text.subtitle}
                            </p>
                        </div>
                    </div>
                </div>


                {error && (
                    <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs font-semibold relative z-10 animate-fadeIn">
                        {error}
                    </div>
                )}

                {/* Account status header if logged in */}
                {authMode === 'room' && (
                    account ? (
                        <div className="mb-6 p-3 bg-[#F4F0FC]/50 border border-[#DCD0EC]/40 rounded-2xl flex items-center justify-between text-[11px] relative z-10 text-[#4B3E63] font-semibold">
                            <span className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                {account.nickname} (@{account.username})
                            </span>
                            <button
                                onClick={handleLogout}
                                className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-lg transition-all cursor-pointer font-bold animate-fadeIn"
                            >
                                {text.authLogout}
                            </button>
                        </div>
                    ) : (
                        <div className="mb-6 p-3 bg-[#F4F0FC]/50 border border-[#DCD0EC]/40 rounded-2xl flex items-center justify-between text-[11px] relative z-10 leading-normal text-[#4B3E63] font-semibold">
                            <span>
                                ⚠️ Misafir oturumu aktif. Oda geçmişinizi bulutta saklamak için menüden giriş yapabilirsiniz.
                            </span>
                            <button
                                onClick={() => setAuthMode('login')}
                                className="px-2.5 py-1 bg-[#7B52AB] hover:bg-[#663F93] text-white rounded-lg border border-transparent transition-all font-bold cursor-pointer shrink-0 ml-2 shadow-sm"
                            >
                                Giriş Yap
                            </button>
                        </div>
                    )
                )}

                {/* Login Form */}
                {authMode === 'login' && (
                    <form onSubmit={handleLogin} className="space-y-5 relative z-10">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                <User size={13} className="text-[#7B52AB]" />
                                {text.authUsername}
                            </label>
                            <input 
                                type="text"
                                value={authUsername}
                                onChange={(e) => setAuthUsername(e.target.value)}
                                placeholder="Örn: ahmet123"
                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                <Lock size={13} className="text-[#7B52AB]" />
                                {text.authPassword}
                            </label>
                            <input 
                                type="password"
                                value={authPassword}
                                onChange={(e) => setAuthPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200"
                            />
                        </div>

                        <div className="flex flex-col gap-3 pt-2">
                            <button 
                                type="submit"
                                className="w-full py-4 bg-[#7B52AB] hover:bg-[#663F93] text-white font-bold rounded-2xl text-center text-sm transition-all duration-200 uppercase tracking-widest cursor-pointer shadow-md"
                            >
                                {text.authBtnLogin}
                            </button>
                            
                            <button 
                                type="button"
                                onClick={() => {
                                    setAuthMode('room');
                                    setError('');
                                }}
                                className="w-full py-3 bg-[#F4F0FC] hover:bg-[#EBE5F7] border border-[#DCD0EC]/50 text-[#7B52AB] rounded-2xl text-center text-xs font-semibold transition-all cursor-pointer shadow-sm"
                            >
                                Misafir Olarak Devam Et
                            </button>

                            <div className="text-center mt-3 text-xs text-[#8A7E9F] font-medium">
                                Hesabınız yok mu?{' '}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAuthMode('register');
                                        setError('');
                                    }}
                                    className="text-[#7B52AB] hover:text-[#663F93] font-bold transition-all bg-transparent border-0 p-0 cursor-pointer ml-1"
                                >
                                    Kayıt Olun
                                </button>
                            </div>
                        </div>
                    </form>
                )}

                {/* Register Form */}
                {authMode === 'register' && (
                    <form onSubmit={handleRegister} className="space-y-5 relative z-10">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                <User size={13} className="text-[#7B52AB]" />
                                {text.authUsername}
                            </label>
                            <input 
                                type="text"
                                value={authUsername}
                                onChange={(e) => setAuthUsername(e.target.value)}
                                placeholder="Örn: ahmet123 (harf ve sayı)"
                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                <Lock size={13} className="text-[#7B52AB]" />
                                {text.authPassword}
                            </label>
                            <input 
                                type="password"
                                value={authPassword}
                                onChange={(e) => setAuthPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                <Key size={13} className="text-[#7B52AB]" />
                                {text.authNickname}
                            </label>
                            <input 
                                type="text"
                                value={authNickname}
                                onChange={(e) => setAuthNickname(e.target.value)}
                                placeholder="Örn: Ahmet Yılmaz"
                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200"
                            />
                        </div>

                        <div className="flex flex-col gap-3 pt-2">
                            <button 
                                type="submit"
                                className="w-full py-4 bg-[#7B52AB] hover:bg-[#663F93] text-white font-bold rounded-2xl text-center text-sm transition-all duration-200 uppercase tracking-widest cursor-pointer shadow-md"
                            >
                                {text.authBtnRegister}
                            </button>
                            
                            <button 
                                type="button"
                                onClick={() => {
                                    setAuthMode('room');
                                    setError('');
                                }}
                                className="w-full py-3 bg-[#F4F0FC] hover:bg-[#EBE5F7] border border-[#DCD0EC]/50 text-[#7B52AB] rounded-2xl text-center text-xs font-semibold transition-all cursor-pointer shadow-sm"
                            >
                                Misafir Olarak Devam Et
                            </button>

                            <div className="text-center mt-3 text-xs text-[#8A7E9F] font-medium">
                                Zaten bir hesabınız var mı?{' '}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAuthMode('login');
                                        setError('');
                                    }}
                                    className="text-[#7B52AB] hover:text-[#663F93] font-bold transition-all bg-transparent border-0 p-0 cursor-pointer ml-1"
                                >
                                    Giriş Yapın
                                </button>
                            </div>
                        </div>
                    </form>
                )}

                {/* Entry Form */}
                {authMode === 'room' && (
                    <>
                        {showNewRoomForm ? (
                            <form onSubmit={handleSubmit} className="space-y-5 relative z-10 animate-fadeIn">
                                        {/* TAB SWITCHER */}
                                        <div className="flex bg-[#F4F0FC] p-1 rounded-2xl border border-[#DCD0EC]/50 mb-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActionTab('join');
                                                    setError('');
                                                }}
                                                className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-155 cursor-pointer text-center ${
                                                    actionTab === 'join'
                                                        ? 'bg-[#7B52AB] text-white shadow-sm'
                                                        : 'text-[#8A7E9F] hover:text-[#4B3E63] bg-transparent border-0'
                                                }`}
                                            >
                                                {text.tabJoin}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActionTab('create');
                                                    setError('');
                                                    setRoomType('intercom_only'); // Clear selection when switching to create tab
                                                }}
                                                className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-155 cursor-pointer text-center ${
                                                    actionTab === 'create'
                                                        ? 'bg-[#7B52AB] text-white shadow-sm'
                                                        : 'text-[#8A7E9F] hover:text-[#4B3E63] bg-transparent border-0'
                                                }`}
                                            >
                                                {text.tabCreate}
                                            </button>
                                        </div>

                                {/* Room ID input */}
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                                <MessageSquare size={13} className="text-[#7B52AB]" />
                                                {text.roomId}
                                            </label>
                                            <input 
                                                type="text"
                                                value={roomId}
                                                onChange={(e) => setRoomId(e.target.value)}
                                                placeholder={text.placeholderRoom}
                                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200"
                                            />
                                        </div>

                                        {/* Room PIN input */}
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                                <Shield size={13} className="text-[#7B52AB]" />
                                                {text.roomPin}
                                            </label>
                                            <input 
                                                type="password"
                                                value={roomPin}
                                                onChange={(e) => setRoomPin(e.target.value)}
                                                placeholder={text.placeholderPin}
                                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200"
                                            />
                                        </div>

                                        {/* Nickname input */}
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-[#4B3E63] uppercase tracking-widest flex items-center gap-1.5">
                                                <User size={13} className="text-[#7B52AB]" />
                                                {text.nickname}
                                            </label>
                                            <input 
                                                type="text"
                                                value={nickname}
                                                onChange={(e) => setNickname(e.target.value)}
                                                disabled={!!account}
                                                placeholder={text.placeholderNickname}
                                                className="w-full bg-white border border-[#DCD0EC] rounded-2xl px-4 py-3.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                            />
                                        </div>

                                        <button 
                                            type="submit"
                                            className="w-full py-4 bg-[#7B52AB] hover:bg-[#663F93] text-white font-bold rounded-2xl mt-4 text-center text-sm transition-all duration-200 uppercase tracking-widest cursor-pointer shadow-md"
                                        >
                                            {actionTab === 'create' ? text.tabCreate : text.tabJoin}
                                        </button>
                                        
                                        {/* Back to history button */}
                                        {history.length > 0 && (
                                            <button 
                                                type="button"
                                                onClick={() => setShowNewRoomForm(false)}
                                                className="w-full py-3 mt-2 bg-[#F4F0FC] hover:bg-[#EBE5F7] border border-[#DCD0EC]/50 text-[#7B52AB] rounded-2xl text-center text-xs font-bold transition-all cursor-pointer shadow-sm"
                                            >
                                                {text.backToRooms}
                                            </button>
                                        )}
                            </form>
                        ) : (
                            /* History Dashboard View (WhatsApp-like Room List) */
                            <div className="space-y-4 relative z-10 animate-fadeIn flex-1 flex flex-col min-h-0">
                                <div className="text-center pb-1">
                                    <h3 className="text-base font-extrabold text-[#2D1F47] flex items-center justify-center gap-2">
                                        <History size={16} className="text-[#7B52AB]" />
                                        {text.recentRooms}
                                    </h3>
                                    <p className="text-[10px] text-[#8A7E9F] mt-0.5 font-semibold">
                                        {text.recentRoomsSubtitle}
                                    </p>
                                </div>

                                {/* WhatsApp-style Search Bar */}
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Oda veya isim ara..."
                                        className="w-full bg-white border border-[#DCD0EC]/80 rounded-2xl pl-9 pr-4 py-2.5 text-[#2D1F47] placeholder-slate-400 focus:outline-none focus:border-[#7B52AB] focus:ring-1 focus:ring-[#7B52AB] text-xs transition-all duration-200 shadow-sm"
                                    />
                                    <span className="absolute left-3 top-3.5 text-xs text-[#8A7E9F] pointer-events-none">
                                        🔍
                                    </span>
                                </div>

                                {/* WhatsApp-style Filter Pills */}
                                <div className="flex gap-2 overflow-x-auto pb-1 shrink-0 scrollbar-none">
                                    <button
                                        type="button"
                                        onClick={() => setActiveFilter('all')}
                                        className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold transition-all cursor-pointer border ${
                                            activeFilter === 'all'
                                                ? 'bg-[#7B52AB] text-white border-transparent shadow-sm'
                                                : 'bg-[#F4F0FC] text-[#7B52AB] border-[#DCD0EC]/40 hover:bg-[#EBE5F7]'
                                        }`}
                                    >
                                        Tümü
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveFilter('active')}
                                        className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold transition-all cursor-pointer border flex items-center gap-1 ${
                                            activeFilter === 'active'
                                                ? 'bg-[#7B52AB] text-white border-transparent shadow-sm'
                                                : 'bg-[#F4F0FC] text-[#7B52AB] border-[#DCD0EC]/40 hover:bg-[#EBE5F7]'
                                        }`}
                                    >
                                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                        Aktif Odalar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveFilter('past')}
                                        className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold transition-all cursor-pointer border ${
                                            activeFilter === 'past'
                                                ? 'bg-[#7B52AB] text-white border-transparent shadow-sm'
                                                : 'bg-[#F4F0FC] text-[#7B52AB] border-[#DCD0EC]/40 hover:bg-[#EBE5F7]'
                                        }`}
                                    >
                                        Geçmiş Odalar
                                    </button>
                                </div>
                                
                                <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1 flex-1">
                                    {filteredHistory.length === 0 ? (
                                        <div className="text-center py-8 text-xs text-[#8A7E9F] font-semibold italic">
                                            Aranan kriterlere uygun oda bulunamadı.
                                        </div>
                                    ) : (
                                        filteredHistory.map((item, idx) => {
                                            const lastMsg = lastMessages[item.roomId];
                                            const presence = presenceData[item.roomId];
                                            const displayTime = lastMsg 
                                                ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                                                : new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

                                            return (
                                                <div
                                                    key={idx}
                                                    onClick={() => handleSelectHistory(item)}
                                                    className="group flex items-center justify-between p-3.5 bg-white hover:bg-[#F4F0FC]/40 border border-[#DCD0EC]/50 hover:border-[#7B52AB]/30 rounded-2xl transition-all duration-200 cursor-pointer shadow-sm active:scale-[0.99]"
                                                >
                                                    <div className="flex items-center flex-1 min-w-0">
                                                        {/* WhatsApp-style Circular Room Avatar */}
                                                        <div className="w-11 h-11 rounded-full bg-[#E8DDF2] flex items-center justify-center text-[#7B52AB] font-black text-sm shrink-0 border border-[#DCD0EC]/40 shadow-sm relative">
                                                            {item.roomId.slice(0, 2).toUpperCase()}
                                                            {presence?.count > 0 && (
                                                                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full animate-pulse" />
                                                            )}
                                                        </div>
                                                        
                                                        <div className="min-w-0 flex-1 ml-3">
                                                            <div className="flex items-center justify-between">
                                                                <span className="font-extrabold text-sm text-[#2D1F47] truncate">{item.roomId}</span>
                                                                <span className="text-[9px] text-[#8A7E9F] font-bold">
                                                                    {displayTime}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                                                <span className="text-[8px] px-1.5 py-0.5 rounded-md font-extrabold border bg-[#E8DDF2]/60 border-[#DCD0EC]/40 text-[#7B52AB]">
                                                                    İnterkom
                                                                </span>
                                                                {presence?.count > 0 && (
                                                                    <span className="text-[8px] px-1.5 py-0.5 rounded-md font-extrabold bg-emerald-50 border border-emerald-250 text-emerald-600 flex items-center gap-0.5">
                                                                        👥 {presence.count} aktif
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Last Message Preview */}
                                                            <div className="mt-1 truncate text-xs text-[#4B3E63] font-medium">
                                                                {lastMsg ? (
                                                                    <span className="text-slate-650">
                                                                        <span className="font-bold text-[#7B52AB]">{lastMsg.senderName}: </span>
                                                                        {lastMsg.isVoice ? '🎙️ ' : ''}{String(lastMsg.text || '').trim().split(/\s+/).slice(0, 5).join(' ')}{String(lastMsg.text || '').trim().split(/\s+/).length > 5 ? '…' : ''}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-400 italic text-[11px]">Henüz konuşma yok</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-2 shrink-0 ml-2">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemoveHistoryItem(e, item.roomId);
                                                            }}
                                                            className="opacity-45 hover:opacity-100 p-2 bg-[#F4F0FC] hover:bg-rose-50 border border-[#DCD0EC]/30 hover:border-rose-200 text-[#7B52AB] hover:text-rose-600 rounded-xl transition-all cursor-pointer shadow-sm"
                                                            title="Geçmişten Sil"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                                
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowNewRoomForm(true);
                                        setActionTab('join');
                                        setRoomType('intercom_only');
                                    }}
                                    className="w-full py-4 bg-[#7B52AB] hover:bg-[#663F93] text-white font-extrabold rounded-2xl text-center text-xs transition-all duration-200 uppercase tracking-widest cursor-pointer shadow-md mt-2"
                                >
                                    {text.addNewRoom}
                                </button>
                            </div>
                        )}
                        {/* Offline Language Help moved to Sidebar */}
                    </>
                )}
            </div>

            <Sidebar 
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                language={language}
                account={account}
                onLogout={handleLogout}
                onAuthClick={() => setAuthMode('login')}
                history={history}
                onSelectRoom={handleSelectHistory}
                onRemoveRoom={handleRemoveHistoryItem}
                alwaysNotify={alwaysNotify}
                onToggleAlwaysNotify={handleToggleAlwaysNotify}
                onUpdateAccount={handleUpdateAccount}
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
            />
        </div>
    );
}
