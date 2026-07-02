import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyCbao9F8V3xNObfBpyx-_K94SwISoKuGt0',
  authDomain: 'eary-e0f00.firebaseapp.com',
  databaseURL: 'https://eary-e0f00-default-rtdb.firebaseio.com',
  projectId: 'eary-e0f00',
  storageBucket: 'eary-e0f00.firebasestorage.app',
  messagingSenderId: '599913888122',
  appId: '1:599913888122:web:bb883f52089d315de3bec3',
  measurementId: 'G-6ZD0H6HDPW'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');
export const callAdminDashboard = httpsCallable(functions, 'getAdminDashboard');
export const callSetUserSuspended = httpsCallable(functions, 'setUserSuspended');
