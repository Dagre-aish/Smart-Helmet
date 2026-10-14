import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
}

export const firebaseConfig: FirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const DEFAULT_RIDER_ID = import.meta.env.VITE_DEFAULT_RIDER_ID || 'RIDER_001';
export const ALCOHOL_THRESHOLD = Number(import.meta.env.VITE_ALCOHOL_THRESHOLD) || 1000;

export function isConfigValid(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith('YOUR_') &&
    firebaseConfig.databaseURL &&
    !firebaseConfig.databaseURL.includes('YOUR_PROJECT_ID') &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith('YOUR_')
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;

export async function initFirebase() {
  if (!isConfigValid()) {
    throw new Error('Missing or placeholder Firebase configuration in environment variables.');
  }

  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }

  auth = getAuth(app);
  db = getDatabase(app);

  // Authenticate anonymously so database security rules allow read/write
  try {
    await signInAnonymously(auth);
  } catch (err: unknown) {
    console.error('Firebase anonymous authentication error:', err);
    throw new Error(
      err instanceof Error
        ? `Authentication failed: ${err.message}`
        : 'Anonymous authentication failed. Check if Anonymous sign-in is enabled in Firebase Console.'
    );
  }

  return { app, auth, db };
}
