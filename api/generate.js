import { db, admin } from './lib/firebase.js';

// Configuration des tarifs par modèle pour 5 secondes de vidéo
const VIDEO_DURATION_SECONDS = 5;

const MODEL_RATES_PER_SEC = {
  'kling': 0.11,
  'minimax': 0.13,
  'soul2': 0.01,
  'cartoon': 0.08,
};

const MODEL_MAP_HIGGSFIELD = {
  'kling': 'kling-3.0',
  'kling 3.0': 'kling-3.0',
  'kling-3.0': 'kling-3.0',
  'minimax': 'minimax-h3',
  'minimax h3': 'minimax-h3',
  'minimax-h3': 'minimax-h3',
  'soul2': 'soul-2',
  'soul-2': 'soul-2',
  'cartoon': 'cartoon_model',
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

    const effectiveUserId = userId || 'user_guest';
    const effectiveDuration = Number(duration) || VIDEO_DURATION_SECONDS;

    // Calcul du coût exact pour la durée demandée
    const modelKey = (model || 'kling').toLowerCase();
    const ratePerSec = MODEL_RATES_PER_SEC[modelKey] || 0.11;
    const totalCost = parseFloat((ratePerSec * effectiveDuration).toFixed(2));

    const userRef = db.collection('users').doc(effectiveUserId);
    const generationRef = db.collection('generations').doc();

    let updatedBalance = 0;

    // 2. Transaction Firestore atomique : vérifie ou initialise le solde et débite
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      let currentBalance = 10.00; // Solde de bienvenue par défaut
      if (userDoc.exists) {
        currentBalance = Number(userDoc.data().balance ?? 0);
      } else {
        // Enregistrement initial de l'utilisateur
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

      // Création du document 'generations' avec le statut 'pending'
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

    // 3. Appel de l'API Higgsfield
    const HIGGSFIELD_API_KEY = (process.env.HIGGSFIELD_API_KEY || '').trim();
    const HIGGSFIELD_API_URL = process.env.HIGGSFIELD_API_URL || 'https://api.higgsfield.ai/v1/video/generate';
    const WEBHOOK_URL = process.env.WEBHOOK_URL || `${process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://studiocreaecomn.vercel.app'}/api/webhook`;

    if (!HIGGSFIELD_API_KEY) {
      console.warn('HIGGSFIELD_API_KEY non configurée.');
    }

    const authHeader = HIGGSFIELD_API_KEY.startsWith('Key ') || HIGGSFIELD_API_KEY.startsWith('Bearer ')
      ? HIGGSFIELD_API_KEY
      : `Key ${HIGGSFIELD_API_KEY}`;

    const payload = {
      model: MODEL_MAP_HIGGSFIELD[modelKey] || model,
      prompt: prompt.trim(),
      duration: effectiveDuration,
      aspect_ratio: aspectRatio || '16:9',
      webhook_url: WEBHOOK_URL,
      custom_id: generationRef.id,
      metadata: {
        generationId: generationRef.id,
        userId: effectiveUserId,
      },
    };

    let higgsfieldResponse;
    try {
      higgsfieldResponse = await fetch(HIGGSFIELD_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr) {
      console.error('Erreur réseau appel Higgsfield:', fetchErr);
      await generationRef.update({
        status: 'failed',
        error: `Erreur de connexion à Higgsfield : ${fetchErr.message}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(502).json({
        error: 'Impossible de joindre le serveur Higgsfield.',
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

      // Recréditer l'utilisateur immédiatement en cas de refus API direct
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
    const statusUrl = data.status_url || null;

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
