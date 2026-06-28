import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, AtSign, BookUser, Check, Search, Send, UserPlus, UsersRound, X
} from 'lucide-react';
import { getRest } from '../firebase';

function ProfileAvatar({ profile, selected = false }) {
    return (
        <span className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-black ${selected ? 'eary-brand-bg' : 'eary-brand-soft'}`}>
            {profile.photo ? <img src={profile.photo} alt="" className="h-full w-full object-cover" /> : profile.nickname?.slice(0, 2).toUpperCase()}
            {selected && <span className="absolute inset-0 flex items-center justify-center bg-black/25"><Check size={18} /></span>}
        </span>
    );
}

const normalizeProfile = (username, profile = {}) => ({
    username: profile.username || username,
    nickname: profile.nickname || username,
    photo: profile.photo || '',
    bio: profile.bio || '',
    discoverable: profile.discoverable ?? profile.privacy?.discoverByUsername !== 'nobody'
});

export default function NewConversation({ account, onBack, onRequireLogin, onOpenContacts, onSendRequest, onCreateGroup }) {
    const [mode, setMode] = useState('person');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [searchedTerm, setSearchedTerm] = useState('');
    const [retryCount, setRetryCount] = useState(0);
    const [selected, setSelected] = useState([]);
    const [groupName, setGroupName] = useState('');
    const [creating, setCreating] = useState(false);
    const [sendingUsername, setSendingUsername] = useState('');
    const [sentUsername, setSentUsername] = useState('');
    const [requestFeedback, setRequestFeedback] = useState('');
    const searchRunRef = useRef(0);

    const handleBack = event => {
        event?.preventDefault?.();
        setQuery('');
        setResults([]);
        setLoading(false);
        setSearchError('');
        onBack?.();
    };

    useEffect(() => {
        const term = query.trim().replace(/^@/, '').toLocaleLowerCase('tr-TR');
        const runId = searchRunRef.current + 1;
        searchRunRef.current = runId;
        setSearchError('');
        if (!account || term.length < 2) {
            setResults([]);
            setLoading(false);
            setSearchedTerm('');
            return undefined;
        }
        setLoading(true);
        setSearchedTerm(term);
        const timer = setTimeout(async () => {
            try {
                const [exactPublicProfile, exactLegacyProfile] = await Promise.all([
                    getRest(`publicProfiles/${term}`, { timeoutMs: 4500 }),
                    getRest(`users/${term}/profile`, { timeoutMs: 4500 })
                ]);
                if (searchRunRef.current !== runId) return;
                const exactProfiles = exactPublicProfile ? [normalizeProfile(term, exactPublicProfile)] : [];
                const userProfiles = exactLegacyProfile ? [normalizeProfile(term, exactLegacyProfile)] : [];
                let publicProfiles = [];
                if (!exactProfiles.length && !userProfiles.length) {
                    const publicValue = await getRest('publicProfiles', { timeoutMs: 4500 });
                    publicProfiles = Object.entries(publicValue || {}).map(([username, profile]) => normalizeProfile(username, profile));
                }
                const profiles = [...new Map([...exactProfiles, ...userProfiles, ...publicProfiles].map(profile => [profile.username, profile])).values()];
                const matches = profiles
                    .filter(profile => profile.username !== account.username && profile.discoverable !== false)
                    .filter(profile => profile.username?.toLocaleLowerCase('tr-TR').includes(term) || profile.nickname?.toLocaleLowerCase('tr-TR').includes(term))
                    .slice(0, 20);
                setResults(matches);
                setSearchError('');
            } catch (error) {
                if (searchRunRef.current !== runId) return;
                setResults([]);
                setSearchError(error.message || 'Arama tamamlanamadı.');
            } finally {
                if (searchRunRef.current === runId) setLoading(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [account, query, retryCount]);

    const toggleSelected = profile => {
        setSelected(current => current.some(item => item.username === profile.username)
            ? current.filter(item => item.username !== profile.username)
            : [...current, profile]);
    };

    const createGroup = async () => {
        if (creating || !groupName.trim() || selected.length < 2) return;
        setCreating(true);
        try {
            await onCreateGroup(groupName.trim(), selected);
        } finally {
            setCreating(false);
        }
    };

    const sendRequest = async profile => {
        if (sendingUsername) return;
        setSendingUsername(profile.username);
        setRequestFeedback('');
        try {
            const sent = await onSendRequest(profile);
            if (sent) {
                setSentUsername(profile.username);
                setRequestFeedback('Mesaj isteği gönderildi');
            }
        } finally {
            setSendingUsername('');
        }
    };

    useEffect(() => {
        if (!requestFeedback) return undefined;
        const timer = setTimeout(() => setRequestFeedback(''), 2000);
        return () => clearTimeout(timer);
    }, [requestFeedback]);

    if (!account) return (
        <main className="eary-shell eary-line mx-auto flex h-screen w-full max-w-md flex-col sm:h-[780px] sm:rounded-xl sm:border">
            <header className="eary-ios-safe-header flex items-center gap-3 border-b eary-line px-4 pb-3"><button type="button" onClick={handleBack} onTouchEnd={handleBack} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg"><ArrowLeft size={20} /></button><h1 className="font-bold">Yeni sohbet</h1></header>
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><span className="eary-brand-soft flex h-16 w-16 items-center justify-center rounded-full"><AtSign size={27}/></span><h2 className="mt-4 text-lg font-bold">Kişileri bulmak için giriş yapın</h2><p className="eary-muted mt-2 text-xs leading-5">Kullanıcı adınız kimliğinizdir. E-posta adresiniz aramalarda görünmez.</p><button type="button" onClick={onRequireLogin} className="eary-brand-bg mt-5 rounded-lg px-6 py-3 text-sm font-bold">Giriş yap veya hesap oluştur</button></div>
        </main>
    );

    return (
        <main className="eary-shell eary-line mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden sm:h-[780px] sm:rounded-xl sm:border sm:shadow-xl">
            <header className="eary-ios-safe-header flex items-center gap-3 border-b eary-line px-4 pb-3"><button type="button" onClick={handleBack} onTouchEnd={handleBack} className="eary-soft eary-muted flex h-10 w-10 items-center justify-center rounded-lg"><ArrowLeft size={20} /></button><div><h1 className="font-bold">Yeni sohbet</h1><p className="eary-muted text-[10px]">Kullanıcı adı veya görünen adla bulun</p></div></header>
            <div className="p-4 pb-2">
                <div className="eary-soft grid grid-cols-2 rounded-lg p-1"><button type="button" onClick={()=>{setMode('person');setSelected([]);}} className={`rounded-md py-2.5 text-xs font-bold ${mode==='person'?'eary-shell shadow-sm':'eary-muted'}`}>Kişi bul</button><button type="button" onClick={()=>setMode('group')} className={`rounded-md py-2.5 text-xs font-bold ${mode==='group'?'eary-shell shadow-sm':'eary-muted'}`}>Grup oluştur</button></div>
                {mode==='group' && <input value={groupName} onChange={event=>setGroupName(event.target.value)} className="eary-input mt-3 w-full rounded-lg border px-3 py-3 text-sm" placeholder="Grup adı" maxLength={60}/>}                
                <div className="relative mt-3"><Search size={18} className="eary-muted absolute left-3 top-3"/><input value={query} onChange={event=>setQuery(event.target.value)} autoFocus className="eary-input w-full rounded-lg border py-2.5 pl-10 pr-9 text-sm" placeholder="@kullanıcıadı veya ad yazın"/>{query&&<button type="button" onClick={()=>setQuery('')} className="eary-muted absolute right-3 top-2.5"><X size={18}/></button>}</div>
                {mode==='person' && <button type="button" onClick={onOpenContacts} className="eary-soft eary-brand mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left"><BookUser size={19}/><span><span className="block text-xs font-bold">Telefon rehberinden bul</span><span className="eary-muted block text-[9px]">Numaralar profilde gösterilmez</span></span></button>}
                {mode==='group' && selected.length>0 && <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{selected.map(profile=><button key={profile.username} type="button" onClick={()=>toggleSelected(profile)} className="eary-brand-soft flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-bold">{profile.nickname}<X size={12}/></button>)}</div>}
            </div>
            <section className="flex-1 overflow-y-auto px-4 pb-24">
                {loading && <p className="eary-muted py-8 text-center text-xs">"{searchedTerm}" aranıyor…</p>}
                {!loading && searchError && <div className="py-10 text-center"><p className="text-xs font-semibold text-rose-600">{searchError}</p><button type="button" onClick={()=>setRetryCount(value=>value+1)} className="eary-brand-soft mt-3 rounded-lg px-4 py-2 text-xs font-bold">Tekrar dene</button></div>}
                {requestFeedback && <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700">{requestFeedback}</p>}
                {!loading && query.trim().length<2 && <div className="flex h-full flex-col items-center justify-center px-8 text-center"><span className="eary-brand-soft flex h-16 w-16 items-center justify-center rounded-full">{mode==='group'?<UsersRound size={27}/>:<UserPlus size={27}/>}</span><h2 className="mt-4 font-bold">{mode==='group'?'Gruba kişi ekleyin':'Konuşmak istediğiniz kişiyi bulun'}</h2><p className="eary-muted mt-1 text-xs leading-5">E-posta adresleri gizlidir ve aramada kullanılmaz.</p></div>}
                {!loading && !searchError && query.trim().length>=2 && results.length===0 && <div className="eary-muted py-10 text-center text-xs">"{searchedTerm}" için görünür kullanıcı bulunamadı.</div>}
                {results.map(profile=>{const isSelected=selected.some(item=>item.username===profile.username);const isSent=sentUsername===profile.username;return <article key={profile.username} className="flex items-center gap-3 border-b eary-line py-3"><ProfileAvatar profile={profile} selected={isSelected}/><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold">{profile.nickname}</h3><p className="eary-muted truncate text-[11px]">@{profile.username}</p>{profile.bio&&<p className="eary-muted mt-1 line-clamp-1 text-[9px]">{profile.bio}</p>}</div>{mode==='person'?<button type="button" disabled={Boolean(sendingUsername)||isSent} onClick={()=>sendRequest(profile)} className={`flex h-9 min-w-[120px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[10px] font-bold ${isSent?'eary-soft eary-muted opacity-70':'eary-brand-bg'} disabled:pointer-events-none`}><Send size={14}/> {sendingUsername===profile.username?'Gönderiliyor':isSent?'İstek gönderildi':'İstek gönder'}</button>:<button type="button" onClick={()=>toggleSelected(profile)} className={`flex h-9 w-9 items-center justify-center rounded-lg ${isSelected?'eary-brand-bg':'eary-soft eary-brand'}`}>{isSelected?<Check size={17}/>:<UserPlus size={17}/>}</button>}</article>;})}
            </section>
            {mode==='group' && <footer className="eary-shell absolute bottom-0 left-0 right-0 border-t eary-line p-3 pb-[max(12px,env(safe-area-inset-bottom))]"><button type="button" disabled={creating||!groupName.trim()||selected.length<2} onClick={createGroup} className="eary-brand-bg w-full rounded-lg py-3 text-sm font-bold disabled:opacity-40">{creating?'Grup oluşturuluyor…':selected.length<2?'En az 2 kişi seçin':`${selected.length+1} kişilik grubu oluştur`}</button></footer>}
        </main>
    );
}
