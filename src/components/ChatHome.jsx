import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, BellOff, Captions, ChevronRight, Languages, LockKeyhole, MessageCircle, MessageSquarePlus,
    Menu, Mic, Save, Search, Send, Settings, Share2, Sparkles, Star, Trash2, UserPlus, UserRound, X
} from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { db, ref, get, getRest, onValue, push, update, updateRest } from '../firebase';
import { getDeviceId } from '../utils/pushNotifications';
import { sha256Hex } from '../utils/hash';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const messagePreview = message => {
    if (!message) return 'Henüz mesaj yok';
    const fallback = '';
    const value = String(message.text || fallback).trim();
    if (!value) return 'Mesaj';
    const words = value.split(/\s+/);
    return `${message.isVoice ? '🎙️ ' : ''}${words.slice(0, 5).join(' ')}${words.length > 5 ? '…' : ''}`;
};

const readJson = (key, fallback) => {
    try {
        return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
        return fallback;
    }
};

const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
};

const RECENT_ACTIVITIES_KEY = 'eary_recent_activities';
const CAPTION_SESSIONS_KEY = 'eary_caption_sessions';

const compactPreview = value => {
    const words = String(value || '').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'Henüz aktivite yok';
    return `${words.slice(0, 9).join(' ')}${words.length > 9 ? '...' : ''}`;
};

const HOME_MODES = [
    { id: 'face', label: 'Yüz yüze', eyebrow: 'Canlı çeviri', title: 'Karşındaki kişiyi anında anla', description: 'Konuşmayı yazıya dök, gerekirse seçtiğin dile çevir ve iki taraflı görüşmeyi aynı ekranda yönet.', action: 'Konuşmayı başlat', icon: Languages },
    { id: 'ambient', label: 'Ortam', eyebrow: 'Canlı altyazı', title: 'Dersi, toplantıyı veya ortamı dinle', description: 'Uzun konuşmaları tek canlı oturum metnine dönüştür; sonra istersen çevir veya belge olarak kaydet.', action: 'Dinlemeye başla', icon: Captions },
    { id: 'chats', label: 'Sohbet', eyebrow: 'Eary sohbet', title: 'Konuş, mesajın yazıya dönüşsün', description: 'Kişilerle sohbet et, sesle mesaj oluştur, gelen metni okuyup çevir ve geçmişi güvenle takip et.', action: 'Sohbetlere geç', icon: MessageCircle }
];

const HOME_MODE_I18N = {
    'tr-TR': HOME_MODES,
    'de-DE': [
        { id: 'face', label: 'Vor Ort', eyebrow: 'Live-Übersetzung', title: 'Verstehe dein Gegenüber sofort', description: 'Sprache in Text umwandeln, bei Bedarf übersetzen und ein Gespräch für zwei Personen auf demselben Bildschirm führen.', action: 'Gespräch starten', icon: Languages },
        { id: 'ambient', label: 'Umgebung', eyebrow: 'Live-Untertitel', title: 'Unterricht, Meeting oder Umgebung mithören', description: 'Längere Sprache als laufenden Text erfassen; danach übersetzen oder als Dokument speichern.', action: 'Zuhören starten', icon: Captions },
        { id: 'chats', label: 'Chats', eyebrow: 'Eary Chat', title: 'Sprich, deine Nachricht wird Text', description: 'Chatte mit Kontakten, erstelle Sprachnachrichten als Text, lies und übersetze eingehende Nachrichten.', action: 'Zu Chats', icon: MessageCircle }
    ],
    'en-US': [
        { id: 'face', label: 'Face', eyebrow: 'Live translation', title: 'Understand the person in front of you instantly', description: 'Turn speech into text, translate when needed, and manage a two-sided conversation on one screen.', action: 'Start conversation', icon: Languages },
        { id: 'ambient', label: 'Ambient', eyebrow: 'Live captions', title: 'Listen to a class, meeting, or room', description: 'Capture long speech as one live text stream; then translate it or save it as a document.', action: 'Start listening', icon: Captions },
        { id: 'chats', label: 'Chats', eyebrow: 'Eary chat', title: 'Speak and send your message as text', description: 'Chat with people, create voice messages as text, read and translate incoming messages.', action: 'Open chats', icon: MessageCircle }
    ],
    'fr-FR': [
        { id: 'face', label: 'Face', eyebrow: 'Traduction en direct', title: 'Comprenez immédiatement la personne en face', description: 'Transformez la parole en texte, traduisez si besoin et gérez une conversation à deux sur le même écran.', action: 'Commencer', icon: Languages },
        { id: 'ambient', label: 'Ambiant', eyebrow: 'Sous-titres en direct', title: 'Écoutez un cours, une réunion ou une pièce', description: 'Capturez de longues paroles en texte continu, puis traduisez ou enregistrez comme document.', action: 'Écouter', icon: Captions },
        { id: 'chats', label: 'Chats', eyebrow: 'Chat Eary', title: 'Parlez, votre message devient du texte', description: 'Discutez, créez des messages vocaux en texte, lisez et traduisez les messages reçus.', action: 'Ouvrir les chats', icon: MessageCircle }
    ],
    'es-ES': [
        { id: 'face', label: 'Cara', eyebrow: 'Traducción en vivo', title: 'Entiende al instante a la persona frente a ti', description: 'Convierte voz en texto, traduce si hace falta y gestiona una conversación de dos personas en una pantalla.', action: 'Iniciar conversación', icon: Languages },
        { id: 'ambient', label: 'Ambiente', eyebrow: 'Subtítulos en vivo', title: 'Escucha una clase, reunión o entorno', description: 'Captura discursos largos como texto continuo; luego traduce o guarda como documento.', action: 'Empezar a escuchar', icon: Captions },
        { id: 'chats', label: 'Chats', eyebrow: 'Chat Eary', title: 'Habla y tu mensaje se vuelve texto', description: 'Chatea, crea mensajes de voz como texto, lee y traduce mensajes entrantes.', action: 'Abrir chats', icon: MessageCircle }
    ],
    'it-IT': [
        { id: 'face', label: 'Faccia', eyebrow: 'Traduzione live', title: 'Capisci subito chi hai davanti', description: 'Trasforma la voce in testo, traduci se serve e gestisci una conversazione a due sullo stesso schermo.', action: 'Avvia conversazione', icon: Languages },
        { id: 'ambient', label: 'Ambiente', eyebrow: 'Sottotitoli live', title: 'Ascolta una lezione, riunione o ambiente', description: 'Cattura discorsi lunghi come testo continuo; poi traduci o salva come documento.', action: 'Inizia ascolto', icon: Captions },
        { id: 'chats', label: 'Chat', eyebrow: 'Chat Eary', title: 'Parla e il messaggio diventa testo', description: 'Chatta, crea messaggi vocali come testo, leggi e traduci i messaggi ricevuti.', action: 'Apri chat', icon: MessageCircle }
    ]
};

const getHomeModes = language => HOME_MODE_I18N[normalizeAppLanguage(language)] || HOME_MODES;
const normalizeHomeMode = value => ['face', 'ambient', 'chats'].includes(value) ? value : 'ambient';

import { normalizePhone, phoneLookupKey } from '../utils/identity';
import { normalizeAppLanguage } from '../utils/language';
import { uiText } from '../utils/i18n';
import AccessibilityHub from './AccessibilityHub';
import NewConversation from './NewConversation';

const EaryContacts = registerPlugin('EaryContacts');

const AVATAR_COLORS = ['#dceee9', '#e8e2f3', '#f4e4d7', '#dce9f4', '#f2dfe5'];

