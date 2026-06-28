import { LocalNotifications } from '@capacitor/local-notifications';

let notificationActionListenerReady = false;

export const requestNotificationPermission = async () => {
    try {
        let permStatus = await LocalNotifications.checkPermissions();
        if (permStatus.display !== 'granted') {
            permStatus = await LocalNotifications.requestPermissions();
        }
        // Ensure the high-importance notification channel is configured
        await createNotificationChannel();
        await registerNotificationActionListener();
        return permStatus.display === 'granted';
    } catch (error) {
        console.error("Error requesting notification permission:", error);
        return false;
    }
};

export const registerNotificationActionListener = async () => {
    if (notificationActionListenerReady) return;
    notificationActionListenerReady = true;
    try {
        await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
            const targetRoomId = notification?.extra?.roomId;
            if (targetRoomId) {
                window.dispatchEvent(new CustomEvent('eary:open-room', { detail: { roomId: targetRoomId } }));
            }
        });
    } catch (error) {
        console.error("Error registering notification action listener:", error);
    }
};

export const createNotificationChannel = async () => {
    try {
        await LocalNotifications.createChannel({
            id: 'duotalk_messages_v2',
            name: 'Eary Mesajları',
            description: 'Eary için yüksek titreşimli anlık mesaj bildirimleri',
            importance: 5, // High importance (shows banner, plays sound)
            visibility: 1, // Visible on lock screen
            sound: 'default',
            vibration: true,
            vibrationPattern: [0, 400, 150, 400, 150, 400], // 3 pulses of 400ms separated by 150ms
            lights: true
        });
    } catch (error) {
        console.error("Error creating notification channel:", error);
    }
};

export const scheduleNotification = async (title, body, id = Math.floor(Math.random() * 100000), extra = {}) => {
    try {
        await LocalNotifications.schedule({
            notifications: [
                {
                    title: title,
                    body: body,
                    id: id,
                    sound: 'default',
                    channelId: 'duotalk_messages_v2',
                    extra
                }
            ]
        });
    } catch (error) {
        console.error("Error scheduling notification:", error);
    }
};
