// Dans api/webhook.js (Assurez-vous d'avoir initialisé Firebase Admin)

if (req.body.status === 'SUCCESS' || req.body.status === 'COMPLETED') {
    const videoUrl = req.body.video_url || req.body.url;
    
    // Le userId doit être transmis par Higgsfield depuis votre requête initiale
    // via un champ de métadonnées (metadata) ou l'URL du webhook
    const userId = req.body.metadata.userId; 
    
    // Création de l'enregistrement dans la sous-collection "historique"
    await admin.firestore().collection('users').doc(userId).collection('historique').add({
        video_url: videoUrl,
        prompt: req.body.metadata.prompt || "Création visuelle",
        model: req.body.metadata.model || "kling_3",
        date: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ message: 'Vidéo sauvegardée dans l\'historique Firebase' });
}
