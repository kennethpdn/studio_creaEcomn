import { db, admin } from './lib/firebase.js';

export default async function handler(req, res) {
  const userId = req.query.id || req.body?.userId;

  if (!userId) {
    return res.status(400).json({ error: "L'identifiant 'id' est obligatoire." });
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) {
      // Attribution automatique d'un solde initial de bienvenue (10.00 $)
      const initialBalance = 10.00;
      await userRef.set({
        id: userId,
        balance: initialBalance,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({
        userId,
        balance: initialBalance,
        isNew: true,
      });
    }

    const userData = doc.data();
    return res.status(200).json({
      userId,
      balance: Number(userData.balance ?? 0),
      isNew: false,
    });
  } catch (error) {
    console.error("Erreur dans /api/user:", error);
    return res.status(500).json({
      error: "Erreur serveur lors de la récupération de l'utilisateur.",
      details: error.message,
    });
  }
}
