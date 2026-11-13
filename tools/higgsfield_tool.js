#!/usr/bin/env node

/**
 * Higgsfield MCP Server / Tool Handler pour Antigravity
 * Ce script implémente le protocole MCP (JSON-RPC 2.0 stdio) pour exposer
 * l'outil 'trigger_higgsfield_generation' à l'agent Antigravity.
 */

import https from 'https';
import http from 'http';

// Table de normalisation stricte vers les identifiants Higgsfield officiels
const HIGGSFIELD_STRICT_MODELS = {
  // Alias Kling
  'kling': 'kling-3.0',
  'kling 3.0': 'kling-3.0',
  'kling 3': 'kling-3.0',
  'kling-3.0': 'kling-3.0',
  'kling3': 'kling-3.0',

  // Alias MiniMax
  'minimax': 'minimax-h3',
  'minimax h3': 'minimax-h3',
  'minimax-h3': 'minimax-h3',
  'h3': 'minimax-h3',

  // Alias Soul 2
  'soul': 'soul-2',
  'soul 2': 'soul-2',
  'soul-2': 'soul-2',
  'soul2': 'soul-2'
};

const ALLOWED_DURATIONS = [5, 10];

/**
 * Normalise et valide le modèle utilisateur
 */
function normalizeModelName(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') {
    throw new Error("Le paramètre 'model_name' est manquant ou invalide.");
  }
  const normalizedKey = rawModel.trim().toLowerCase();
  const strictId = HIGGSFIELD_STRICT_MODELS[normalizedKey];

  if (!strictId) {
    throw new Error(
      `Modèle inconnu : "${rawModel}". Les identifiants stricts supportés sont : 'kling-3.0', 'minimax-h3', ou 'soul-2'.`
    );
  }
  return strictId;
}

/**
 * Normalise et valide la durée
 */
function normalizeDuration(rawDuration) {
  const duration = Number(rawDuration) || 5;
  if (!ALLOWED_DURATIONS.includes(duration)) {
    throw new Error(`Durée non supportée : ${duration}s. Les durées valides sont 5 ou 10 secondes.`);
  }
  return duration;
}

/**
 * Envoie la requête POST à la fonction serverless Vercel
 */
async function sendToVercelFunction({ prompt, model_name, duration, userId }) {
  const vercelApiUrl = process.env.VERCEL_GENERATE_ENDPOINT || 'http://localhost:3000/api/generate';
  const urlObj = new URL(vercelApiUrl);

  const payload = JSON.stringify({
    userId: userId,
    prompt: prompt.trim(),
    model: model_name,
    duration: duration,
  });

  return new Promise((resolve, reject) => {
    const client = urlObj.protocol === 'https:' ? https : http;

    const req = client.request(
      urlObj,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(process.env.INTERNAL_API_SECRET && {
            'x-api-secret': process.env.INTERNAL_API_SECRET
          })
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.error || `Erreur HTTP ${res.statusCode}: ${body}`));
            }
          } catch (e) {
            reject(new Error(`Réponse Vercel invalide (non-JSON): ${body}`));
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
 * Handler principal de l'outil Antigravity
 */
export async function executeTool(args) {
  const { prompt, model_name, duration, userId } = args;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error("Le paramètre 'prompt' est obligatoire.");
  }

  if (!userId) {
    throw new Error("Le paramètre 'userId' est requis pour débiter le solde.");
  }

  // 1. Normalisation stricte des paramètres
  const strictModel = normalizeModelName(model_name);
  const strictDuration = normalizeDuration(duration);

  // 2. Transmission sécurisée à la fonction Vercel
  const result = await sendToVercelFunction({
    prompt: prompt.trim(),
    model_name: strictModel,
    duration: strictDuration,
    userId: userId,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: 'Tâche soumise à Higgsfield via Vercel avec succès.',
          higgsfield_model: strictModel,
          duration: strictDuration,
          generationId: result.generationId,
          debitedCost: result.debitedCost,
        }, null, 2),
      },
    ],
  };
}

// Support de l'exécution en CLI / MCP stdio direct
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  let input = '';
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', async () => {
    try {
      const data = JSON.parse(input || '{}');
      const response = await executeTool(data);
      console.log(JSON.stringify(response, null, 2));
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }
  });
}
