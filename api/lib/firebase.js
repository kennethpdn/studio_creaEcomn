import admin from 'firebase-admin';

// Initialisation idempotente du SDK Firebase Admin
if (!admin.apps.length) {
  // Option 1 : Objet JSON direct ou variable d'environnement
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      const serviceAccount = typeof raw === 'string' ? JSON.parse(raw) : raw;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } catch (e) {
      console.error('Erreur parsing FIREBASE_SERVICE_ACCOUNT_KEY:', e);
    }
  } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    // Option 2 : Variables individuelles
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else {
    // Option 3 : Configuration par défaut de l'environnement (GCP/Firebase)
    admin.initializeApp();
  }
}

export const db = admin.firestore();
export { admin };
