// Firebase project settings for the shared (cloud) mode.
//
// 1. Create a Firebase project (Spark plan is enough), add a Web app and copy its config here.
// 2. Enable Authentication > Sign-in method > Google.
// 3. Add your GitHub Pages domain (e.g. <user>.github.io) under Authentication > Settings > Authorized domains.
// 4. Enable Firestore and deploy firestore.rules (see README.md).
//
// While apiKey still starts with "REPLACE", the app runs in browser-only mode (data stays on this device).
export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain: 'REPLACE_PROJECT_ID.firebaseapp.com',
  projectId: 'REPLACE_PROJECT_ID',
  storageBucket: 'REPLACE_PROJECT_ID.appspot.com',
  messagingSenderId: 'REPLACE_SENDER_ID',
  appId: 'REPLACE_APP_ID',
};
