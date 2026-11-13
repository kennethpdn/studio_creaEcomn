import { db, admin } from './lib/firebase.js';

// Configuration des tarifs par modèle pour 5 secondes de vidéo
const VIDEO_DURATION_SECONDS = 5;

const MODEL_RATES_PER_SEC = {
  'kling': 0.11,
  'minimax': 0.13,
  'soul2': 0.01,
  'cartoon': 0.08,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  try {
    const { userId, prompt, model, duration, aspectRatio } = req.body;

    if (!prompt || !model) {
      return res.status(400).json({
        error: 'Champs requis manquants : prompt et model sont obligatoires.',
      });
    }

    // Récupération de la clé API Higgsfield (supporte KEY_HIGSFIELD du screenshot, HIGGSFIELD_API_KEY, etc.)
    const HIGGSFIELD_API_KEY = (
      process.env.KEY_HIGSFIELD ||
      process.env.KEY_HIGGSFIELD ||
      process.env.HIGGSFIELD_API_KEY ||
      process.env.HIGSFIELD_API_KEY ||
      ''
    ).trim();

    if (!HIGGSFIELD_API_KEY) {
      return res.status(401).json({
        error: "Clé API Higgsfield non trouvée dans les variables d'environnement Vercel.",
        details: "Assurez-vous que la variable KEY_HIGSFIELD ou HIGGSFIELD_API_KEY est bien enregistrée sur Vercel.",
      });
    }

    const effectiveUserId = userId || 'user_guest';
    const effectiveDuration = Number(duration) || VIDEO_DURATION_SECONDS;

    // Calcul du coût
    const modelKey = (model || 'kling').toLowerCase();
    const ratePerSec = modelKey.includes('minimax') ? MODEL_RATES_PER_SEC['minimax'] : MODEL_RATES_PER_SEC['kling'];
    const totalCost = parseFloat((ratePerSec * effectiveDuration).toFixed(2));

    const userRef = db.collection('users').doc(effectiveUserId);
    const generationRef = db.collection('generations').doc();

    let updatedBalance = 0;

    // Transaction Firestore atomique : solde & document de génération
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      let currentBalance = 10.00;
      if (userDoc.exists) {
        currentBalance = Number(userDoc.data().balance ?? 0);
      } else {
        transaction.set(userRef, {
          id: effectiveUserId,
          balance: currentBalance,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      if (currentBalance < totalCost) {
        throw new Error('SOLDE_INSUFFISANT');
      }

      updatedBalance = parseFloat((currentBalance - totalCost).toFixed(2));
      transaction.update(userRef, {
        balance: updatedBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.set(generationRef, {
        id: generationRef.id,
        userId: effectiveUserId,
        prompt: prompt.trim(),
        model: model,
        cost: totalCost,
        duration: effectiveDuration,
        aspectRatio: aspectRatio || '16:9',
        status: 'pending',
        videoUrl: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Détermination de l'endpoint exact Higgsfield
    let higgsfieldEndpoint = 'https://api.higgsfield.ai/kling-video/v3.0/std/text-to-video';
    let requestPayload = {
      prompt: prompt.trim(),
      duration: effectiveDuration,
      aspect_ratio: aspectRatio || '16:9',
      sound: 'on',
    };

    if (modelKey.includes('minimax')) {
      higgsfieldEndpoint = 'https://api.higgsfield.ai/minimax/h3/text-to-video';
      requestPayload = {
        prompt: prompt.trim(),
        duration: effectiveDuration,
        aspect_ratio: aspectRatio === '9:16' ? '9:16' : (aspectRatio === '1:1' ? '1:1' : 'auto'),
      };
    }

    const authHeader = HIGGSFIELD_API_KEY.startsWith('Key ') || HIGGSFIELD_API_KEY.startsWith('Bearer ')
      ? HIGGSFIELD_API_KEY
      : `Key ${HIGGSFIELD_API_KEY}`;

    let higgsfieldResponse;
    try {
      higgsfieldResponse = await fetch(higgsfieldEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(requestPayload),
      });
    } catch (fetchErr) {
      console.error('Erreur réseau appel Higgsfield:', fetchErr);
      await generationRef.update({
        status: 'failed',
        error: `Erreur de connexion à Higgsfield : ${fetchErr.message}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(502).json({
        error: 'Impossible de joindre les serveurs de Higgsfield.',
        details: fetchErr.message,
        generationId: generationRef.id,
      });
    }

    if (!higgsfieldResponse.ok) {
      const errorText = await higgsfieldResponse.text();
      console.error('Erreur Higgsfield API:', higgsfieldResponse.status, errorText);

      await generationRef.update({
        status: 'failed',
        error: errorText,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Recréditer l'utilisateur
      await userRef.update({
        balance: admin.firestore.FieldValue.increment(totalCost),
      });

      return res.status(higgsfieldResponse.status).json({
        error: `Erreur Higgsfield (${higgsfieldResponse.status})`,
        details: errorText,
        generationId: generationRef.id,
      });
    }

    const data = await higgsfieldResponse.json();

    // Enregistrement des identifiants de suivi retournés par Higgsfield
    const taskId = data.request_id || data.id || data.task_id || null;
    const statusUrl = data.status_url || (taskId ? `https://api.higgsfield.ai/requests/${taskId}/status` : null);

    if (taskId || statusUrl) {
      await generationRef.update({
        higgsfieldTaskId: taskId,
        statusUrl: statusUrl,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Génération initiée avec succès',
      generationId: generationRef.id,
      debitedCost: totalCost,
      newBalance: updatedBalance,
      status: 'pending',
    });

  } catch (error) {
    console.error('Erreur dans /api/generate:', error);

    if (error.message === 'SOLDE_INSUFFISANT') {
      return res.status(402).json({ error: 'Solde insuffisant pour générer cette vidéo.' });
    }

    return res.status(500).json({
      error: 'Erreur interne du serveur lors du traitement de la génération.',
      details: error.message,
    });
  }
}
