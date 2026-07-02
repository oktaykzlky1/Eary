import * as functions from 'firebase-functions/v1';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { getAuth } from 'firebase-admin/auth';

initializeApp();

const assertAdmin = async context => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Admin girişi gerekiyor.');
    }
    const snapshot = await getDatabase().ref(`/adminUsers/${context.auth.uid}`).once('value');
    const adminUser = snapshot.val();
    if (!adminUser?.enabled) {
        throw new functions.https.HttpsError('permission-denied', 'Bu hesap admin yetkisine sahip değil.');
    }
    return adminUser;
};

const findUidForUsername = async username => {
    const snapshot = await getDatabase().ref('/authUsers').once('value');
    const entries = Object.entries(snapshot.val() || {});
    return entries.find(([, value]) => value?.username === username)?.[0] || null;
};

export const getAdminDashboard = functions
    .region('us-central1')
    .https.onCall(async (data, context) => {
        await assertAdmin(context);

        const [usersSnapshot, publicProfilesSnapshot, deletionRequestsSnapshot] = await Promise.all([
            getDatabase().ref('/users').once('value'),
            getDatabase().ref('/publicProfiles').once('value'),
            getDatabase().ref('/adminTasks/accountDeletionRequests').once('value')
        ]);
        const users = usersSnapshot.val() || {};
        const publicProfiles = publicProfilesSnapshot.val() || {};
        const deletionRequests = deletionRequestsSnapshot.val() || {};
        const userRows = Object.entries(users).map(([username, value]) => {
            const profile = value?.profile || {};
            const publicProfile = publicProfiles[username] || {};
            return {
                username,
                nickname: profile.nickname || publicProfile.nickname || username,
                contactMethod: profile.contactMethod || 'legacy',
                contactHint: profile.contactHint || '',
                contactVerified: Boolean(profile.contactVerified),
                createdAt: Number(profile.createdAt || 0),
                suspended: Boolean(profile.adminStatus?.suspended || publicProfile.suspended)
            };
        }).sort((a, b) => b.createdAt - a.createdAt);

        return {
            stats: {
                users: userRows.length,
                verifiedContacts: userRows.filter(user => user.contactVerified).length,
                suspendedUsers: userRows.filter(user => user.suspended).length,
                deletionRequests: Object.keys(deletionRequests).length
            },
            users: userRows.slice(0, 100),
            generatedAt: Date.now()
        };
    });

export const setUserSuspended = functions
    .region('us-central1')
    .https.onCall(async (data, context) => {
        await assertAdmin(context);
        const username = String(data?.username || '').trim().toLowerCase();
        const suspended = Boolean(data?.suspended);
        if (!/^[a-z0-9]{3,32}$/.test(username)) {
            throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir kullanıcı adı gerekli.');
        }

        const now = Date.now();
        const updates = {
            [`/users/${username}/profile/adminStatus`]: {
                suspended,
                updatedAt: now,
                updatedBy: context.auth.uid
            },
            [`/publicProfiles/${username}/suspended`]: suspended
        };
        await getDatabase().ref().update(updates);

        const uid = await findUidForUsername(username);
        if (uid) await getAuth().updateUser(uid, { disabled: suspended });

        return { username, suspended, updatedAt: now };
    });

export const requestAccountDeletion = functions
    .region('us-central1')
    .https.onCall(async (data, context) => {
        if (!context.auth?.uid) {
            throw new functions.https.HttpsError('unauthenticated', 'Hesap silme talebi için giriş gerekiyor.');
        }
        const username = String(data?.username || '').trim().toLowerCase();
        if (!/^[a-z0-9]{3,32}$/.test(username)) {
            throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir kullanıcı adı gerekli.');
        }
        const linkedUsername = (await getDatabase().ref(`/authUsers/${context.auth.uid}/username`).once('value')).val();
        if (linkedUsername !== username) {
            throw new functions.https.HttpsError('permission-denied', 'Bu hesap için silme talebi açılamaz.');
        }
        const request = {
            username,
            uid: context.auth.uid,
            status: 'pending',
            createdAt: Date.now()
        };
        await getDatabase().ref(`/adminTasks/accountDeletionRequests/${context.auth.uid}`).set(request);
        return request;
    });

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
