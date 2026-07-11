import { Capacitor, registerPlugin } from '@capacitor/core';
import { db, ref, set } from '../firebase';

const PushNotifications = registerPlugin('PushNotifications');
const DEVICE_ID_KEY = 'eary_device_id';

export const getDeviceId = () => {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
        const nativeCrypto = globalThis.crypto;
        if (nativeCrypto?.randomUUID) {
            deviceId = nativeCrypto.randomUUID();
        } else {
            const randomPart = Math.random().toString(36).slice(2);
            deviceId = `device-${Date.now().toString(36)}-${randomPart}`;
        }
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
};

export const registerRoomPushNotifications = async ({ roomId, nickname }) => {
    if (!Capacitor.isNativePlatform()) return () => {};

    const deviceId = getDeviceId();
    const listeners = [];

    listeners.push(await PushNotifications.addListener('registration', async ({ value }) => {
        await set(ref(db, `rooms/${roomId}/pushTokens/${deviceId}`), {
            token: value,
            nickname,
            platform: Capacitor.getPlatform(),
            updatedAt: Date.now()
        });
    }));

    listeners.push(await PushNotifications.addListener('registrationError', (error) => {
        console.error('FCM registration failed:', error);
    }));

    listeners.push(await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const targetRoomId = notification?.data?.roomId;
        if (targetRoomId) {
            window.dispatchEvent(new CustomEvent('eary:open-room', { detail: { roomId: targetRoomId } }));
        }
    }));

    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt') {
        permission = await PushNotifications.requestPermissions();
    }

    if (permission.receive === 'granted') {
        await PushNotifications.register();
    }

    return () => listeners.forEach(listener => listener.remove());
};

export const registerUserPushNotifications = async ({ username, nickname }) => {
    if (!Capacitor.isNativePlatform() || !username) return () => {};
    const deviceId = getDeviceId();
    const listeners = [];
    listeners.push(await PushNotifications.addListener('registration', async ({ value }) => {
        await set(ref(db, `users/${username}/pushTokens/${deviceId}`), {
            token: value, nickname, platform: Capacitor.getPlatform(), updatedAt: Date.now()
        });
    }));
    listeners.push(await PushNotifications.addListener('registrationError', error => console.error('FCM registration failed:', error)));
    listeners.push(await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const targetRoomId = notification?.data?.roomId;
        if (targetRoomId) window.dispatchEvent(new CustomEvent('eary:open-room', { detail: { roomId: targetRoomId } }));
    }));
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
    if (permission.receive === 'granted') await PushNotifications.register();
    return () => listeners.forEach(listener => listener.remove());
};
