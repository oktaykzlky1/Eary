import * as functions from 'firebase-functions/v1';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();

export const notifyNewRoomMessage = functions
    .region('us-central1')
    .database.ref('/rooms/{roomId}/messages/{messageId}')
    .onCreate(async (snapshot, context) => {
        const message = snapshot.val();
        if (!message) return;

        const roomId = context.params.roomId;
        const roomSnapshot = await getDatabase().ref(`/rooms/${roomId}`).once('value');
        const room = roomSnapshot.val() || {};
        const members = Object.keys(room.members || {});
        const metadata = room.metadata || {};
        const historyUpdates = {};
        const timestamp = Number(message.timestamp || Date.now());
        members.forEach(username => {
            const peerUsername = members.find(member => member !== username) || '';
            historyUpdates[`/users/${username}/history/${roomId}`] = {
                roomId,
                roomPin: room.pin || '',
                nickname: metadata.memberNames?.[username] || username,
                role: 'intercom',
                roomType: 'intercom_only',
                kind: metadata.kind || (members.length > 2 ? 'group' : 'direct'),
                title: metadata.kind === 'group' ? (metadata.name || 'Grup') : (metadata.memberNames?.[peerUsername] || peerUsername || roomId),
                peerUsername,
                timestamp
            };
        });
        if (Object.keys(historyUpdates).length) await getDatabase().ref().update(historyUpdates);

        const tokensSnapshot = await getDatabase()
            .ref(`/rooms/${roomId}/pushTokens`)
            .once('value');
        const devices = { ...(tokensSnapshot.val() || {}) };
        await Promise.all(members.filter(username => username !== message.senderUsername).map(async username => {
            const userTokens = (await getDatabase().ref(`/users/${username}/pushTokens`).once('value')).val() || {};
            Object.entries(userTokens).forEach(([deviceId, device]) => { devices[`${username}:${deviceId}`] = device; });
        }));
        const now = Date.now();
        const eligibleRecipients = Object.entries(devices)
            .filter(([deviceId, device]) => (
                deviceId !== message.senderDeviceId &&
                device?.token &&
                device.mutedUntil !== -1 &&
                (!device.mutedUntil || device.mutedUntil <= now)
            ));
        const recipients = [...new Map(
            eligibleRecipients.map(entry => [entry[1].token, entry])
        ).values()];

        if (recipients.length === 0) return;

        const body = message.text || (
            message.mediaType === 'video' ? 'Video gönderdi' : 'Fotoğraf gönderdi'
        );
        const response = await getMessaging().sendEachForMulticast({
            tokens: recipients.map(([, device]) => device.token),
            notification: {
                title: `${message.senderName || 'Eary'} size mesaj gönderdi`,
                body
            },
            data: {
                roomId,
                messageId: context.params.messageId
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'duotalk_messages_v2',
                    sound: 'default',
                    visibility: 'public'
                }
            }
        });

        const staleTokenDeletes = [];
        response.responses.forEach((result, index) => {
            if (result.success) return;
            const code = result.error?.code;
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                const [deviceId] = recipients[index];
                staleTokenDeletes.push(
                    getDatabase().ref(`/rooms/${roomId}/pushTokens/${deviceId}`).remove()
                );
            }
        });
        await Promise.all(staleTokenDeletes);
    });
