import { useState, useEffect, useRef } from 'react';
import RoomSetup from './components/RoomSetup';
import IntercomInterface from './components/IntercomInterface';
import DisplayMode from './components/DisplayMode';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { getInitialAppLanguage, normalizeAppLanguage, SUPPORTED_LANGUAGES } from './utils/language';
import { uiText } from './utils/i18n';
import { getRest, updateRest } from './firebase';

function LanguageGate({ language, onSelect }) {
    const text = uiText(language);
    const [selectingLanguage, setSelectingLanguage] = useState('');

    const handleSelect = async code => {
        if (selectingLanguage) return;
        setSelectingLanguage(code);
        try {
            await onSelect(code);
        } catch (error) {
            console.warn('Initial language save failed:', error);
        } finally {
            setSelectingLanguage('');
        }
    };

    return (
        <main className="eary-shell fixed inset-0 z-[300] flex items-center justify-center bg-[var(--surface)] px-5 text-[var(--text)]">
            <section className="w-full max-w-md">
                <div className="eary-brand-bg mb-5 flex h-14 w-14 items-center justify-center rounded-xl text-2xl font-black">E</div>
                <h1 className="text-3xl font-black tracking-normal">{text.chooseLanguageTitle}</h1>
                <p className="eary-muted mt-3 text-sm font-medium leading-6">{text.chooseLanguageBody}</p>
                <div className="mt-7 grid gap-2">
                    {SUPPORTED_LANGUAGES.map(item => (
                        <button
                            key={item.code}
                            type="button"
                            onClick={() => handleSelect(item.code)}
                            disabled={Boolean(selectingLanguage)}
                            className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-bold ${normalizeAppLanguage(language) === item.code ? 'eary-brand-bg border-transparent' : 'eary-soft eary-line'}`}
                        >
                            <span>{item.nativeLabel}</span>
                            <span className="text-[10px] font-black uppercase opacity-70">{selectingLanguage === item.code ? '...' : item.short}</span>
                        </button>
                    ))}
                </div>
            </section>
        </main>
    );
}

export default function App() {
    const [theme, setTheme] = useState(() => localStorage.getItem('eary_theme') || 'light');
    const [onlineVisibility, setOnlineVisibility] = useState(() => localStorage.getItem('eary_online_visibility') || 'everyone');
    const [globalToast, setGlobalToast] = useState('');
    const lastBackPressRef = useRef(0);
    const acceptanceSyncBusyRef = useRef(false);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('eary_theme', theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem('eary_online_visibility', onlineVisibility);
    }, [onlineVisibility]);

    useEffect(() => {
        let timer;
        const showToast = event => {
            setGlobalToast(event.detail || '');
            clearTimeout(timer);
            timer = setTimeout(() => setGlobalToast(''), 2600);
        };
        window.addEventListener('eary:toast', showToast);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('eary:toast', showToast);
        };
    }, []);

    useEffect(() => {
        const syncAcceptanceNotices = async () => {
            if (acceptanceSyncBusyRef.current) return;
            let account;
            try {
                account = JSON.parse(localStorage.getItem('duotalk_account') || 'null');
            } catch {
                return;
            }
            if (!account?.username) return;

            acceptanceSyncBusyRef.current = true;
            try {
                const value = await getRest(`acceptanceNotices/${account.username}`);
                const notices = Object.entries(value || {}).filter(([, notice]) => notice?.status === 'pending');
                if (!notices.length) return;

                const currentHistory = JSON.parse(localStorage.getItem('duotalk_history') || '[]');
                const merged = new Map(currentHistory.map(item => [item.roomId, item]));
                notices.forEach(([, notice]) => {
                    if (notice.historyItem?.roomId) merged.set(notice.historyItem.roomId, notice.historyItem);
                });
                const nextHistory = [...merged.values()]
                    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
                    .slice(0, 100);
                localStorage.setItem('duotalk_history', JSON.stringify(nextHistory));
                window.dispatchEvent(new CustomEvent('eary:history-updated', { detail: nextHistory }));

                const latestNotice = notices[notices.length - 1][1];
                const acceptedBy = latestNotice.acceptedByNickname || `@${latestNotice.acceptedByUsername}`;
                window.dispatchEvent(new CustomEvent('eary:toast', { detail: `${acceptedBy} konu\u015fma iste\u011finizi kabul etti` }));

                const consumed = {};
                notices.forEach(([id]) => {
                    consumed[`acceptanceNotices/${account.username}/${id}`] = null;
                    consumed[`sentMessageRequests/${account.username}/${id}`] = null;
                });
                await updateRest(consumed);
            } catch (error) {
                console.error('Acceptance notice sync failed:', error);
            } finally {
                acceptanceSyncBusyRef.current = false;
            }
        };

        syncAcceptanceNotices();
        const interval = setInterval(syncAcceptanceNotices, 3000);
        return () => clearInterval(interval);
    }, []);
    // One-time force logout to clear stale sessions/rooms
    if (localStorage.getItem('eary_force_logout_v3') !== 'true') {
        localStorage.removeItem('duotalk_account');
        localStorage.removeItem('duotalk_history');
        localStorage.removeItem('eary_active_room');
        localStorage.removeItem('duotalk_nickname');
        localStorage.setItem('eary_force_logout_v3', 'true');
    }

    const [joinedRoom, setJoinedRoom] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const urlRoomId = params.get('roomId');
        const urlPin = params.get('pin');
        const urlRole = params.get('role');

        if (urlRoomId && urlPin && urlRole) {
            return {
                roomId: decodeURIComponent(urlRoomId),
                roomPin: decodeURIComponent(urlPin),
                nickname: urlRole === 'display' ? 'Display Screen' : 'Guest',
                role: urlRole
            };
        }

        const savedRoom = localStorage.getItem('eary_active_room');
        if (savedRoom) {
            try {
                return JSON.parse(savedRoom);
            } catch (e) {
                console.error("Failed to parse saved active room:", e);
            }
        }
        return null;
    });
    const [language, setLanguage] = useState(() => getInitialAppLanguage());
    const [languageConfirmed, setLanguageConfirmed] = useState(() => localStorage.getItem('eary_language_confirmed') === 'true');
    const handleLanguageChange = nextLanguage => {
        const normalized = normalizeAppLanguage(nextLanguage);
        setLanguage(normalized);
        localStorage.setItem('eary_app_language', normalized);
        localStorage.setItem('eary_speech_lang', normalized);
    };

    const confirmLanguage = nextLanguage => {
        const normalized = normalizeAppLanguage(nextLanguage);
        handleLanguageChange(normalized);
        localStorage.setItem('eary_language_confirmed', 'true');
        setLanguageConfirmed(true);
        return { status: 'saved' };
    };

    const handleJoin = (roomData) => {
        setJoinedRoom(roomData);
        localStorage.setItem('eary_active_room', JSON.stringify(roomData));
    };

    const handleLeave = () => {
        window.history.pushState({}, document.title, window.location.pathname);
        setJoinedRoom(null);
        localStorage.removeItem('eary_active_room');
    };

    const handleUpdateRole = (newRole) => {
        setJoinedRoom(prev => {
            if (!prev) return null;
            const updated = { ...prev, role: newRole };
            localStorage.setItem('eary_active_room', JSON.stringify(updated));
            return updated;
        });
    };

    useEffect(() => {
        const openRoomFromNotification = (event) => {
            const roomId = event.detail?.roomId;
            if (!roomId) return;
            try {
                const history = JSON.parse(localStorage.getItem('duotalk_history') || '[]');
                const room = history.find(item => item.roomId === roomId);
                if (room) handleJoin(room);
            } catch (error) {
                console.error('Notification room could not be opened:', error);
            }
        };
        window.addEventListener('eary:open-room', openRoomFromNotification);
        return () => window.removeEventListener('eary:open-room', openRoomFromNotification);
    }, []);

    // Handle native hardware back button on Android
    useEffect(() => {
        const handleBackButton = () => {
            const backEvent = new CustomEvent('eary:back', { cancelable: true });
            window.dispatchEvent(backEvent);
            if (backEvent.defaultPrevented) return;

            if (joinedRoom) {
                console.log("Hardware back button pressed: returning to main page");
                handleLeave();
            } else {
                const now = Date.now();
                if (now - lastBackPressRef.current < 2000) {
                    CapApp.exitApp();
                } else {
                    lastBackPressRef.current = now;
                    window.dispatchEvent(new CustomEvent('eary:toast', { detail: 'Çıkmak için tekrar geri basın' }));
                }
            }
        };

        let backButtonListener = null;
        if (Capacitor.isNativePlatform()) {
            try {
                backButtonListener = CapApp.addListener('backButton', handleBackButton);
            } catch (e) {
                console.error("Error setting up back button listener:", e);
            }
        }

        return () => {
            if (backButtonListener) {
                backButtonListener.then(listener => {
                    if (listener && typeof listener.remove === 'function') {
                        listener.remove();
                    }
                }).catch(e => console.error("Error removing back button listener:", e));
            }
        };
    }, [joinedRoom]);

    if (!languageConfirmed) {
        return <LanguageGate language={language} onSelect={confirmLanguage} />;
    }

    return (
        <div className="eary-app min-h-screen selection:bg-[#DDE8E5]">
            {!joinedRoom ? (
                <RoomSetup 
                    onJoin={handleJoin} 
                    language={language} 
                    onLanguageChange={handleLanguageChange}
                    theme={theme}
                    onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
                    onlineVisibility={onlineVisibility}
                    setOnlineVisibility={setOnlineVisibility}
                />
            ) : joinedRoom.role === 'display' ? (
                <DisplayMode 
                    roomId={joinedRoom.roomId} 
                    onLeave={handleLeave} 
                    onUpdateRole={handleUpdateRole}
                    language={language} 
                    nickname={joinedRoom.nickname}
                />
            ) : (
                <IntercomInterface 
                    roomData={joinedRoom} 
                    onLeave={handleLeave} 
                    language={language} 
                    onLanguageChange={handleLanguageChange}
                    theme={theme}
                    onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
                    onlineVisibility={onlineVisibility}
                    setOnlineVisibility={setOnlineVisibility}
                />
            )}
            {globalToast && <div className="fixed bottom-24 left-1/2 z-[200] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg bg-[#17221f]/80 px-4 py-2.5 text-center text-xs font-semibold text-white shadow-lg backdrop-blur-sm">{globalToast}</div>}
        </div>
    );
}
