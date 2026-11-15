import { db } from './lib/firebase.js';

export default async function handler(req, res) {
  const userId = req.query.userId || req.query.id;

  if (!userId) {
    return res.status(400).json({ error: "Le paramètre 'userId' est obligatoire." });
  }

  try {
    const items = [];

    // 1. Recherche dans users/{userId}/historique
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('historique')
      .orderBy('date', 'desc')
      .limit(50)
      .get()
      .catch(() => ({ empty: true, forEach: () => {} }));

    if (!snapshot.empty) {
      snapshot.forEach((doc) => {
        const d = doc.data();
        items.push({
          id: doc.id,
          video_url: d.video_url || d.videoUrl || '',
          prompt: d.prompt || 'Création visuelle',
          model: d.model || 'Kling 3.0',
          date: d.date?.toDate ? d.date.toDate().toLocaleDateString('fr-FR') : 'Récemment',
        });
      });
    }

    // 2. Si l'historique sous-collection est vide, vérifier dans 'generations'
    if (items.length === 0) {
      const genSnapshot = await db
        .collection('generations')
        .where('userId', '==', userId)
        .where('status', '==', 'completed')
        .limit(20)
        .get()
        .catch(() => ({ empty: true, forEach: () => {} }));

      if (!genSnapshot.empty) {
        genSnapshot.forEach((doc) => {
          const d = doc.data();
          if (d.videoUrl) {
            items.push({
              id: doc.id,
              video_url: d.videoUrl,
              prompt: d.prompt || 'Création visuelle',
              model: d.model || 'Kling 3.0',
              date: d.completedAt?.toDate ? d.completedAt.toDate().toLocaleDateString('fr-FR') : 'Récemment',
            });
          }
        });
      }
    }

    return res.status(200).json({ items });
  } catch (error) {
    console.error("Erreur dans /api/history:", error);
    return res.status(500).json({ error: error.message, items: [] });
  }
}