const getDirectPeerUsername = (item, accountUsername) => item.peerUsername || (item.roomId.startsWith('dm-')
    ? item.roomId.slice(3).split('-').find(value => value !== accountUsername)
    : '');

const normalizeProfile = (username, profile = {}) => ({
    username: profile.username || username,
    nickname: profile.nickname || username,
    bio: profile.bio || '',
    discoverable: profile.discoverable ?? profile.privacy?.discoverByUsername !== 'nobody'
});

function Avatar({ name, online }) {
    const index = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_COLORS.length;
    return (
        <div className="relative h-12 w-12 shrink-0 rounded-full" style={{ background: AVATAR_COLORS[index] }}>
            <div className="flex h-full w-full items-center justify-center text-[#31534b]"><UserRound size={23} /></div>
            <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-[3px] border-[var(--surface)] ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        </div>
    );
}

function PremiumHome({ activeMode, setActiveMode, onLaunchMode, onOpenChats, onOpenChatItem, onOpenActivity, onOpenSettings, recentItems, lastMessages, chatDisplay, language }) {
    const homeModes = getHomeModes(language);
    const text = uiText(language);
    const selectedMode = homeModes.find(mode => mode.id === activeMode) || homeModes[1];
    const activities = readJson(RECENT_ACTIVITIES_KEY, []);
    const activityRows = activities.filter(activity => activity.type === activeMode).slice(0, 4);
    const chatRows = recentItems.slice(0, 4).map(item => {
        const display = chatDisplay(item);
        const message = lastMessages[item.roomId];
        return {
            id: item.roomId,
            title: display.name,
            preview: `${message?.senderName ? `${message.senderName}: ` : ''}${messagePreview(message)}`,
            createdAt: Number(message?.timestamp || item.timestamp || item.createdAt || 0),
            icon: MessageCircle,
            item
        };
    });
    const modeRows = activeMode === 'chats'
        ? chatRows
        : activityRows.map(activity => ({
            id: activity.id,
            title: activity.title,
            preview: compactPreview(activity.preview),
            createdAt: activity.createdAt,
            meta: activity.meta,
            icon: activeMode === 'ambient' ? Captions : Languages,
            activity
        }));
    const emptyText = {
        face: 'Henüz yüz yüze görüşme yok. Başlattığın görüşmeler burada görünecek; belge olarak kaydetmen gerekmez.',
        ambient: 'Henüz ortam dinleme aktivitesi yok. Dinlemeye başladığında son metin burada görünür; kaydetmek ayrı bir işlemdir.',
        chats: 'Henüz sohbet yok. Kişi bulabilir veya test sohbeti açabilirsin.'
    }[activeMode];

    return (
        <main className="eary-shell eary-line relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[var(--surface)] sm:h-[780px] sm:rounded-xl sm:border sm:shadow-xl">
            <header className="eary-ios-safe-header px-5 pb-3">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="eary-brand text-[10px] font-black uppercase tracking-normal">{text.homeEyebrow}</p>
                        <h1 className="mt-1 text-2xl font-black tracking-normal">Eary</h1>
                    </div>
                    <button type="button" onClick={onOpenSettings} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-full" title={text.navSettings}><Settings size={19} /></button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-1 rounded-full bg-[var(--soft)] p-1">
                    {homeModes.map(mode => (
                        <button key={mode.id} type="button" onClick={() => setActiveMode(mode.id)} className={`min-w-0 rounded-full px-2 py-2 text-[10px] font-black transition-colors ${activeMode === mode.id ? 'eary-brand-bg shadow-sm' : 'eary-muted'}`}>
                            {mode.label}
                        </button>
                    ))}
                </div>
            </header>

            <section className="flex-1 overflow-y-auto px-5 pb-20 pt-1">
                <div className="flex min-h-[44vh] flex-col items-center justify-center text-center">
                    <button type="button" onClick={() => onLaunchMode(selectedMode.id)} className="eary-brand-bg flex h-24 w-24 items-center justify-center rounded-full shadow-[0_16px_34px_rgba(23,107,91,0.20)] active:scale-[0.98]" aria-label={selectedMode.action}>
                        {selectedMode.id === 'chats' ? <MessageCircle size={38} /> : <Mic size={40} />}
                    </button>
                    <h2 className="mt-5 max-w-[320px] text-2xl font-black leading-tight tracking-normal">{selectedMode.title}</h2>
                    <p className="eary-muted mt-2 max-w-[330px] text-sm font-medium leading-6">{selectedMode.description}</p>
                    <button type="button" onClick={() => onLaunchMode(selectedMode.id)} className="mt-5 rounded-full bg-[#17221f] px-6 py-3 text-sm font-black text-white shadow-sm">
                        {selectedMode.action}
                    </button>
                </div>

                <section className="border-t eary-line pt-4">
                    <div className="mb-2 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-black">{activeMode === 'chats' ? text.recentChats : text.recentActivities}</h3>
                            <p className="eary-muted mt-0.5 text-[10px] font-semibold">{text.recentHint}</p>
                        </div>
                        {activeMode === 'chats' && <button type="button" onClick={onOpenChats} className="eary-brand text-[11px] font-black">{text.allChats}</button>}
                    </div>
                    {modeRows.length ? (
                        <div className="divide-y eary-line">
                            {modeRows.map(row => {
                                const RowIcon = row.icon;
                                return (
                                    <button
                                        key={row.id}
                                        type="button"
                                        onClick={() => activeMode === 'chats' ? onOpenChatItem?.(row.item) : onOpenActivity?.(row.activity)}
                                        className="flex w-full items-center gap-3 py-3 text-left"
                                    >
                                        <span className="eary-soft eary-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-full"><RowIcon size={20} /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-black">{row.title}</span>
                                            <span className="eary-muted block truncate text-[12px] font-semibold">{row.preview}</span>
                                        </span>
                                        <ChevronRight size={17} className="eary-muted shrink-0" />
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="eary-muted py-4 text-sm leading-6">{emptyText}</p>
                    )}
                </section>
            </section>

            <nav className="eary-shell absolute bottom-0 left-0 right-0 grid grid-cols-3 border-t eary-line px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_18px_rgba(0,0,0,0.04)]">
                <button type="button" className="eary-brand flex flex-col items-center gap-1 text-[10px] font-bold"><Sparkles size={20} />{text.navHome}</button>
                <button type="button" onClick={onOpenChats} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><MessageCircle size={20} />{text.navChats}</button>
                <button type="button" onClick={onOpenSettings} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><Settings size={20} />{text.navSettings}</button>
            </nav>
        </main>
    );
}

const activityText = activity => String(
    activity?.transcriptText
    || activity?.processedText
    || activity?.preview
    || ''
).trim();

const updateStoredAmbientTranscript = (activity, nextText) => {
    const cleanText = String(nextText || '').trim();
    const updatedAt = Date.now();
    const updatedActivity = {
        ...activity,
        preview: cleanText,
        transcriptText: cleanText,
        processedText: cleanText,
        updatedAt
    };
    const activities = readJson(RECENT_ACTIVITIES_KEY, []);
    const hasActivity = activities.some(item => item.id === activity?.id);
    const nextActivities = (hasActivity
        ? activities.map(item => item.id === activity.id ? { ...item, ...updatedActivity } : item)
        : [updatedActivity, ...activities]
    ).slice(0, 30);
    writeJson(RECENT_ACTIVITIES_KEY, nextActivities);

    const sessions = readJson(CAPTION_SESSIONS_KEY, []);
    let sessionChanged = false;
    const nextSessions = sessions.map(session => {
        const sameSession = activity?.sessionId && String(session.id) === String(activity.sessionId);
        const sameActivity = activity?.id && String(session.id) === String(activity.id);
        if (!sameSession && !sameActivity) return session;
        sessionChanged = true;
        return {
            ...session,
            transcriptText: cleanText,
            processedText: cleanText,
            updatedAt
        };
    });
    if (sessionChanged) writeJson(CAPTION_SESSIONS_KEY, nextSessions);
    return updatedActivity;
};

function ActivityDetailView({ activity, onBack }) {
    const [currentActivity, setCurrentActivity] = useState(activity);
    const [ambientDraft, setAmbientDraft] = useState(() => activityText(activity));
    const [statusText, setStatusText] = useState('');
    const isFace = currentActivity?.type === 'face';
    const messages = Array.isArray(currentActivity?.messages) ? currentActivity.messages.filter(message => message?.text) : [];
    const fallbackText = activityText(currentActivity);
    const title = activity?.title || (isFace ? 'Yüz yüze görüşme' : 'Ortam dinleme');
    const createdAt = Number(currentActivity?.createdAt || 0);

    useEffect(() => {
        setCurrentActivity(activity);
        setAmbientDraft(activityText(activity));
        setStatusText('');
    }, [activity]);

    const saveAmbientDraft = () => {
        const updatedActivity = updateStoredAmbientTranscript(currentActivity, ambientDraft);
        setCurrentActivity(updatedActivity);
        setAmbientDraft(activityText(updatedActivity));
        setStatusText('Kaydedildi');
        setTimeout(() => setStatusText(''), 1800);
    };

    const shareAmbientDraft = async () => {
        const textToShare = String(ambientDraft || '').trim();
        if (!textToShare) return;
        try {
            if (navigator.share) {
                await navigator.share({ title, text: textToShare });
                setStatusText('Paylasima hazir');
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(textToShare);
                setStatusText('Metin panoya kopyalandi');
            }
        } catch (error) {
            if (error?.name !== 'AbortError') setStatusText('Paylasim acilamadi');
        }
        setTimeout(() => setStatusText(''), 1800);
    };

    return (
        <main className="eary-shell eary-line relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[var(--surface)] sm:h-[780px] sm:rounded-xl sm:border sm:shadow-xl">
            <header className="eary-ios-safe-header flex items-center gap-3 border-b eary-line px-4 pb-3">
                <button type="button" onClick={onBack} className="eary-soft eary-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" title="Geri"><ArrowLeft size={20} /></button>
                <div className="min-w-0 flex-1">
                    <p className="eary-muted text-[10px] font-black uppercase">{isFace ? 'Konuşma transkripti' : 'Ortam transkripti'}</p>
                    <h1 className="truncate text-base font-black">{title}</h1>
                    {createdAt > 0 && <p className="eary-muted mt-0.5 text-[10px] font-semibold">{new Date(createdAt).toLocaleString('tr-TR')}</p>}
                </div>
            </header>

            <section className="flex-1 overflow-y-auto px-4 py-5">
                {isFace ? (
                    <div className="space-y-3">
                        {(messages.length ? messages : [{ id: 'preview', side: 'host', text: fallbackText }]).filter(message => message.text).map(message => {
                            const mine = message.side === 'host';
                            return (
                                <article key={message.id || `${message.side}-${message.text}`} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 shadow-sm ${mine ? 'rounded-br-md bg-emerald-100 text-[#17372C]' : 'rounded-bl-md bg-violet-50 text-[#2D1F47]'}`}>
                                        <p className={`mb-1 text-[9px] font-black uppercase ${mine ? 'text-emerald-700' : 'text-violet-700'}`}>{mine ? 'Ben' : 'Karşı taraf'}</p>
                                        <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6">{message.text}</p>
                                    </div>
                                </article>
                            );
                        })}
                        {!messages.length && !fallbackText && <p className="eary-muted py-12 text-center text-sm">Bu aktivitede henüz transkript yok.</p>}
                    </div>
                ) : (
                    <article className="space-y-3">
                        <textarea
                            value={ambientDraft}
                            onChange={event => setAmbientDraft(event.target.value)}
                            rows={16}
                            className="eary-input min-h-[360px] w-full resize-none rounded-lg border eary-line bg-white/80 p-4 text-[15px] font-semibold leading-8 text-[var(--text)]"
                            placeholder="Bu aktivitede henuz transkript yok."
                            aria-label="Ortam transkriptini duzenle"
                        />
                        <div className="flex gap-2">
                            <button type="button" onClick={saveAmbientDraft} disabled={!ambientDraft.trim()} className="eary-brand-bg flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-black disabled:opacity-40">
                                <Save size={17} /> Kaydet
                            </button>
                            <button type="button" onClick={shareAmbientDraft} disabled={!ambientDraft.trim()} className="eary-soft eary-brand flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-black disabled:opacity-40">
                                <Share2 size={17} /> Paylas
                            </button>
                        </div>
                        {statusText && <p className="eary-muted text-center text-xs font-bold">{statusText}</p>}
                    </article>
                )}
            </section>
        </main>
    );
}

export default function ChatHome(props) {
    const {
        account, error,
        showNewRoomForm, setShowNewRoomForm, onOpenTestBot, language, filteredHistory, history = [],
        lastMessages, presenceData, handleSelectHistory, handleAcceptedRequest, handleRemoveHistoryItem,
        searchQuery, setSearchQuery, activeFilter, setActiveFilter, onOpenSettings
    } = props;
    const text = uiText(language);

    const [selectedChatIds, setSelectedChatIds] = useState([]);
    const [favoriteRoomIds, setFavoriteRoomIds] = useState(() => JSON.parse(localStorage.getItem('eary_favorite_rooms') || '[]'));
    const [lockedTarget, setLockedTarget] = useState(null);
    const [unlockPin, setUnlockPin] = useState('');
    const [unlockError, setUnlockError] = useState('');
    const [toast, setToast] = useState('');
    const [directoryResult, setDirectoryResult] = useState(null);
    const [directoryLoading, setDirectoryLoading] = useState(false);
    const [directoryError, setDirectoryError] = useState('');
    const [directorySearched, setDirectorySearched] = useState(false);
    const [messageRequests, setMessageRequests] = useState([]);
    const [requestAction, setRequestAction] = useState(null);
    const [requestSendingUsername, setRequestSendingUsername] = useState('');
    const [requestSentUsername, setRequestSentUsername] = useState('');
    const [showContacts, setShowContacts] = useState(false);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactMatches, setContactMatches] = useState([]);
    const [inviteContacts, setInviteContacts] = useState([]);
    const [contactsError, setContactsError] = useState('');
    const [homeTab, setHomeTab] = useState(() => localStorage.getItem('eary_home_tab') || 'accessibility');
    const [activeHomeMode, setActiveHomeMode] = useState(() => normalizeHomeMode(localStorage.getItem('eary_home_mode') || 'ambient'));
    const [activeToolView, setActiveToolView] = useState(null);
    const [activeToolPayload, setActiveToolPayload] = useState(null);
    const [activityDetail, setActivityDetail] = useState(null);
    const [chatProfiles, setChatProfiles] = useState({});
    const pressTimerRef = useRef(null);
    const pressStartRef = useRef(null);

    const chatDisplay = item => {
        const peerUsername = getDirectPeerUsername(item, account?.username);
        const profile = chatProfiles[peerUsername];
        return { name: item.title || profile?.nickname || peerUsername || item.roomId };
    };

    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(''), 2000);
        return () => clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
        if (!requestSentUsername || !account?.username) return;
        const accepted = history.some(item => getDirectPeerUsername(item, account.username) === requestSentUsername || item.peerUsername === requestSentUsername);
        if (!accepted) return;
        setRequestSentUsername('');
        setDirectoryResult(null);
        setDirectorySearched(false);
        setToast('Konuşma isteğiniz kabul edildi');
    }, [account?.username, history, requestSentUsername]);

    useEffect(() => {
        if (!account?.username) return;
        const missingPeers = filteredHistory
            .filter(item => item.kind === 'direct' || item.roomId.startsWith('dm-'))
            .map(item => getDirectPeerUsername(item, account.username)).filter(Boolean)
            .filter(username => !chatProfiles[username]);
        [...new Set(missingPeers)].forEach(async username => {
            const snapshot = await get(ref(db, `publicProfiles/${username}`));
            const profile = snapshot.val() || { username, nickname: username };
            setChatProfiles(current => ({ ...current, [username]: profile }));
            const item = filteredHistory.find(historyItem => getDirectPeerUsername(historyItem, account.username) === username);
            if (item && !item.title) await update(ref(db, `users/${account.username}/history/${item.roomId}`), { kind: 'direct', peerUsername: username, title: profile.nickname || username });
        });
    }, [account?.username, chatProfiles, filteredHistory]);

    const openHomeTab = useCallback(tab => {
        setHomeTab(tab);
        localStorage.setItem('eary_home_tab', tab);
    }, []);

    const selectHomeMode = mode => {
        const nextMode = normalizeHomeMode(mode);
        setActiveHomeMode(nextMode);
        localStorage.setItem('eary_home_mode', nextMode);
        return nextMode;
    };

    const launchHomeMode = mode => {
        const nextMode = selectHomeMode(mode);
        setActivityDetail(null);
        if (nextMode === 'chats') {
            setActiveToolView(null);
            setActiveToolPayload(null);
            openHomeTab('chats');
            return;
        }
        setActiveToolView(nextMode);
        setActiveToolPayload(null);
        openHomeTab('accessibility');
    };

    const returnToPremiumHome = useCallback(() => {
        setActivityDetail(null);
        setActiveToolView(null);
        setActiveToolPayload(null);
        openHomeTab('accessibility');
    }, [openHomeTab]);

    const openHomeActivity = activity => {
        if (!activity) {
            launchHomeMode(activeHomeMode);
            return;
        }
        if (activity.type === 'face') {
            setActiveHomeMode('face');
            localStorage.setItem('eary_home_mode', 'face');
            setActiveToolView(null);
            setActiveToolPayload(null);
            setActivityDetail(activity);
            openHomeTab('accessibility');
            return;
        }
        setActiveHomeMode(activity.type || activeHomeMode);
        localStorage.setItem('eary_home_mode', activity.type || activeHomeMode);
        setActiveToolView(null);
        setActiveToolPayload(null);
        setActivityDetail(activity);
        openHomeTab('accessibility');
    };

    const persistFavorites = next => {
        setFavoriteRoomIds(next);
        localStorage.setItem('eary_favorite_rooms', JSON.stringify(next));
    };

    const toggleSelection = roomId => setSelectedChatIds(current => current.includes(roomId) ? current.filter(id => id !== roomId) : [...current, roomId]);
    const cancelLongPress = () => {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
    };
    const startLongPress = (event, roomId) => {
        pressStartRef.current = { x: event.clientX, y: event.clientY };
        cancelLongPress();
        pressTimerRef.current = setTimeout(() => {
            setSelectedChatIds(current => current.includes(roomId) ? current : [...current, roomId]);
            pressTimerRef.current = null;
        }, 550);
    };
    const trackLongPress = event => {
        if (!pressTimerRef.current || !pressStartRef.current) return;
        if (Math.hypot(event.clientX - pressStartRef.current.x, event.clientY - pressStartRef.current.y) > 10) cancelLongPress();
    };

    const openChat = item => {
        if (selectedChatIds.length) {
            toggleSelection(item.roomId);
            return;
        }
        if (localStorage.getItem(`eary_chat_lock_${item.roomId}`)) {
            setLockedTarget(item);
            setUnlockPin('');
            setUnlockError('');
            return;
        }
        handleSelectHistory(item);
    };

    const hashPin = async pin => {
        return sha256Hex(`eary-lock:${lockedTarget.roomId}:${pin}`);
    };
    const unlockChat = async event => {
        event.preventDefault();
        const expected = localStorage.getItem(`eary_chat_lock_${lockedTarget.roomId}`);
        if (await hashPin(unlockPin) !== expected) {
            setUnlockError('PIN doğru değil.');
            return;
        }
        const target = lockedTarget;
        setLockedTarget(null);
        handleSelectHistory(target);
    };

    const toggleFavorites = () => {
        const allSelectedAreFavorites = selectedChatIds.every(id => favoriteRoomIds.includes(id));
        const next = allSelectedAreFavorites
            ? favoriteRoomIds.filter(id => !selectedChatIds.includes(id))
            : [...new Set([...favoriteRoomIds, ...selectedChatIds])];
        persistFavorites(next);
    };
    const toggleMute = async () => {
        const shouldUnmute = selectedChatIds.every(id => Number(localStorage.getItem(`eary_mute_${id}`)) === -1);
        const mutedUntil = shouldUnmute ? 0 : -1;
        selectedChatIds.forEach(id => localStorage.setItem(`eary_mute_${id}`, String(mutedUntil)));
        await Promise.all(selectedChatIds.map(id => update(ref(db, `rooms/${id}/pushTokens/${getDeviceId()}`), { mutedUntil })));
        setSelectedChatIds([]);
    };
    const deleteSelectedChats = () => {
        selectedChatIds.forEach(id => handleRemoveHistoryItem({ stopPropagation() {} }, id));
        setSelectedChatIds([]);
    };

    useEffect(() => {
        const handleBack = event => {
            if (showContacts) {
                event.preventDefault();
                setShowContacts(false);
            } else if (lockedTarget) {
                event.preventDefault();
                setLockedTarget(null);
            } else if (selectedChatIds.length) {
                event.preventDefault();
                setSelectedChatIds([]);
            } else if (showNewRoomForm) {
                event.preventDefault();
                setShowNewRoomForm(false);
            } else if (activityDetail) {
                event.preventDefault();
                returnToPremiumHome();
            } else if (activeToolView) {
                event.preventDefault();
                returnToPremiumHome();
            } else if (homeTab === 'chats') {
                event.preventDefault();
                openHomeTab('accessibility');
            }
        };
        window.addEventListener('eary:back', handleBack);
        return () => window.removeEventListener('eary:back', handleBack);
    }, [activeToolView, activityDetail, homeTab, lockedTarget, openHomeTab, returnToPremiumHome, selectedChatIds.length, setShowNewRoomForm, showContacts, showNewRoomForm]);

    useEffect(() => {
        if (!account) { setMessageRequests([]); return undefined; }
        const requestsRef = ref(db, `messageRequests/${account.username}`);
        const applyRequests = value => {
            setMessageRequests(Object.entries(value).map(([id, request]) => ({ id, ...request })).filter(request => request.status === 'pending'));
        };
        const unsubscribe = onValue(
            requestsRef,
            snapshot => applyRequests(snapshot.val() || {}),
            error => console.warn('Message requests listener unavailable:', error)
        );
        const refresh = async () => {
            try {
                const restValue = await getRest(`messageRequests/${account.username}`).catch(() => null);
                if (restValue) {
                    applyRequests(restValue);
                    return;
                }
                applyRequests({});
            } catch (error) {
                console.error('Message requests refresh failed:', error);
            }
        };
        refresh();
        const interval = setInterval(refresh, 5000);
        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, [account]);

    useEffect(() => {
        if (messageRequests.length === 0 || homeTab === 'chats' || showNewRoomForm) return;
        openHomeTab('chats');
        setToast('Yeni sohbet isteği geldi');
    }, [homeTab, messageRequests.length, openHomeTab, showNewRoomForm]);

    useEffect(() => {
        const rawSearch = searchQuery.trim();
        const isPhoneSearch = rawSearch.replace(/\D/g, '').length >= 7;
        const clean = rawSearch.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        setDirectoryError('');
        setDirectorySearched(false);
        if (!account || (!isPhoneSearch && clean.length < 3) || clean === account.username) { setDirectoryResult(null); setDirectoryLoading(false); return undefined; }
        setDirectoryLoading(true);
        const timer = setTimeout(async () => {
            try {
                let username = clean;
                if (isPhoneSearch) {
                    const key = await phoneLookupKey(rawSearch);
                    const phoneEntry = await getRest(`phoneDirectory/${key}`, { timeoutMs: 4500 });
                    username = phoneEntry?.username || '';
                }
                let result = username ? await getRest(`publicProfiles/${username}`, { timeoutMs: 4500 }) : null;
                if (!result && username) {
                    const legacyProfile = await getRest(`users/${username}/profile`, { timeoutMs: 4500 });
                    result = legacyProfile ? normalizeProfile(username, legacyProfile) : null;
                }
                setDirectoryResult(result && (isPhoneSearch || result.discoverable !== false) ? normalizeProfile(username, result) : null);
                setDirectorySearched(true);
            } catch (error) {
                setDirectoryResult(null);
                setDirectoryError(error.message || 'Arama tamamlanamadı.');
            } finally {
                setDirectoryLoading(false);
            }
        }, 350);
        return () => clearTimeout(timer);
    }, [account, searchQuery]);

    const openContactPicker = async () => {
        setShowContacts(true); setContactsLoading(true); setContactsError(''); setContactMatches([]); setInviteContacts([]);
        try {
            let contacts = [];
            let countryIso = '';
            if (Capacitor.isNativePlatform()) {
                const result = await EaryContacts.getContacts();
                contacts = result.contacts || [];
                countryIso = result.countryIso || '';
            } else if (navigator.contacts?.select) {
                const selected = await navigator.contacts.select(['name', 'tel'], { multiple: true });
                contacts = selected.flatMap(contact => (contact.tel || []).map(phone => ({ name: contact.name?.[0] || 'Kişi', phone })));
            } else {
                setContactsError('Bu tarayıcı rehber seçimini desteklemiyor. Telefon numarasını arama alanına yazarak arayabilir veya davet bağlantınızı paylaşabilirsiniz.');
                return;
            }
            const unique = [...new Map(contacts.map(contact => [normalizePhone(contact.phone, countryIso), { ...contact, normalizedPhone: normalizePhone(contact.phone, countryIso) }])).values()].filter(contact => contact.normalizedPhone).slice(0, 500);
            const checked = await Promise.all(unique.map(async contact => {
                const entry = (await get(ref(db, `phoneDirectory/${await phoneLookupKey(contact.normalizedPhone)}`))).val();
                if (!entry?.username || entry.username === account.username) return { contact };
                let profile = (await get(ref(db, `publicProfiles/${entry.username}`))).val();
                if (!profile) {
                    const legacyProfile = (await get(ref(db, `users/${entry.username}/profile`))).val();
                    profile = legacyProfile ? normalizeProfile(entry.username, legacyProfile) : null;
                }
                return profile ? { contact, profile: normalizeProfile(entry.username, profile) } : { contact };
            }));
            setContactMatches([...new Map(checked.filter(item => item.profile).map(item => [item.profile.username, item])).values()]);
            setInviteContacts(checked.filter(item => !item.profile).slice(0, 50));
        } catch (error) {
            setContactsError(error.message || 'Rehber açılamadı.');
        } finally {
            setContactsLoading(false);
        }
    };

    const inviteContact = async contact => {
        const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${account.username}`;
        const text = `${account.nickname} sizi Eary'de konuşmaya davet ediyor: ${inviteUrl}`;
        if (navigator.share) {
            await navigator.share({ title: 'Eary daveti', text, url: inviteUrl }).catch(() => {});
        } else {
            window.location.href = `sms:${contact.normalizedPhone}?body=${encodeURIComponent(text)}`;
        }
    };

    const shareGeneralInvite = async () => {
        const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${account.username}`;
        const text = `${account.nickname} sizi Eary'de konuşmaya davet ediyor.`;
        if (navigator.share) await navigator.share({ title: 'Eary daveti', text, url: inviteUrl }).catch(() => {});
        else {
            await navigator.clipboard.writeText(inviteUrl);
            setToast('Davet bağlantısı kopyalandı');
            setShowContacts(false);
        }
    };

    const sendMessageRequest = async profile => {
        if (!account || requestSendingUsername) return false;
        setRequestSendingUsername(profile.username);
        try {
            const [sentValue, privacyValue, alreadyContact] = await Promise.all([
                getRest(`sentMessageRequests/${account.username}`),
                getRest(`users/${profile.username}/profile/privacy/messageRequests`),
                getRest(`contacts/${account.username}/${profile.username}`)
            ]);
            const sentRequests = Object.values(sentValue || {});
            if (sentRequests.some(request => request.toUsername === profile.username && request.status === 'pending' && request.type !== 'group_invite')) {
                setRequestSentUsername(profile.username);
                setToast('Bu kişiye gönderilmiş bir mesaj isteği zaten bekliyor');
                return false;
            }
            const targetPrivacy = privacyValue || 'everyone';
            if (targetPrivacy === 'nobody') { setToast('Bu kullanıcı mesaj isteği kabul etmiyor'); return false; }
            if (targetPrivacy === 'contacts') {
                const isTargetContact = await getRest(`contacts/${profile.username}/${account.username}`);
                if (!isTargetContact) { setToast('Bu kullanıcı yalnızca kişilerinden istek kabul ediyor'); return false; }
            }

            const roomId = `dm-${[account.username, profile.username].sort().join('-')}`;
            const existingRoom = await getRest(`rooms/${roomId}`);
            const roomPin = existingRoom?.pin || String(Math.floor(100000 + Math.random() * 900000));
            const timestamp = Date.now();
            const roomUpdates = {
                [`rooms/${roomId}/pin`]: roomPin,
                [`rooms/${roomId}/type`]: 'intercom_only',
                [`rooms/${roomId}/members/${account.username}`]: true,
                [`rooms/${roomId}/members/${profile.username}`]: true,
                [`rooms/${roomId}/metadata/kind`]: 'direct',
                [`rooms/${roomId}/metadata/memberCount`]: 2,
                [`rooms/${roomId}/metadata/memberNames/${account.username}`]: account.nickname,
                [`rooms/${roomId}/metadata/memberNames/${profile.username}`]: profile.nickname,
                [`rooms/${roomId}/metadata/createdAt`]: existingRoom?.metadata?.createdAt || timestamp
            };

            if (alreadyContact) {
                const currentHistory = { roomId, roomPin, nickname: account.nickname, role: 'intercom', roomType: 'intercom_only', kind: 'direct', title: profile.nickname, peerUsername: profile.username, timestamp };
                const peerHistory = { roomId, roomPin, nickname: profile.nickname, role: 'intercom', roomType: 'intercom_only', kind: 'direct', title: account.nickname, peerUsername: account.username, timestamp };
                await updateRest({
                    ...roomUpdates,
                    [`users/${account.username}/history/${roomId}`]: currentHistory,
                    [`users/${profile.username}/history/${roomId}`]: peerHistory
                });
                setShowNewRoomForm(false);
                (handleAcceptedRequest || handleSelectHistory)(currentHistory, false);
                return true;
            }

            const requestRef = push(ref(db, `messageRequests/${profile.username}`));
            await updateRest({
                ...roomUpdates,
                [`messageRequests/${profile.username}/${requestRef.key}`]: { fromUsername: account.username, fromNickname: account.nickname, roomId, roomPin, status: 'pending', createdAt: timestamp },
                [`sentMessageRequests/${account.username}/${requestRef.key}`]: { toUsername: profile.username, toNickname: profile.nickname, roomId, status: 'pending', createdAt: timestamp }
            });
            setRequestSentUsername(profile.username);
            setToast('Mesaj isteği gönderildi');
            return true;
        } catch (requestError) {
            console.error('Message request send failed:', requestError);
            setToast('İstek gönderilemedi. Bağlantıyı kontrol edip tekrar deneyin.');
            return false;
        } finally {
            setRequestSendingUsername('');
        }
    };

    const respondToRequest = async (request, accept) => {
        if (requestAction) return;
        setRequestAction({ id: request.id, accept });
        try {
            if (!accept) {
                await updateRest({
                    [`messageRequests/${account.username}/${request.id}`]: null,
                    [`sentMessageRequests/${request.fromUsername}/${request.id}/status`]: 'declined'
                });
                setMessageRequests(current => current.filter(item => item.id !== request.id));
                setToast('İstek reddedildi');
                return;
            }

            if (request.type === 'group_invite') {
                const historyItem = { roomId: request.roomId, roomPin: request.roomPin, nickname: account.nickname, role: 'intercom', roomType: 'intercom_only', kind: 'group', title: request.groupName, timestamp: Date.now() };
                await updateRest({
                    [`messageRequests/${account.username}/${request.id}/status`]: 'accepted',
                    [`sentMessageRequests/${request.fromUsername}/${request.id}/status`]: 'accepted',
                    [`rooms/${request.roomId}/members/${account.username}`]: true,
                    [`rooms/${request.roomId}/metadata/memberNames/${account.username}`]: account.nickname,
                    [`users/${account.username}/history/${request.roomId}`]: historyItem
                });
                const members = await getRest(`rooms/${request.roomId}/members`).catch(() => null);
                if (members) await updateRest({ [`rooms/${request.roomId}/metadata/memberCount`]: Object.keys(members).length }).catch(() => {});
                setMessageRequests(current => current.filter(item => item.id !== request.id));
                handleSelectHistory(historyItem);
                return;
            }

            const recipientHistory = { roomId: request.roomId, roomPin: request.roomPin, nickname: account.nickname, role: 'intercom', roomType: 'intercom_only', kind: 'direct', title: request.fromNickname, peerUsername: request.fromUsername, timestamp: Date.now() };
            const senderHistory = { roomId: request.roomId, roomPin: request.roomPin, nickname: request.fromNickname, role: 'intercom', roomType: 'intercom_only', kind: 'direct', title: account.nickname, peerUsername: account.username, timestamp: Date.now() };
            const acceptedAt = Date.now();
            const systemMessageId = `accepted-${request.id}`;
            const systemMessage = {
                senderName: 'Eary',
                senderUsername: 'system',
                text: `${account.nickname} konuşma isteğini kabul etti.`,
                timestamp: acceptedAt,
                isSystem: true,
                status: 'sent'
            };
            await updateRest({
                [`contacts/${account.username}/${request.fromUsername}`]: true,
                [`contacts/${request.fromUsername}/${account.username}`]: true,
                [`messageRequests/${account.username}/${request.id}`]: null,
                [`sentMessageRequests/${request.fromUsername}/${request.id}/status`]: 'accepted',
                [`rooms/${request.roomId}/members/${account.username}`]: true,
                [`rooms/${request.roomId}/members/${request.fromUsername}`]: true,
                [`rooms/${request.roomId}/messages/${systemMessageId}`]: systemMessage,
                [`rooms/${request.roomId}/lastMessage`]: { id: systemMessageId, ...systemMessage },
                [`users/${account.username}/history/${request.roomId}`]: recipientHistory,
                [`users/${request.fromUsername}/history/${request.roomId}`]: senderHistory,
                [`acceptanceNotices/${request.fromUsername}/${request.id}`]: {
                    status: 'pending',
                    acceptedByUsername: account.username,
                    acceptedByNickname: account.nickname,
                    roomId: request.roomId,
                    historyItem: senderHistory,
                    createdAt: Date.now()
                }
            });
            setMessageRequests(current => current.filter(item => item.id !== request.id));
            (handleAcceptedRequest || handleSelectHistory)(recipientHistory);
        } catch (error) {
            console.error('Message request response failed:', error);
            setToast('İstek işlenemedi. Bağlantıyı kontrol edip tekrar deneyin.');
        } finally {
            setRequestAction(null);
        }
    };

    const createGroup = async (name, profiles) => {
        if (!account || profiles.length < 2) return;
        const roomId = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const roomPin = String(Math.floor(100000 + Math.random() * 900000));
        const timestamp = Date.now();
        const members = { [account.username]: true };
        const updates = {
            [`rooms/${roomId}`]: { pin: roomPin, type: 'intercom_only', members, metadata: { kind: 'group', name, createdBy: account.username, memberCount: 1, memberNames: { [account.username]: account.nickname }, createdAt: timestamp } }
        };
        const currentHistory = { roomId, roomPin, nickname: account.nickname, role: 'intercom', roomType: 'intercom_only', kind: 'group', title: name, timestamp };
        updates[`users/${account.username}/history/${roomId}`] = currentHistory;
        let invitedCount = 0;
        for (const profile of profiles) {
            const privacy = (await get(ref(db, `users/${profile.username}/profile/privacy/groupInvites`))).val() || 'contacts';
            const isContact = (await get(ref(db, `contacts/${profile.username}/${account.username}`))).val();
            if (privacy === 'nobody' || (privacy === 'contacts' && !isContact)) continue;
            const inviteRef = push(ref(db, `messageRequests/${profile.username}`));
            updates[`messageRequests/${profile.username}/${inviteRef.key}`] = { type: 'group_invite', fromUsername: account.username, fromNickname: account.nickname, groupName: name, roomId, roomPin, status: 'pending', createdAt: timestamp };
            updates[`sentMessageRequests/${account.username}/${inviteRef.key}`] = { type: 'group_invite', toUsername: profile.username, toNickname: profile.nickname, groupName: name, roomId, status: 'pending', createdAt: timestamp };
            invitedCount += 1;
        }
        await update(ref(db), updates);
        setShowNewRoomForm(false);
        setToast(invitedCount ? `${invitedCount} grup daveti gönderildi` : 'Grup oluşturuldu; seçilen kişilerin davet ayarları kapalı');
        handleSelectHistory(currentHistory);
    };

    const sortedHistory = [...filteredHistory].sort((a, b) => {
        const favoriteOrder = Number(favoriteRoomIds.includes(b.roomId)) - Number(favoriteRoomIds.includes(a.roomId));
        if (favoriteOrder) return favoriteOrder;
        const lastActivity = item => Number(lastMessages[item.roomId]?.timestamp || item.createdAt || item.timestamp || 0);
        return lastActivity(b) - lastActivity(a);
    });
    const pinnedHistory = sortedHistory.filter(item => favoriteRoomIds.includes(item.roomId));
    const regularHistory = sortedHistory.filter(item => !favoriteRoomIds.includes(item.roomId));
    const unreadCount = history.filter(item => {
        const message = lastMessages[item.roomId];
        return message?.timestamp > (item.timestamp || 0) && message.senderName !== item.nickname;
    }).length;
    const filterItems = [
        { id: 'all', label: text.filterAll },
        { id: 'unread', label: unreadCount ? `${text.filterUnread} ${unreadCount}` : text.filterUnread },
        { id: 'active', label: text.filterActive }
    ];
    const hasAnyConversation = history.length > 0;
    const isFilteredEmpty = hasAnyConversation && filteredHistory.length === 0;
    const emptyTitle = isFilteredEmpty ? text.noResults : text.noChats;
    const emptyText = isFilteredEmpty
        ? 'Arama veya filtreyi temizleyerek tüm sohbetleri görebilirsin.'
        : 'Davet bağlantısıyla birini ekleyin, mesaj isteği gönderin veya test botuyla deneyin.';

    const renderConversationItem = item => {
        const display = chatDisplay(item);
        const enrichedItem = { ...item, title: display.name };
        const hasLoadedLastMessage = hasOwn(lastMessages, item.roomId);
        const message = hasLoadedLastMessage ? lastMessages[item.roomId] : null;
        const onlineCount = presenceData[item.roomId]?.count || 0;
        const unread = message?.timestamp > (item.timestamp || 0) && message.senderName !== item.nickname;
        const preview = hasLoadedLastMessage ? messagePreview(message) : ' ';
        const time = message ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const isMuted = Number(localStorage.getItem(`eary_mute_${item.roomId}`)) === -1;

        return (
            <div
                key={item.roomId}
                className={`relative flex cursor-pointer select-none touch-manipulation items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors active:bg-[var(--soft)] ${selectedChatIds.includes(item.roomId) ? 'eary-brand-soft' : 'hover:bg-[var(--soft)]'}`}
                style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                onClick={() => openChat(enrichedItem)}
                onPointerDown={event => startLongPress(event, item.roomId)}
                onPointerMove={trackLongPress}
                onPointerUp={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onSelectStart={event => event.preventDefault()}
                onContextMenu={event => event.preventDefault()}
            >
                <Avatar name={display.name} online={onlineCount > 0} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <h3 className="min-w-0 flex-1 truncate text-[14px] font-black leading-5">{enrichedItem.title || item.roomId}</h3>
                        {isMuted && <BellOff size={11} className="eary-muted shrink-0" />}
                        {favoriteRoomIds.includes(item.roomId) && <Star size={11} className="eary-brand shrink-0 fill-current" />}
                        <time className={`shrink-0 text-[10px] ${unread ? 'eary-brand font-black' : 'eary-muted'}`}>{time}</time>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                        <span className={`truncate text-[12px] leading-5 ${unread ? 'font-bold text-[var(--text)]' : 'eary-muted'}`}>{message?.senderName && `${message.senderName}: `}{preview}</span>
                        {unread && <span className="eary-brand-bg ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-black">1</span>}
                    </div>
                </div>
            </div>
        );
    };
    if (showNewRoomForm) return <NewConversation account={account} onBack={() => setShowNewRoomForm(false)} onOpenContacts={() => { setShowNewRoomForm(false); openContactPicker(); }} onSendRequest={sendMessageRequest} onCreateGroup={createGroup} />;
    if (homeTab === 'accessibility' && activityDetail) {
        return <ActivityDetailView activity={activityDetail} onBack={returnToPremiumHome} />;
    }
    if (homeTab === 'accessibility' && activeToolView) {
        return <AccessibilityHub account={account} initialView={activeToolView} initialFaceSessionId={activeToolPayload?.faceSessionId || null} onBackHome={returnToPremiumHome} onOpenChats={() => openHomeTab('chats')} onOpenSettings={onOpenSettings} language={language} />;
    }
    if (homeTab === 'accessibility') {
        return (
            <PremiumHome
                activeMode={activeHomeMode}
                setActiveMode={selectHomeMode}
                onLaunchMode={launchHomeMode}
                onOpenChats={() => openHomeTab('chats')}
                onOpenChatItem={openChat}
                onOpenActivity={openHomeActivity}
                onOpenSettings={onOpenSettings}
                recentItems={sortedHistory}
                lastMessages={lastMessages}
                chatDisplay={chatDisplay}
                language={language}
            />
        );
    }

    return (
        <main className="eary-shell eary-line relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[var(--surface)] sm:h-[780px] sm:rounded-xl sm:border sm:shadow-xl">
            {selectedChatIds.length ? <header className="eary-ios-safe-header flex items-center justify-between px-4 pb-3">
                <button type="button" onClick={() => setSelectedChatIds([])} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg" title="Seçimi kapat"><X size={20} /></button>
                <strong className="text-sm">{selectedChatIds.length} sohbet seçildi</strong>
                <div className="flex gap-1">
                    <button type="button" onClick={toggleFavorites} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg" title="Favori"><Star size={19} className={selectedChatIds.every(id => favoriteRoomIds.includes(id)) ? 'fill-current' : ''} /></button>
                    <button type="button" onClick={toggleMute} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg" title="Bildirimleri sessize al"><BellOff size={19} /></button>
                    <button type="button" onClick={deleteSelectedChats} className="eary-soft flex h-10 w-10 items-center justify-center rounded-lg text-rose-600" title="Sil"><Trash2 size={19} /></button>
                </div>
            </header> : <header className="eary-ios-safe-header px-4 pb-3">
                <div className="grid grid-cols-[40px_1fr_40px] items-center">
                    <button type="button" onClick={onOpenSettings} className="eary-muted flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--soft)]" title="Menü"><Menu size={20} /></button>
                    <h1 className="text-center text-[15px] font-black tracking-normal">{text.navChats}</h1>
                    <button type="button" onClick={() => setShowNewRoomForm(true)} className="eary-muted flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--soft)]" title={text.navNew}><MessageSquarePlus size={20} /></button>
                </div>
            </header>}

            <div className="px-6 pb-4">
                <div className="relative"><Search size={14} className="eary-muted absolute left-4 top-2.5" /><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={text.chatSearch} className="eary-input w-full rounded-full border-0 bg-[var(--soft)] py-2 pl-10 pr-9 text-center text-[11px] font-semibold shadow-none" />{searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="eary-muted absolute right-3 top-2"><X size={16} /></button>}</div>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {filterItems.map(filter => (
                        <button
                            key={filter.id}
                            type="button"
                            onClick={() => setActiveFilter(filter.id)}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${activeFilter === filter.id ? 'eary-brand-bg' : 'eary-soft eary-muted'}`}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
            </div>

            {error && <div className="mx-4 mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}

            {messageRequests.length > 0 && <section className="border-y eary-line px-4 py-3"><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold">Davetler ve istekler</h2><span className="eary-brand-soft rounded-full px-2 py-0.5 text-[10px] font-bold">{messageRequests.length}</span></div>{messageRequests.slice(0, 3).map(request => { const isBusy = requestAction?.id === request.id; return <div key={request.id} className="flex items-center gap-3 py-2"><span className="eary-brand-soft flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold">{request.fromNickname?.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{request.type==='group_invite' ? request.groupName : request.fromNickname}</p><p className="eary-muted text-[10px]">{request.type==='group_invite' ? `${request.fromNickname} sizi gruba davet etti` : `${request.fromNickname || 'Bir Eary kullanıcısı'} sohbet etmek istiyor`}</p></div><button type="button" disabled={Boolean(requestAction)} onClick={() => respondToRequest(request, false)} className="eary-soft eary-muted rounded-lg px-2.5 py-2 text-[10px] font-bold disabled:opacity-50">{isBusy && !requestAction.accept ? 'Reddediliyor...' : 'Reddet'}</button><button type="button" disabled={Boolean(requestAction)} onClick={() => respondToRequest(request, true)} className="eary-brand-bg rounded-lg px-2.5 py-2 text-[10px] font-bold disabled:opacity-50">{isBusy && requestAction.accept ? 'Kabul ediliyor...' : 'Kabul et'}</button></div>; })}</section>}

            {(directoryLoading || directoryResult || directoryError || directorySearched) && <section className="border-y eary-line px-4 py-3">{directoryLoading ? <p className="eary-muted text-xs">Davet profili aranıyor…</p> : directoryError ? <p className="text-xs font-semibold text-rose-600">{directoryError}</p> : directoryResult ? <div className="flex items-center gap-3"><span className="eary-brand-soft flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-xs font-bold">{directoryResult.nickname?.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{directoryResult.nickname}</p><p className="eary-muted text-[11px]">Davet profili</p></div><button type="button" disabled={Boolean(requestSendingUsername)||requestSentUsername===directoryResult.username} onClick={() => sendMessageRequest(directoryResult)} className={`flex h-9 min-w-[120px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-bold ${requestSentUsername===directoryResult.username?'eary-soft eary-muted opacity-70':'eary-brand-bg'} disabled:pointer-events-none`}><Send size={14} /> {requestSendingUsername === directoryResult.username ? 'Gönderiliyor' : requestSentUsername===directoryResult.username ? 'İstek gönderildi' : 'İstek gönder'}</button></div> : <p className="eary-muted text-xs">Bu davet profili bulunamadı.</p>}</section>}

            <section className="flex-1 overflow-y-auto px-5 pb-20">
                {filteredHistory.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-10 text-center"><div className="eary-brand-soft mb-4 flex h-16 w-16 items-center justify-center rounded-full"><MessageCircle size={28} /></div><h2 className="font-bold">{emptyTitle}</h2><p className="eary-muted mt-1 text-xs leading-5">{emptyText}</p><div className="mt-5 flex gap-2">{isFilteredEmpty ? <button type="button" onClick={() => { setSearchQuery(''); setActiveFilter('all'); }} className="eary-brand-bg rounded-lg px-4 py-2.5 text-xs font-bold">Filtreyi temizle</button> : <><button type="button" onClick={onOpenTestBot} className="eary-brand-bg rounded-lg px-4 py-2.5 text-xs font-bold">Test botu aç</button><button type="button" onClick={() => setShowNewRoomForm(true)} className="eary-soft eary-brand rounded-lg px-4 py-2.5 text-xs font-bold">Kişi bul</button></>}</div></div>
                ) : (
                    <>
                        {pinnedHistory.length > 0 && (
                            <div className="mb-5">
                                <h2 className="mb-2 px-1 text-[14px] font-black">Sabitlenen sohbetler</h2>
                                <div className="space-y-1">{pinnedHistory.map(renderConversationItem)}</div>
                            </div>
                        )}
                        <div>
                            <h2 className="mb-2 px-1 text-[14px] font-black">{text.allChats}</h2>
                            <div className="space-y-1">{regularHistory.length ? regularHistory.map(renderConversationItem) : <p className="eary-muted px-1 py-3 text-xs">Sabitlenenler dışında sohbet yok.</p>}</div>
                        </div>
                    </>
                )}
            </section>

            <nav className="eary-shell absolute bottom-0 left-0 right-0 grid grid-cols-3 border-t eary-line px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_18px_rgba(0,0,0,0.04)]">
                <button type="button" onClick={returnToPremiumHome} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><Sparkles size={20} />{text.navHome}</button>
                <button type="button" className="eary-brand flex flex-col items-center gap-1 text-[10px] font-bold"><MessageCircle size={20} />{text.navChats}</button>
                <button type="button" onClick={onOpenSettings} className="eary-muted flex flex-col items-center gap-1 text-[10px] font-semibold"><Settings size={20} />{text.navSettings}</button>
            </nav>
            {lockedTarget && <div className="absolute inset-0 z-50 flex items-end bg-black/35" onClick={() => setLockedTarget(null)}><form onSubmit={unlockChat} onClick={event => event.stopPropagation()} className="eary-shell w-full rounded-t-xl p-5 shadow-2xl"><div className="mb-4 flex items-center gap-3"><span className="eary-brand-soft flex h-10 w-10 items-center justify-center rounded-lg"><LockKeyhole size={19} /></span><div><h2 className="font-bold">Sohbet kilitli</h2><p className="eary-muted text-xs">{lockedTarget.roomId} için 4 haneli PIN’i girin.</p></div></div><input value={unlockPin} onChange={event => setUnlockPin(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoFocus className="eary-input w-full rounded-lg border px-3 py-3 text-center text-lg tracking-[0.5em]" placeholder="••••" />{unlockError && <p className="mt-2 text-xs font-semibold text-rose-600">{unlockError}</p>}<button type="submit" disabled={unlockPin.length !== 4} className="eary-brand-bg mt-4 w-full rounded-lg py-3 text-sm font-bold disabled:opacity-40">Sohbeti aç</button></form></div>}
            {showContacts && <div className="absolute inset-0 z-[80] flex items-end bg-black/35" onClick={() => setShowContacts(false)}><section className="eary-shell flex max-h-[82%] w-full flex-col rounded-t-xl shadow-2xl" onClick={event => event.stopPropagation()}><header className="flex items-center justify-between border-b eary-line px-4 py-4"><div><h2 className="font-bold">Rehberden bul</h2><p className="eary-muted text-[10px]">Numaralar gösterilmeden güvenli biçimde eşleştirilir</p></div><button type="button" onClick={() => setShowContacts(false)} className="eary-soft eary-muted flex h-9 w-9 items-center justify-center rounded-lg"><X size={18} /></button></header><div className="flex-1 overflow-y-auto p-4">{contactsLoading && <div className="eary-muted py-10 text-center text-sm">Rehber eşleştiriliyor…</div>}{contactsError && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p>{contactsError}</p><button type="button" onClick={shareGeneralInvite} className="mt-3 rounded-lg bg-amber-100 px-3 py-2 font-bold">Davet bağlantısını paylaş</button></div>}{!contactsLoading && !contactsError && <><h3 className="mb-2 text-xs font-bold">Eary kullananlar ({contactMatches.length})</h3>{contactMatches.length ? contactMatches.map(({ contact, profile }) => <div key={profile.username} className="flex items-center gap-3 border-b eary-line py-3"><span className="eary-brand-soft flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold">{profile.nickname?.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{contact.name}</p><p className="eary-muted text-[10px]">{profile.nickname} · Davet profili</p></div><button type="button" onClick={() => sendMessageRequest(profile)} className="eary-brand-bg flex h-9 items-center gap-1 rounded-lg px-3 text-[10px] font-bold"><UserPlus size={14} /> İstek</button></div>) : <p className="eary-muted py-4 text-xs">Rehberinizde telefonla bulunmayı açmış bir Eary kullanıcısı yok.</p>}<h3 className="mb-2 mt-5 text-xs font-bold">Eary’ye davet et</h3>{inviteContacts.slice(0, 12).map(({ contact }) => <div key={`${contact.name}-${contact.normalizedPhone}`} className="flex items-center gap-3 border-b eary-line py-3"><span className="eary-soft flex h-9 w-9 items-center justify-center rounded-full"><UserRound size={16} /></span><p className="min-w-0 flex-1 truncate text-sm font-semibold">{contact.name}</p><button type="button" onClick={() => inviteContact(contact)} className="eary-soft eary-brand rounded-lg px-3 py-2 text-[10px] font-bold">Davet et</button></div>)}</>}</div></section></div>}
            {toast && <div className="absolute bottom-20 left-1/2 z-[70] -translate-x-1/2 whitespace-nowrap rounded-full bg-[#17221f] px-4 py-2 text-xs font-semibold text-white shadow-xl">{toast}</div>}
        </main>
    );
}
