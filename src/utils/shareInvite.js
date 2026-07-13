import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export const buildInviteUrl = username => (
    username ? `${window.location.origin}${window.location.pathname}?invite=${username}` : ''
);

export const buildInviteText = account => (
    account?.nickname
        ? `${account.nickname} sizi Eary'de konuşmaya davet ediyor.`
        : 'Sizi Eary’de konuşmaya davet ediyorum.'
);

export const copyInviteLink = async inviteUrl => {
    if (!inviteUrl || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(inviteUrl);
    return true;
};

export const shareInviteLink = async ({ inviteUrl, inviteText, title = 'Eary daveti' }) => {
    if (!inviteUrl) return { status: 'missing' };
    const text = `${inviteText || 'Sizi Eary’de konuşmaya davet ediyorum.'}\n${inviteUrl}`;
    const payload = { title, text, url: inviteUrl, dialogTitle: title };

    try {
        if (Capacitor.isNativePlatform()) {
            await Share.share(payload);
            return { status: 'shared' };
        }
        if (navigator.share) {
            await navigator.share({ title, text, url: inviteUrl });
            return { status: 'shared' };
        }
        await copyInviteLink(inviteUrl);
        return { status: 'copied' };
    } catch (error) {
        if (error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('cancel')) {
            return { status: 'cancelled' };
        }
        await copyInviteLink(inviteUrl);
        return { status: 'copied', fallback: true };
    }
};
