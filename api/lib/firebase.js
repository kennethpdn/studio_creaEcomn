import admin from 'firebase-admin';

// Initialisation idempotente du SDK Firebase Admin
if (!admin.apps.length) {
  // Option 1 : Utilisation des variables d'environnement Vercel directes
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Remplace les \n échappés fréquents dans les variables d'environnement
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    // Option 2 : Objet JSON direct
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // Option 3 : Credentials par défaut de l'environnement (GCP/Firebase)
    admin.initializeApp();
  }
}

export const db = admin.firestore();
export { admin };
