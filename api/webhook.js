import { db, admin } from './lib/firebase.js';

export default async function handler(req, res) {
  // 1. Autoriser uniquement les requêtes POST provenant de Higgsfield
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  try {
    const payload = req.body;

    if (!payload) {
      return res.status(400).json({ error: 'Corps de requête (payload) vide.' });
    }

    // 2. Récupération de l'identifiant du document Firestore
    // Higgsfield renvoie généralement custom_id ou metadata.generationId ou task_id
    const generationId =
      payload.custom_id ||
      payload.metadata?.generationId ||
      payload.generationId ||
      payload.id;

    if (!generationId) {
      return res.status(400).json({
        error: 'Identifiant de génération manquant dans le payload du webhook.',
      });
    }

    // 3. Récupération de l'URL du fichier MP4
    // Selon le format de réponse de Higgsfield, l'URL se trouve dans output.video_url, file_url, video_url ou output.url
    const videoUrl =
      payload.output?.video_url ||
      payload.output?.url ||
      payload.video_url ||
      payload.file_url ||
      (Array.isArray(payload.output) && payload.output[0]?.url) ||
      null;

    // Détermination de l'état (réussite ou échec)
    const isSuccess = payload.status === 'completed' || payload.status === 'succeeded' || !!videoUrl;

    const generationRef = db.collection('generations').doc(generationId);
    const generationDoc = await generationRef.get();

    if (!generationDoc.exists) {
      console.warn(`Document de génération ${generationId} non trouvé dans Firestore.`);
      return res.status(404).json({ error: `Génération ${generationId} introuvable.` });
    }

    // 4. Mise à jour du document Firestore
    if (isSuccess && videoUrl) {
      await generationRef.update({
        status: 'completed',
        videoUrl: videoUrl,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rawWebhookPayload: payload,
      });

      return res.status(200).json({
        received: true,
        generationId: generationId,
        status: 'completed',
        videoUrl: videoUrl,
      });
    } else {
      // Cas où la génération a échoué côté Higgsfield
      const failureReason = payload.error || payload.message || 'Échec du traitement vidéo';

      await generationRef.update({
        status: 'failed',
        error: failureReason,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rawWebhookPayload: payload,
      });

      // Remboursement optionnel : si la vidéo a échoué, on peut recréditer l'utilisateur
      const generationData = generationDoc.data();
      if (generationData?.userId && generationData?.cost) {
        const userRef = db.collection('users').doc(generationData.userId);
        await userRef.update({
          balance: admin.firestore.FieldValue.increment(generationData.cost),
        });
      }

      return res.status(200).json({
        received: true,
        generationId: generationId,
        status: 'failed',
        reason: failureReason,
      });
    }
  } catch (error) {
    console.error('Erreur dans /api/webhook:', error);
    return res.status(500).json({
      error: 'Erreur interne lors du traitement du webhook.',
      details: error.message,
    });
  }
}
