import https from 'https';
import http from 'http';

/**
 * 1. TABLE DE MAPPING ET NORMALISATION STRICTE VERS HIGGSFIELD
 * Higgsfield requiert des identifiants exacts : 'kling-3.0', 'minimax-h3', 'soul-2'.
 */
const HIGGSFIELD_STRICT_MODELS = {
  // Variantes pour Kling
  'kling': 'kling-3.0',
  'kling 3': 'kling-3.0',
  'kling 3.0': 'kling-3.0',
  'kling-3.0': 'kling-3.0',
  'kling3': 'kling-3.0',

  // Variantes pour MiniMax
  'minimax': 'minimax-h3',
  'minimax h3': 'minimax-h3',
  'minimax-h3': 'minimax-h3',
  'h3': 'minimax-h3',

  // Variantes pour Soul 2
  'soul': 'soul-2',
  'soul 2': 'soul-2',
  'soul-2': 'soul-2',
  'soul2': 'soul-2',
};

const VALID_DURATIONS = [5, 10];

/**
 * 2. DÉCLARATION DU SCHÉMA DE L'OUTIL ANTIGRAVITY (TOOL DEFINITION)
 * Utilisé par AntiGravity pour extraire de manière structurée l'intention de l'utilisateur.
 */
export const higgsfieldToolDefinition = {
  name: "trigger_higgsfield_generation",
  description: "Extrait l'intention de l'utilisateur pour générer une vidéo ou image IA, valide les paramètres stricts Higgsfield ('kling-3.0', 'minimax-h3', 'soul-2') et transmet la requête à l'endpoint serverless Vercel pour débit Firestore et déclenchement.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Le prompt décrivant la scène, le style visuel, les mouvements de caméra et l'ambiance."
      },
      model_name: {
        type: "string",
        enum: ["kling-3.0", "minimax-h3", "soul-2"],
        description: "L'identifiant strict du modèle Higgsfield sélectionné : 'kling-3.0', 'minimax-h3' ou 'soul-2'."
      },
      duration: {
        type: "integer",
        enum: [5, 10],
        default: 5,
        description: "La durée de la vidéo en secondes (5 ou 10 secondes)."
      },
      userId: {
        type: "string",
        description: "L'identifiant unique de l'utilisateur pour vérifier et débiter son solde Firestore."
      }
    },
    required: ["prompt", "model_name"]
  }
};

/**
 * 3. VALIDATION ET NORMALISATION STRICTE
 */
export function normalizeAndValidateParams({ prompt, model_name, duration, userId }) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error("Validation échouée : Le champ 'prompt' est requis et ne peut être vide.");
  }

  if (!model_name || typeof model_name !== 'string') {
    throw new Error("Validation échouée : Le paramètre 'model_name' est manquant.");
  }

  // Normalisation stricte de l'identifiant modèle Higgsfield
  const sanitizedModelKey = model_name.trim().toLowerCase();
  const strictModel = HIGGSFIELD_STRICT_MODELS[sanitizedModelKey];

  if (!strictModel) {
    throw new Error(
      `Modèle non valide : "${model_name}". Les identifiants stricts acceptés par Higgsfield sont : 'kling-3.0', 'minimax-h3', ou 'soul-2'.`
    );
  }

  // Normalisation de la durée (par défaut 5s pour respecter la facturation)
  const normalizedDuration = Number(duration) || 5;
  if (!VALID_DURATIONS.includes(normalizedDuration)) {
    throw new Error(
      `Durée invalide : ${duration}s. Higgsfield accepte uniquement une durée de 5 ou 10 secondes.`
    );
  }

  return {
    prompt: prompt.trim(),
    model_name: strictModel,
    duration: normalizedDuration,
    userId: userId || process.env.DEFAULT_USER_ID || 'user_demo_default',
  };
}

/**
 * 4. TRANSMISSION VERS LA FONCTION SERVERLESS VERCEL
 */
export async function forwardToVercelFunction(params) {
  const vercelEndpoint = process.env.VERCEL_GENERATE_ENDPOINT || 'https://votre-projet.vercel.app/api/generate';
  const url = new URL(vercelEndpoint);

  const payload = JSON.stringify({
    userId: params.userId,
    prompt: params.prompt,
    model: params.model_name,
    duration: params.duration,
  });

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(process.env.INTERNAL_TOOL_SECRET && {
            'x-internal-secret': process.env.INTERNAL_TOOL_SECRET,
          }),
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.error || `Erreur Vercel HTTP ${res.statusCode}: ${rawData}`));
            }
          } catch (e) {
            reject(new Error(`Réponse non-JSON retournée par la fonction Vercel : ${rawData}`));
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

/**
 * 5. HANDLER EXÉCUTIF POUR L'OUTIL ANTIGRAVITY (MCP / RUNTIME)
 */
export async function handleAntiGravityToolCall(rawArgs) {
  try {
    // Étape 1 : Validation et extraction avec normalisation stricte Higgsfield
    const cleanParams = normalizeAndValidateParams(rawArgs);

    // Étape 2 : Transmission sécurisée à la fonction Vercel
    const vercelResult = await forwardToVercelFunction(cleanParams);

    // Étape 3 : Retour formaté pour l'agent AntiGravity
    return {
      success: true,
      data: {
        generationId: vercelResult.generationId,
        higgsfieldModel: cleanParams.model_name,
        duration: cleanParams.duration,
        debitedCost: vercelResult.debitedCost,
        status: vercelResult.status || 'pending',
        message: `Génération transmise à Higgsfield avec succès via le modèle ${cleanParams.model_name} (${cleanParams.duration}s).`,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}
