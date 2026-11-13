import { db, admin } from './lib/firebase.js';

export default async function handler(req, res) {
  const id = req.query.id || req.body?.id;

  if (!id) {
    return res.status(400).json({ error: "L'identifiant 'id' est obligatoire." });
  }

  try {
    const generationRef = db.collection('generations').doc(id);
    const doc = await generationRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Génération introuvable." });
    }

    const data = doc.data();

    const HIGGSFIELD_API_KEY = (
      process.env.KEY_HIGSFIELD ||
      process.env.KEY_HIGGSFIELD ||
      process.env.HIGGSFIELD_API_KEY ||
      process.env.HIGSFIELD_API_KEY ||
      ''
    ).trim();

    // Fallback Polling : si le statut est encore 'pending' et qu'un ID Higgsfield est disponible
    if (data.status === 'pending' && (data.statusUrl || data.higgsfieldTaskId) && HIGGSFIELD_API_KEY) {
      try {
        const checkUrl = data.statusUrl || `https://api.higgsfield.ai/requests/${data.higgsfieldTaskId}/status`;
        const authHeader = HIGGSFIELD_API_KEY.startsWith('Key ') || HIGGSFIELD_API_KEY.startsWith('Bearer ')
          ? HIGGSFIELD_API_KEY
          : `Key ${HIGGSFIELD_API_KEY}`;

        const hfRes = await fetch(checkUrl, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
        });

        if (hfRes.ok) {
          const hfData = await hfRes.json();
          const isDone = hfData.status === 'completed' || hfData.status === 'succeeded';
          const videoUrl =
            hfData.video?.url ||
            hfData.output?.video_url ||
            hfData.output?.url ||
            hfData.video_url ||
            hfData.file_url ||
            (Array.isArray(hfData.output) && hfData.output[0]?.url);

          if (isDone && videoUrl) {
            await generationRef.update({
              status: 'completed',
              videoUrl: videoUrl,
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            data.status = 'completed';
            data.videoUrl = videoUrl;
          } else if (hfData.status === 'failed') {
            const reason = hfData.error || hfData.message || 'Échec de la génération chez Higgsfield';
            await generationRef.update({
              status: 'failed',
              error: reason,
              failedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            data.status = 'failed';
            data.error = reason;

            // Recréditer l'utilisateur
            if (data.userId && data.cost) {
              const userRef = db.collection('users').doc(data.userId);
              await userRef.update({
                balance: admin.firestore.FieldValue.increment(data.cost),
              });
            }
          }
        }
      } catch (pollErr) {
        console.warn("Polling fallback error:", pollErr.message);
      }
    }

    return res.status(200).json({
      id: doc.id,
      status: data.status || 'pending',
      videoUrl: data.videoUrl || null,
      prompt: data.prompt || '',
      model: data.model || '',
      cost: data.cost || 0,
      error: data.error || null,
    });
  } catch (error) {
    console.error("Erreur dans /api/status:", error);
    return res.status(500).json({
      error: "Erreur serveur lors de la récupération du statut.",
      details: error.message,
    });
  }
}
