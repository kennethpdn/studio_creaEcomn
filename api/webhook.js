import { db, admin } from './lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  try {
    const payload = req.body || {};
    const status = payload.status;
    const videoUrl =
      payload.video_url ||
      payload.url ||
      payload.output?.video_url ||
      payload.output?.url ||
      payload.file_url ||
      (Array.isArray(payload.output) && payload.output[0]?.url);

    const isSuccess =
      status === 'SUCCESS' ||
      status === 'COMPLETED' ||
      status === 'completed' ||
      status === 'succeeded' ||
      !!videoUrl;

    if (isSuccess && videoUrl) {
      const userId = payload.metadata?.userId || payload.userId || 'user_guest';

      // Création de l'enregistrement dans la sous-collection "historique"
      await db.collection('users').doc(userId).collection('historique').add({
        video_url: videoUrl,
        prompt: payload.metadata?.prompt || payload.prompt || "Création visuelle",
        model: payload.metadata?.model || payload.model || "kling_3",
        date: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Mise à jour de la génération si ID présent
      const generationId = payload.metadata?.generationId || payload.custom_id || payload.id;
      if (generationId) {
        await db.collection('generations').doc(generationId).update({
          status: 'completed',
          videoUrl: videoUrl,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(err => console.warn('Mise à jour document génération ignorée:', err.message));
      }

      return res.status(200).json({ message: "Vidéo sauvegardée dans l'historique Firebase", video_url: videoUrl });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erreur webhook:", error);
    return res.status(500).json({ error: error.message });
  }
}
