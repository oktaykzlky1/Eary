import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, onDisconnect, push, remove, get, update, query, limitToLast, orderByKey } from "firebase/database";
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signInWithPhoneNumber, RecaptchaVerifier, signOut
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCbao9F8V3xNObfBpyx-_K94SwISoKuGt0",
  authDomain: "eary-e0f00.firebaseapp.com",
  databaseURL: "https://eary-e0f00-default-rtdb.firebaseio.com",
  projectId: "eary-e0f00",
  storageBucket: "eary-e0f00.firebasestorage.app",
  messagingSenderId: "599913888122",
  appId: "1:599913888122:web:bb883f52089d315de3bec3",
  measurementId: "G-6ZD0H6HDPW"
};

export const databaseURL = firebaseConfig.databaseURL;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');
export const requestAccountDeletion = httpsCallable(functions, 'requestAccountDeletion');

const encodeDatabasePath = path => path
  .split('/')
  .filter(Boolean)
  .map(segment => encodeURIComponent(segment))
  .join('/');

const getAuthQuery = async () => {
  const user = auth.currentUser;
  if (!user) return '';
  try {
    const token = await user.getIdToken();
    return token ? `&auth=${encodeURIComponent(token)}` : '';
  } catch (error) {
    console.warn('Firebase REST auth token unavailable:', error);
    return '';
  }
};

export const getRest = async (path, { timeoutMs = 8000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${databaseURL}/${encodeDatabasePath(path)}.json?_=${Date.now()}${await getAuthQuery()}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Firebase REST read failed: ${response.status}`);
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Arama zaman aşımına uğradı. İnternet bağlantısını kontrol edip tekrar deneyin.', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const updateRest = async updates => {
  const response = await fetch(`${databaseURL}/.json?_=${Date.now()}${await getAuthQuery()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Firebase REST update failed: ${response.status}`);
  return response.json();
};

// Helper database references and functions
export { ref, set, onValue, onDisconnect, push, remove, get, update, query, limitToLast, orderByKey };
export { storageRef, uploadBytes, uploadBytesResumable, getDownloadURL };
export { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithPhoneNumber, RecaptchaVerifier, signOut };
