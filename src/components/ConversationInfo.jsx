import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, Bell, BellOff, Camera, Check, ChevronRight,
    Image as ImageIcon, LockKeyhole, MessageSquareX, Palette, ShieldCheck,
    UserRound, UsersRound, X
} from 'lucide-react';
import { db, storage, ref, onValue, update, storageRef, uploadBytesResumable, getDownloadURL } from '../firebase';
import { getDeviceId } from '../utils/pushNotifications';
import { sha256Hex } from '../utils/hash';

const THEMES = [
    { id: 'green', label: 'Yeşil', color: '#176b5b' },
    { id: 'blue', label: 'Mavi', color: '#316fa8' },
    { id: 'purple', label: 'Mor', color: '#7651a8' },
    { id: 'rose', label: 'Gül', color: '#a94f68' }
];

const hashPin = async (roomId, pin) => {
    return sha256Hex(`eary-lock:${roomId}:${pin}`);
};

export default function ConversationInfo({ roomId, members, messages, nickname, displayTitle, directConversation = false, onClose, chatTheme, setChatTheme, onClearChat }) {
    const [metadata, setMetadata] = useState({});
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [muteUntil, setMuteUntil] = useState(() => Number(localStorage.getItem(`eary_mute_${roomId}`) || 0));
    const [showMuteOptions, setShowMuteOptions] = useState(false);
    const [showThemes, setShowThemes] = useState(false);
    const [lockEnabled, setLockEnabled] = useState(() => Boolean(localStorage.getItem(`eary_chat_lock_${roomId}`)));
    const [showLockSetup, setShowLockSetup] = useState(false);
    const [lockPin, setLockPin] = useState('');
    const [lockError, setLockError] = useState('');
    const photoInputRef = useRef(null);

    useEffect(() => onValue(ref(db, `rooms/${roomId}/metadata`), snapshot => {
        const value = snapshot.val() || {};
        setMetadata(value);
        setNameDraft(value.name || '');
    }), [roomId]);

    const participants = useMemo(() => {
        const names = new Map();
        members.forEach(member => {
            if (!directConversation || member.nickname !== 'Karşı taraf') names.set(member.nickname, member);
        });
        messages.forEach(message => {
            if (message.senderName && (!directConversation || message.senderName !== 'Karşı taraf') && !names.has(message.senderName)) names.set(message.senderName, { nickname: message.senderName });
        });
        if (!names.has(nickname)) names.set(nickname, { nickname });
        return [...names.values()];
    }, [members, messages, nickname, directConversation]);

    const isGroup = !directConversation && (metadata.kind === 'group' || participants.length > 2);
    const otherPerson = participants.find(person => person.nickname !== nickname);
    const displayName = directConversation
        ? (displayTitle || otherPerson?.nickname || 'Sohbet')
        : (metadata.name || (isGroup ? participants.map(person => person.nickname).join(', ') : (otherPerson?.nickname || 'Sohbet')));
    const media = messages.filter(message => message.mediaUrl);

    const saveName = async () => {
        if (!nameDraft.trim()) return;
        await update(ref(db, `rooms/${roomId}/metadata`), { name: nameDraft.trim(), updatedAt: Date.now() });
        setEditingName(false);
    };

    const uploadGroupPhoto = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setUploadingPhoto(true);
        try {
            const target = storageRef(storage, `roomPhotos/${roomId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
            const task = uploadBytesResumable(target, file, { contentType: file.type });
            const snapshot = await new Promise((resolve, reject) => task.on('state_changed', undefined, reject, () => resolve(task.snapshot)));
            const photoUrl = await getDownloadURL(snapshot.ref);
            await update(ref(db, `rooms/${roomId}/metadata`), { photoUrl, updatedAt: Date.now() });
        } finally {
            setUploadingPhoto(false);
        }
    };

    const setMute = async value => {
        const until = value === 'always' ? -1 : value === 'week' ? Date.now() + 7 * 86400000 : value === '8h' ? Date.now() + 8 * 3600000 : 0;
        setMuteUntil(until);
        localStorage.setItem(`eary_mute_${roomId}`, String(until));
        await update(ref(db, `rooms/${roomId}/pushTokens/${getDeviceId()}`), { mutedUntil: until });
        setShowMuteOptions(false);
    };

    const saveLock = async () => {
        if (!/^\d{4}$/.test(lockPin)) {
            setLockError('4 haneli bir PIN girin.');
            return;
        }
        localStorage.setItem(`eary_chat_lock_${roomId}`, await hashPin(roomId, lockPin));
        setLockEnabled(true);
        setShowLockSetup(false);
        setLockPin('');
        setLockError('');
    };

    const disableLock = () => {
        localStorage.removeItem(`eary_chat_lock_${roomId}`);
        setLockEnabled(false);
    };

    const mutedLabel = muteUntil === -1 ? 'Her zaman sessizde' : muteUntil > Date.now() ? 'Geçici olarak sessizde' : 'Açık';
    const closeInfo = event => {
        if (event?.type === 'touchend') event.preventDefault();
        onClose();
    };

    return (
        <div className="eary-shell fixed inset-0 z-[105] mx-auto flex max-w-md flex-col overflow-hidden sm:my-4 sm:h-[calc(100vh-2rem)] sm:rounded-xl sm:border sm:eary-line sm:shadow-2xl">
            <header className="eary-ios-safe-header relative z-10 flex shrink-0 items-center gap-3 border-b eary-line px-4 pb-3">
                <button type="button" onClick={closeInfo} onTouchEnd={closeInfo} className="eary-soft eary-muted flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-lg" aria-label="Sohbete geri dön">
                    <ArrowLeft size={22} />
                </button>
                <div className="min-w-0"><h1 className="truncate text-base font-bold">Sohbet bilgisi</h1><p className="eary-muted text-[10px]">{isGroup ? 'Grup ayarları' : 'Kişi ve sohbet ayarları'}</p></div>
            </header>
            <div className="flex-1 overflow-y-auto pb-8">
                <section className="flex flex-col items-center border-b eary-line px-5 py-6 text-center">
                    <input ref={photoInputRef} type="file" accept="image/*" onChange={uploadGroupPhoto} className="hidden" />
                    <button type="button" onClick={() => isGroup && photoInputRef.current?.click()} className="eary-brand-soft relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full text-2xl font-black">
                        {metadata.photoUrl ? <img src={metadata.photoUrl} alt={displayName} className="h-full w-full object-cover" /> : isGroup ? <UsersRound size={36} /> : <UserRound size={36} />}
                        {isGroup && <span className="eary-brand-bg absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--surface)]">{uploadingPhoto ? '…' : <Camera size={14} />}</span>}
                    </button>
                    {editingName && isGroup ? <div className="mt-4 flex w-full gap-2"><input value={nameDraft} onChange={event => setNameDraft(event.target.value)} className="eary-input min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" autoFocus /><button type="button" onClick={saveName} className="eary-brand-bg flex h-10 w-10 items-center justify-center rounded-lg"><Check size={18} /></button><button type="button" onClick={() => setEditingName(false)} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg"><X size={18} /></button></div> : <button type="button" onClick={() => isGroup && setEditingName(true)} className="mt-4 max-w-full truncate text-lg font-bold">{displayName}</button>}
                    <p className="eary-muted mt-1 text-xs">{isGroup ? `${metadata.memberCount || participants.length} katılımcı · ${members.length} çevrimiçi` : members.some(member => member.nickname === otherPerson?.nickname) ? 'Çevrimiçi' : 'Çevrimdışı'}</p>
                </section>

                <section className="border-b eary-line py-3">
                    <div className="flex items-center justify-between px-4 pb-3"><div><h2 className="text-sm font-bold">Medya, bağlantı ve belgeler</h2><p className="eary-muted text-[10px]">{media.length} öğe</p></div><ChevronRight size={18} className="eary-muted" /></div>
                    {media.length ? <div className="flex gap-2 overflow-x-auto px-4">{media.slice(-8).reverse().map(item => item.mediaType === 'video' ? <video key={item.id} src={item.mediaUrl} className="h-20 w-20 shrink-0 rounded-lg bg-black object-cover" /> : <img key={item.id} src={item.mediaUrl} alt="Sohbet medyası" className="h-20 w-20 shrink-0 rounded-lg object-cover" />)}</div> : <div className="eary-muted flex items-center gap-2 px-4 text-xs"><ImageIcon size={17} /> Henüz medya paylaşılmadı</div>}
                </section>

                <section className="border-b eary-line">
                    <button type="button" onClick={() => setShowMuteOptions(value => !value)} className="eary-row flex w-full items-center gap-3 px-4 py-4 text-left"><span className="eary-brand-soft flex h-9 w-9 items-center justify-center rounded-lg">{muteUntil === -1 || muteUntil > Date.now() ? <BellOff size={18} /> : <Bell size={18} />}</span><span className="flex-1"><span className="block text-sm font-semibold">Bildirimler</span><span className="eary-muted text-[11px]">{mutedLabel}</span></span><ChevronRight size={18} className="eary-muted" /></button>
                    {showMuteOptions && <div className="eary-soft mx-4 mb-4 grid grid-cols-2 gap-2 rounded-lg p-2">{[['8h','8 saat'],['week','1 hafta'],['always','Her zaman'],['off','Sesi aç']].map(([id,label]) => <button key={id} type="button" onClick={() => setMute(id)} className="eary-shell rounded-md py-2 text-xs font-semibold shadow-sm">{label}</button>)}</div>}
                    <button type="button" onClick={() => setShowThemes(value => !value)} className="eary-row flex w-full items-center gap-3 border-t eary-line px-4 py-4 text-left"><span className="eary-brand-soft flex h-9 w-9 items-center justify-center rounded-lg"><Palette size={18} /></span><span className="flex-1"><span className="block text-sm font-semibold">Sohbet teması</span><span className="eary-muted text-[11px]">Balon ve vurgu rengini değiştir</span></span><ChevronRight size={18} className="eary-muted" /></button>
                    {showThemes && <div className="flex gap-4 px-5 pb-4">{THEMES.map(item => <button key={item.id} type="button" onClick={() => setChatTheme(item.id)} className="flex flex-col items-center gap-1 text-[10px]"><span className={`h-8 w-8 rounded-full border-2 ${chatTheme === item.id ? 'border-[var(--text)]' : 'border-transparent'}`} style={{ background: item.color }} />{item.label}</button>)}</div>}
                </section>

                <section className="border-b eary-line">
                    <div className="flex items-center gap-3 px-4 py-4"><span className="eary-brand-soft flex h-9 w-9 items-center justify-center rounded-lg"><LockKeyhole size={18} /></span><span className="flex-1"><span className="block text-sm font-semibold">Sohbet kilidi</span><span className="eary-muted text-[11px]">Bu cihazda 4 haneli PIN ile koru</span></span><button type="button" role="switch" aria-checked={lockEnabled} onClick={() => lockEnabled ? disableLock() : setShowLockSetup(true)} className={`relative h-6 w-11 rounded-full ${lockEnabled ? 'eary-brand-bg' : 'eary-soft border eary-line'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${lockEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} /></button></div>
                    {showLockSetup && <div className="eary-soft mx-4 mb-4 rounded-lg p-3"><p className="mb-2 text-xs font-semibold">Yeni sohbet PIN’i</p><div className="flex gap-2"><input value={lockPin} onChange={event => setLockPin(event.target.value.replace(/\D/g, '').slice(0,4))} inputMode="numeric" type="password" className="eary-input min-w-0 flex-1 rounded-lg border px-3 py-2 text-center tracking-[0.5em]" placeholder="••••" /><button type="button" onClick={saveLock} className="eary-brand-bg rounded-lg px-4 text-xs font-bold">Kaydet</button></div>{lockError && <p className="mt-2 text-[10px] text-rose-600">{lockError}</p>}</div>}
                </section>

                <section className="py-2">
                    <div className="flex items-start gap-3 px-4 py-4"><ShieldCheck size={19} className="eary-brand mt-0.5 shrink-0" /><div><p className="text-sm font-semibold">Yalnız sohbet üyelerine açık</p><p className="eary-muted mt-1 text-[11px] leading-4">Mesajlar Firebase üzerinden iletilir. Uçtan uca şifreleme henüz etkin değildir.</p></div></div>
                    <button type="button" onClick={onClearChat} className="flex w-full items-center gap-3 px-4 py-4 text-left text-rose-600"><MessageSquareX size={19} /><span><span className="block text-sm font-semibold">Sohbeti temizle</span><span className="block text-[11px] opacity-70">Mesajları yalnızca bu cihazda gizle</span></span></button>
                </section>

                {isGroup && <section className="border-t eary-line px-4 py-4"><h2 className="mb-3 text-sm font-bold">{participants.length} katılımcı</h2><div className="space-y-3">{participants.map(person => <div key={person.nickname} className="flex items-center gap-3"><span className="eary-brand-soft flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold">{person.nickname.slice(0,2).toUpperCase()}</span><span className="flex-1 text-sm font-semibold">{person.nickname}{person.nickname === nickname && <span className="eary-muted ml-1 text-[10px]">(siz)</span>}</span>{members.some(member => member.nickname === person.nickname) && <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />}</div>)}</div></section>}
            </div>
        </div>
    );
}
