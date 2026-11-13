import { db, admin } from './lib/firebase.js';

// Configuration des tarifs par modèle pour 5 secondes de vidéo
// Kling 3.0 : 0.11$/s * 5s = 0.55$
// MiniMax H3 : 0.13$/s * 5s = 0.65$
// Soul 2 (Image) : tarif forfaitaire (ex: 0.05$)
const VIDEO_DURATION_SECONDS = 5;

const MODEL_RATES_PER_SEC = {
  'kling': 0.11,
  'minimax': 0.13,
  'soul2': 0.01, // fallback si utilisé en vidéo ou 0.05$ forfait
};

const MODEL_MAP_HIGGSFIELD = {
  'kling': 'kling-3.0',
  'minimax': 'minimax-h3',
  'soul2': 'soul-2',
};

export default async function handler(req, res) {
  // 1. Restriction à la méthode POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  try {
    const { userId, prompt, model } = req.body;

    // Validation des données d'entrée
    if (!userId || !prompt || !model) {
      return res.status(400).json({
        error: 'Champs requis manquants : userId, prompt et model sont obligatoires.',
      });
    }

    // Calcul du coût exact pour 5 secondes
    const ratePerSec = MODEL_RATES_PER_SEC[model.toLowerCase()] || 0.11;
    const totalCost = parseFloat((ratePerSec * VIDEO_DURATION_SECONDS).toFixed(2));

    const userRef = db.collection('users').doc(userId);
    const generationRef = db.collection('generations').doc(); // Génère un nouvel ID unique

    // 2. Transaction Firestore atomique : vérifie le solde et débite immédiatement
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new Error('UTILISATEUR_INTROUVABLE');
      }

      const userData = userDoc.data();
      const currentBalance = Number(userData.balance ?? 0);

      if (currentBalance < totalCost) {
        throw new Error('SOLDE_INSUFFISANT');
      }

      // Déduction immédiate du montant exact
      const newBalance = parseFloat((currentBalance - totalCost).toFixed(2));
      transaction.update(userRef, {
        balance: newBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Création du document 'generations' avec le statut 'pending'
      transaction.set(generationRef, {
        id: generationRef.id,
        userId: userId,
        prompt: prompt,
        model: model,
        cost: totalCost,
        duration: VIDEO_DURATION_SECONDS,
        status: 'pending',
        videoUrl: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // 3. Appel de l'API Higgsfield avec la clé API et l'URL du Webhook
    const HIGGSFIELD_API_KEY = process.env.HIGGSFIELD_API_KEY;
    const HIGGSFIELD_API_URL = process.env.HIGGSFIELD_API_URL || 'https://api.higgsfield.ai/v1/video/generate';
    const WEBHOOK_URL = process.env.WEBHOOK_URL || `${process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://votre-domaine.vercel.app'}/api/webhook`;

    if (!HIGGSFIELD_API_KEY) {
      console.warn('HIGGSFIELD_API_KEY non configurée dans les variables d’environnement.');
    }

    const payload = {
      model: MODEL_MAP_HIGGSFIELD[model.toLowerCase()] || model,
      prompt: prompt,
      duration: VIDEO_DURATION_SECONDS,
      webhook_url: WEBHOOK_URL,
      // Metadata transmise pour corréler la réponse dans le webhook
      custom_id: generationRef.id,
      metadata: {
        generationId: generationRef.id,
        userId: userId,
      },
    };

    const response = await fetch(HIGGSFIELD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HIGGSFIELD_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erreur Higgsfield API:', errorText);

      // En cas d'erreur de soumission côté tiers, on trace l'erreur dans la génération
      await generationRef.update({
        status: 'failed',
        error: errorText,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(502).json({
        error: 'Échec de la soumission à Higgsfield',
        details: errorText,
        generationId: generationRef.id,
      });
    }

    const data = await response.json();

    // Optionnel : enregistrer l'ID externe renvoyé par Higgsfield
    if (data.id || data.task_id) {
      await generationRef.update({
        higgsfieldTaskId: data.id || data.task_id,
      });
    }

    // Réponse de succès
    return res.status(200).json({
      success: true,
      message: 'Génération initiée avec succès',
      generationId: generationRef.id,
      debitedCost: totalCost,
      status: 'pending',
    });

  } catch (error) {
    console.error('Erreur dans /api/generate:', error);

    if (error.message === 'UTILISATEUR_INTROUVABLE') {
      return res.status(404).json({ error: 'Utilisateur introuvable dans Firestore.' });
    }

    if (error.message === 'SOLDE_INSUFFISANT') {
      return res.status(402).json({ error: 'Solde insuffisant pour une vidéo de 5 secondes.' });
    }

    return res.status(500).json({
      error: 'Erreur interne du serveur lors du traitement de la génération.',
      details: error.message,
    });
  }
}
