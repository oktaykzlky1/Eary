import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
    X, ArrowLeft, UserRound, CircleHelp, Bell, Languages, Database, Shield, Smartphone, KeyRound, Lock,
    Type, Moon, Sun, LogOut, ChevronRight, Mic2, ShieldCheck, Trash2, Archive,
    MessageCircle, Check, Eye, EyeOff, LockKeyhole, AtSign,
    Phone, UsersRound, Clock3, CheckCheck, MessageCircleQuestion, Copy, Accessibility, HardDrive
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, getLanguageLabel } from '../utils/language';
import { uiText } from '../utils/i18n';

const VoiceSettings = registerPlugin('VoiceSettings');

function Toggle({ checked, onChange, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={onChange}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'eary-brand-bg' : 'eary-soft border eary-line'}`}
        >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
    );
}

function SettingRow({ icon: Icon, title, description, action, onClick, danger = false, disabled = false }) {
    return (
        <div onClick={disabled || action ? undefined : onClick} className={`eary-row flex w-full items-center gap-3 border-b eary-line px-4 py-3.5 text-left last:border-b-0 ${disabled ? 'opacity-50' : ''}`}>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${danger ? 'bg-rose-50 text-rose-600' : 'eary-brand-soft'}`}><Icon size={18} /></span>
            <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${danger ? 'text-rose-600' : ''}`}>{title}</span>
                {description && <span className="eary-muted mt-0.5 block text-[11px] leading-4">{description}</span>}
            </span>
            {action || (!disabled && <ChevronRight size={17} className="eary-muted" />)}
        </div>
    );
}

function SectionTitle({ children, description }) {
    return (
        <div className="px-4 pb-2 pt-4">
            <p className="text-[10px] font-black uppercase tracking-wide eary-muted">{children}</p>
            {description && <p className="eary-muted mt-1 text-[11px] leading-4">{description}</p>}
        </div>
    );
}

function PrivacyChoice({ icon: Icon, title, description, value, options, onChange }) {
    return (
        <div className="border-b eary-line px-4 py-4">
            <div className="mb-3 flex items-center gap-3"><span className="eary-brand-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"><Icon size={18} /></span><div><p className="text-sm font-semibold">{title}</p><p className="eary-muted text-[11px] leading-4">{description}</p></div></div>
            <div className="eary-soft grid rounded-lg p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>{options.map(option => <button key={option.id} type="button" onClick={() => onChange(option.id)} className={`rounded-md px-1 py-2 text-[10px] font-bold ${value === option.id ? 'eary-shell shadow-sm' : 'eary-muted'}`}>{option.label}</button>)}</div>
        </div>
    );
}

export default function Sidebar({
    isOpen, onClose, account, onLogout, alwaysNotify, onToggleAlwaysNotify,
    onUpdateAccount, language, speechLang, setSpeechLang,
    chatFontSize = 16, setChatFontSize,
    theme = 'light', onToggleTheme, onlineVisibility = 'everyone', setOnlineVisibility, initialSection
}) {
    const [tab, setTab] = useState(initialSection || 'profile');
    const [nickname, setNickname] = useState(account?.nickname || '');
    const [bio, setBio] = useState(account?.profile?.bio || '');
    const [saved, setSaved] = useState(false);
    const [inviteCopied, setInviteCopied] = useState(false);
    const [detailOpen, setDetailOpen] = useState(Boolean(initialSection));
    const [appLock, setAppLock] = useState(() => localStorage.getItem('eary_app_lock') === 'true');
    const [backupChats, setBackupChats] = useState(() => localStorage.getItem('eary_chat_backup') === 'true');
    const [pendingSpeechLang, setPendingSpeechLang] = useState(speechLang);
    const [languageSaved, setLanguageSaved] = useState(false);
    const privacy = account?.profile?.privacy || {};
    const text = uiText(language || speechLang);

    useEffect(() => {
        setNickname(account?.nickname || '');
        setBio(account?.profile?.bio || '');
    }, [account]);
    useEffect(() => {
        setPendingSpeechLang(speechLang);
    }, [speechLang]);
    useEffect(() => {
        if (!isOpen) {
            setDetailOpen(false);
            return;
        }
        if (initialSection) {
            setTab(initialSection);
            setDetailOpen(true);
        }
    }, [initialSection, isOpen]);
    useEffect(() => localStorage.setItem('eary_app_lock', String(appLock)), [appLock]);
    useEffect(() => localStorage.setItem('eary_chat_backup', String(backupChats)), [backupChats]);

    if (!isOpen) return null;

    const saveProfile = () => {
        if (!account) return;
        const nextNickname = nickname.trim() || account.nickname || account.profile?.nickname || 'Eary kullanıcısı';
        onUpdateAccount?.({
            ...account,
            nickname: nextNickname,
            profile: { ...account.profile, nickname: nextNickname, bio: bio.trim() }
        });
        setNickname(nextNickname);
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
    };

    const openNotificationSettings = () => {
        if (Capacitor.getPlatform() === 'android') VoiceSettings.openNotificationSettings().catch(console.error);
    };

    const updatePrivacy = (key, value) => {
        if (!account) return;
        onUpdateAccount?.({ ...account, profile: { ...account.profile, privacy: { ...privacy, [key]: value } } });
        if (key === 'onlineStatus') setOnlineVisibility?.(value === 'nobody' ? 'nobody' : 'everyone');
    };

    const copyInvite = async () => {
        if (!account) return;
        await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?invite=${account.username}`);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 1800);
    };

    const resetInviteProfile = () => {
        if (!window.confirm('Bu cihaz için yeni bir davet profili oluşturulacak. Mevcut davet bağlantınız değişir. Devam edilsin mi?')) return;
        onLogout?.();
        onClose();
    };

    const saveLanguageSettings = () => {
        const nextLanguage = pendingSpeechLang || speechLang;
        setSpeechLang?.(nextLanguage);
        localStorage.setItem('eary_app_language', nextLanguage);
        localStorage.setItem('eary_speech_lang', nextLanguage);
        setLanguageSaved(true);
        window.dispatchEvent(new CustomEvent('eary:toast', { detail: `${getLanguageLabel(nextLanguage)} dili kaydedildi` }));
        setTimeout(() => setLanguageSaved(false), 1800);
    };
    const menuItems = [
        ['profile', UserRound, 'Profilim', account ? 'Davet profili aktif' : 'Profil hazırlanıyor'],
        ['accessibility', Accessibility, 'Dil ve erişim', getLanguageLabel(speechLang)],
        ['privacy', LockKeyhole, 'Gizlilik', 'Bulunabilirlik ve okundu bilgisi'],
        ['notifications', Bell, 'Bildirimler', alwaysNotify ? 'Açık' : 'Kapalı'],
        ['chats', MessageCircle, 'Sohbetler', 'Sohbet davranışı ve geçmiş'],
        ['data', Database, 'Depolama', 'Önbellek ve yedekleme'],
        ['devices', Smartphone, 'Cihazlar', 'Güvenlik kontrolleri'],
        ['help', CircleHelp, 'Yardım', 'Kullanım ve destek']
    ];
    const localizedMenuItems = menuItems.map(([id, Icon, label, description]) => {
        const labels = {
            profile: [text.profile, account ? 'Davet profili aktif' : text.profileGuest],
            accessibility: [text.accessibility, getLanguageLabel(speechLang)],
            privacy: [text.privacy, text.privacyDesc],
            notifications: [text.notifications, alwaysNotify ? text.notificationsOn : text.notificationsOff],
            chats: [text.chats, text.chatsDesc],
            data: [text.data, text.dataDesc],
            devices: [text.devices, text.devicesDesc],
            help: [text.help, text.helpDesc]
        }[id];
        return [id, Icon, labels?.[0] || label, labels?.[1] || description];
    });
    const activeMenuItem = localizedMenuItems.find(([id]) => id === tab) || localizedMenuItems[0];
    const ActiveMenuIcon = activeMenuItem[1];

    return (
        <div className="fixed inset-0 z-[100] flex bg-black/35 backdrop-blur-[2px]">
            <button type="button" aria-label="Menüyü kapat" onClick={onClose} className="absolute inset-0" />
            <aside className="eary-shell animate-slideRight relative flex h-full w-full max-w-md flex-col border-r eary-line shadow-2xl">
                <header className="eary-ios-safe-header flex items-center justify-between border-b eary-line px-4 pb-3">
                    <div className="flex items-center gap-3">
                        <div className="eary-brand-bg flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black">E</div>
                        <div className="min-w-0"><h2 className="truncate text-base font-bold">{text.settingsTitle}</h2><p className="eary-muted truncate text-[11px]">{text.settingsSubtitle}</p></div>
                    </div>
                    <button type="button" onClick={onClose} className="eary-soft eary-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"><X size={19} /></button>
                </header>

                <div className="relative flex-1 overflow-hidden">
                    <div className="h-full overflow-y-auto">
                    <nav className="border-b eary-line px-3 py-2">
                        {localizedMenuItems.map(([id, Icon, label, description]) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => {
                                    setTab(id);
                                    setDetailOpen(true);
                                }}
                                className={`eary-row mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left last:mb-0 ${tab === id ? 'eary-brand-soft' : ''}`}
                            >
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tab === id ? 'eary-brand-bg' : 'eary-soft eary-muted'}`}><Icon size={18} /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-bold">{label}</span>
                                    <span className="eary-muted block truncate text-[11px] leading-4">{description}</span>
                                </span>
                                <ChevronRight size={17} className={tab === id ? 'eary-brand' : 'eary-muted'} />
                            </button>
                        ))}
                    </nav>
                    </div>

                    <section className={`eary-shell absolute inset-0 flex flex-col transition-transform duration-200 ease-out ${detailOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                        <div className="flex items-center gap-3 border-b eary-line px-3 py-3">
                            <button type="button" onClick={() => setDetailOpen(false)} className="eary-soft eary-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" aria-label="Ayarlar menüsüne dön">
                                <ArrowLeft size={20} />
                            </button>
                            <span className="eary-brand-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"><ActiveMenuIcon size={19} /></span>
                            <div className="min-w-0">
                                <h3 className="truncate text-base font-bold">{activeMenuItem[2]}</h3>
                                <p className="eary-muted truncate text-[11px]">{activeMenuItem[3]}</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">

                    {tab === 'profile' && (
                        <div className="p-4">
                            <div className="mb-5 flex items-center gap-3">
                                <div className="eary-brand-soft flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold">
                                    {(account?.nickname || 'M').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0"><p className="truncate font-bold">{account?.nickname || 'Misafir kullanıcı'}</p><p className="eary-muted truncate text-xs">{account ? 'Davet profili aktif' : 'Yerel profil hazırlanıyor'}</p></div>
                            </div>
                            {account ? (
                                <div className="space-y-4">
                                    <label className="block text-xs font-semibold">Görünen ad <span className="eary-muted font-semibold">(isteğe bağlı)</span><input value={nickname} onChange={e => setNickname(e.target.value)} className="eary-input mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm" placeholder="Eary kullanıcısı" /></label>
                                    <label className="block text-xs font-semibold">Hakkımda <span className="eary-muted font-semibold">(isteğe bağlı)</span><textarea value={bio} onChange={e => setBio(e.target.value)} rows="3" className="eary-input mt-1.5 w-full resize-none rounded-lg border px-3 py-2.5 text-sm" placeholder="İsterseniz kısa bir durum yazısı ekleyin" /></label>
                                    <p className="eary-muted -mt-2 text-[10px] leading-4">Bu alanları doldurmak zorunlu değildir. Davet bağlantınız profil bilgisi olmadan da çalışır.</p>
                                    <button type="button" onClick={saveProfile} className="eary-brand-bg flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold">{saved ? <><Check size={17} /> Kaydedildi</> : 'Profili kaydet'}</button>
                                    <button type="button" onClick={copyInvite} className="eary-soft eary-brand flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold"><Copy size={17} />{inviteCopied ? 'Davet bağlantısı kopyalandı' : 'Davet bağlantısını kopyala'}</button>                                </div>
                            ) : (
                                <div className="eary-soft rounded-lg p-3 text-center text-xs font-semibold">Profil hazırlanıyor</div>
                            )}
                        </div>
                    )}
                    {tab === 'accessibility' && (
                        <div className="py-2">
                            <SectionTitle description={text.appLanguageDesc}>{text.accessibility}</SectionTitle>
                            <div className="border-b eary-line px-4 py-3.5">
                                <div className="mb-2 flex items-center gap-3">
                                    <span className="eary-brand-soft flex h-9 w-9 items-center justify-center rounded-lg"><Languages size={18} /></span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold">{text.appLanguage}</p>
                                        <p className="eary-muted text-[11px]">{text.appLanguageDesc}: {getLanguageLabel(pendingSpeechLang || speechLang)}</p>
                                    </div>
                                </div>
                                <select value={pendingSpeechLang || speechLang} onChange={event => setPendingSpeechLang(event.target.value)} className="eary-input w-full rounded-lg border px-3 py-2.5 text-sm">
                                    {SUPPORTED_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
                                </select>
                                <button
                                    type="button"
                                    onClick={saveLanguageSettings}
                                    className="eary-brand-bg mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold disabled:opacity-50"
                                >
                                    {languageSaved ? <><Check size={15} /> Kaydedildi</> : 'Dili kaydet'}
                                </button>
                            </div>
                            <div className="border-b eary-line px-4 py-3.5">
                                <div className="mb-3 flex items-center gap-3"><span className="eary-brand-soft flex h-9 w-9 items-center justify-center rounded-lg"><Type size={18} /></span><div className="flex-1"><p className="text-sm font-semibold">{text.textSize}</p><p className="eary-muted text-[11px]">{chatFontSize}px</p></div></div>
                                <input type="range" min="14" max="28" value={chatFontSize} onChange={event => setChatFontSize?.(Number(event.target.value))} className="w-full accent-[var(--brand)]" />
                            </div>
                            <SettingRow icon={theme === 'dark' ? Sun : Moon} title={theme === 'dark' ? text.lightTheme : text.darkTheme} description={text.appearanceDesc} onClick={onToggleTheme} action={<Toggle checked={theme === 'dark'} onChange={onToggleTheme} label={text.darkTheme} />} />
                        </div>
                    )}

                    {tab === '__legacy_accessibility' && (
                        <div className="py-2">
                            <SectionTitle description="Uygulama dili, konuşma algılama ve erişilebilirlik davranışları.">Dil ve erişilebilirlik</SectionTitle>
                            <div className="border-b eary-line px-4 py-3.5">
                                <div className="mb-2 flex items-center gap-3">
                                    <span className="eary-brand-soft flex h-9 w-9 items-center justify-center rounded-lg"><Languages size={18} /></span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold">Uygulama ve konuşma dili</p>
                                        <p className="eary-muted text-[11px]">Menüler ve mikrofon algılama dili: {getLanguageLabel(speechLang)}</p>
                                    </div>
                                </div>
                                <select value={speechLang} onChange={e => setSpeechLang?.(e.target.value)} className="eary-input w-full rounded-lg border px-3 py-2.5 text-sm">
                                    {SUPPORTED_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.nativeLabel}</option>)}
                                </select>
                            </div>
                            <div className="border-b eary-line px-4 py-3.5">
                                <div className="mb-3 flex items-center gap-3"><span className="eary-brand-soft flex h-9 w-9 items-center justify-center rounded-lg"><Type size={18} /></span><div className="flex-1"><p className="text-sm font-semibold">Yazı boyutu</p><p className="eary-muted text-[11px]">{chatFontSize}px</p></div></div>
                                <input type="range" min="14" max="28" value={chatFontSize} onChange={e => setChatFontSize?.(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
                            </div>
                            <SettingRow icon={theme === 'dark' ? Sun : Moon} title={theme === 'dark' ? 'Açık tema' : 'Koyu tema'} description="Uygulama görünümünü değiştir" onClick={onToggleTheme} action={<Toggle checked={theme === 'dark'} onChange={onToggleTheme} label="Koyu tema" />} />
                        </div>
                    )}

                    {tab === 'notifications' && (
                        <div className="py-2">
                            <SectionTitle description="Mesaj, grup ve erişim uyarılarının cihazda nasıl görüneceği.">Bildirimler</SectionTitle>
                            <SettingRow icon={Bell} title="Anlık mesaj bildirimleri" description="Yeni mesajları kilit ekranında göster" onClick={onToggleAlwaysNotify} action={<Toggle checked={alwaysNotify} onChange={onToggleAlwaysNotify} label="Bildirimler" />} />
                            <SettingRow icon={MessageCircle} title="Sohbet bildirimleri" description="Bireysel ve grup mesajları için varsayılan bildirim" disabled />
                            <SettingRow icon={Eye} title="Önizleme göster" description="Kilit ekranında mesaj metnini göster/gizle" disabled />
                            {Capacitor.getPlatform() === 'android' && <SettingRow icon={ShieldCheck} title="Android bildirim izinleri" description="Sistem izinlerini ve kilit ekranını yönet" onClick={openNotificationSettings} />}
                        </div>
                    )}

                    {tab === 'chats' && (
                        <div className="py-2">
                            <SectionTitle description="Sohbet ekranı ve konuşma geçmişi ayarları.">Sohbetler</SectionTitle>
                            <SettingRow icon={MessageCircle} title="Chat ekranı" description="Mesaj balonları, cevaplama ve tepki özellikleri aktif" disabled />
                            <SettingRow icon={Archive} title="Arşivlenen sohbetler" description="Arşiv ekranı sonraki sürümde eklenecek" disabled />
                            <SettingRow icon={CheckCheck} title="Okundu bilgisi" description="Ayar Gizlilik bölümünden yönetilir" onClick={() => setTab('privacy')} />
                        </div>
                    )}

                    {tab === 'data' && (
                        <div className="py-2">
                            <SectionTitle description="Önbellek ve yedekleme alanı.">Depolama ve veri</SectionTitle>
                            <SettingRow icon={HardDrive} title="Depolama kullanımı" description="Önbellek boyutu hesaplama eklenecek" disabled />
                            <SettingRow icon={Trash2} title="Önbelleği temizle" description="Geçici yerel verileri temizler" onClick={() => { localStorage.removeItem('eary_caption_sessions'); localStorage.removeItem('eary_environment_events'); }} />
                            <SettingRow icon={Database} title="Sohbet yedeği" description="Bu cihazda yerel yedekleme tercihi" action={<Toggle checked={backupChats} onChange={() => setBackupChats(value => !value)} label="Sohbet yedeği" />} />
                            <SettingRow icon={HardDrive} title="Veri kullanımı" description="Ağ kullanımı raporu sonraki sürümde eklenecek" disabled />
                        </div>
                    )}

                    {tab === 'devices' && (
                        <div className="py-2">
                            <SectionTitle description="Aktif cihazlar, uygulama kilidi ve güvenlik kontrolleri.">Cihazlar ve güvenlik</SectionTitle>
                            <SettingRow icon={Smartphone} title="Bu cihaz" description={`${Capacitor.getPlatform()} cihazında aktif oturum`} disabled />
                            <SettingRow icon={Lock} title="Uygulama kilidi" description="Eary açılırken cihaz kilidi isteme tercihi" action={<Toggle checked={appLock} onChange={() => setAppLock(value => !value)} label="Uygulama kilidi" />} />
                            <SettingRow icon={KeyRound} title="Aktif oturumlar" description="Bağlı cihaz yönetimi sonraki sürümde eklenecek" disabled />
                            <SettingRow icon={Shield} title="Güvenlik kontrolü" description="Dil, mikrofon, bildirim ve gizlilik ayarlarını gözden geçir" onClick={() => setTab('privacy')} />
                            <SettingRow icon={LogOut} title={text.logout} description={text.logoutDesc} danger onClick={resetInviteProfile} />
                        </div>
                    )}

                    {tab === 'privacy' && (
                        <div className="py-2">
                            {!account && <div className="mx-4 my-4 rounded-lg border eary-line p-4 text-center"><LockKeyhole size={22} className="eary-brand mx-auto" /><p className="mt-2 text-sm font-semibold">Davet profili hazırlanıyor</p></div>}
                            {account && <>
                                <div className="px-4 pb-3 pt-4"><p className="text-sm font-bold">Bulunabilirlik</p><p className="eary-muted mt-1 text-[11px]">İletişim bilgileriniz hiçbir zaman profilinizde gösterilmez.</p></div>
                                <PrivacyChoice icon={AtSign} title="Davet profiliyle bulunma" description="İnsanlar davet bağlantınızla veya görünen adınızla sizi bulabilir mi?" value={privacy.discoverByUsername || 'everyone'} options={[{id:'everyone',label:'Herkes'},{id:'nobody',label:'Hiç kimse'}]} onChange={value => updatePrivacy('discoverByUsername', value)} />
                                <PrivacyChoice icon={Phone} title="Telefonla bulunma" description="Tam numaranızı bilenler sizi Eary’de bulabilir mi? Numaranız gösterilmez." value={privacy.discoverByPhone || 'nobody'} options={[{id:'contacts',label:'Numaramı bilenler'},{id:'nobody',label:'Hiç kimse'}]} onChange={value => updatePrivacy('discoverByPhone', value)} />
                                <p className="eary-muted px-4 pb-2 pt-5 text-[10px] font-bold uppercase">Profil ve durum</p>
                                <PrivacyChoice icon={onlineVisibility === 'nobody' ? EyeOff : Eye} title="Çevrimiçi bilgisi" description="Sohbetlerde çevrimiçi olduğunuzu kim görebilir?" value={privacy.onlineStatus || (onlineVisibility === 'nobody' ? 'nobody' : 'everyone')} options={[{id:'everyone',label:'Herkes'},{id:'nobody',label:'Hiç kimse'}]} onChange={value => updatePrivacy('onlineStatus', value)} />
                                <PrivacyChoice icon={Clock3} title="Son görülme" description="Son etkinlik zamanınızı kim görebilir?" value={privacy.lastSeen || 'contacts'} options={[{id:'everyone',label:'Herkes'},{id:'contacts',label:'Kişilerim'},{id:'nobody',label:'Hiç kimse'}]} onChange={value => updatePrivacy('lastSeen', value)} />
                                <p className="eary-muted px-4 pb-2 pt-5 text-[10px] font-bold uppercase">İletişim izinleri</p>
                                <PrivacyChoice icon={MessageCircleQuestion} title="Mesaj istekleri" description="Tanımadığınız kişiler size istek gönderebilir mi?" value={privacy.messageRequests || 'everyone'} options={[{id:'everyone',label:'Herkes'},{id:'contacts',label:'Kişilerim'},{id:'nobody',label:'Hiç kimse'}]} onChange={value => updatePrivacy('messageRequests', value)} />
                                <PrivacyChoice icon={UsersRound} title="Gruplara ekleme" description="Sizi kimler bir gruba ekleyebilir?" value={privacy.groupInvites || 'contacts'} options={[{id:'everyone',label:'Herkes'},{id:'contacts',label:'Kişilerim'},{id:'nobody',label:'Hiç kimse'}]} onChange={value => updatePrivacy('groupInvites', value)} />
                                <SettingRow icon={CheckCheck} title="Okundu bilgisi" description="Mesajları okuduğunuz karşı tarafa gösterilsin" action={<Toggle checked={privacy.readReceipts !== false} onChange={() => updatePrivacy('readReceipts', privacy.readReceipts === false)} label="Okundu bilgisi" />} />
                                <div className="px-4 py-4"><div className="flex gap-3"><ShieldCheck size={19} className="eary-brand shrink-0" /><p className="eary-muted text-xs leading-5">Davet bağlantınız dışında profilinizde özel iletişim bilgisi gösterilmez.</p></div></div>
                            </>}
                        </div>
                    )}

                    {tab === 'help' && (
                        <div className="space-y-6 p-5 text-sm leading-6">
                            <section><div className="mb-2 flex items-center gap-2 font-bold"><MessageCircle size={18} className="eary-brand" /> Mesajlaşma</div><p className="eary-muted">Mesaja uzun basarak cevaplayabilir, iletebilir, düzenleyebilir, kopyalayabilir veya silebilirsiniz. Tek dokunuş tepki menüsünü açar.</p></section>
                            <section><div className="mb-2 flex items-center gap-2 font-bold"><Mic2 size={18} className="eary-brand" /> Konuşmadan metne</div><p className="eary-muted">Mikrofon düğmesine basın, konuşun ve tekrar basarak kaydı tamamlayın. Metin odaya mesaj olarak gönderilir.</p></section>
                            <section><div className="mb-2 flex items-center gap-2 font-bold"><ShieldCheck size={18} className="eary-brand" /> Gizlilik</div><p className="eary-muted">Oda PIN’inizi yalnızca güvendiğiniz kişilerle paylaşın. Mesajlar oda katılımcıları tarafından görüntülenebilir.</p></section>
                        </div>
                    )}
                        </div>
                    </section>
                </div>

                <footer className="border-t eary-line p-3">
                    <p className="eary-muted px-3 pt-2 text-[10px]">Eary 2.0</p>
                </footer>
            </aside>
        </div>
    );
}
