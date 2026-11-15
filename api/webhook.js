// À appeler lorsque l'utilisateur clique sur le bouton "Mes Créations"
async function chargerHistorique(userId) {
    const galerieContainer = document.getElementById('historique-grid');
    galerieContainer.innerHTML = '<p class="text-gray-400 font-raleway text-sm col-span-2 text-center mt-10">Chargement des créations...</p>';

    try {
        // Lecture de Firebase, de la vidéo la plus récente à la plus ancienne
        const snapshot = await firebase.firestore().collection('users').doc(userId).collection('historique')
                                 .orderBy('date', 'desc').get();
        
        galerieContainer.innerHTML = ''; 
        
        if (snapshot.empty) {
            galerieContainer.innerHTML = '<p class="text-gray-500 font-raleway text-sm col-span-2 text-center mt-10">Votre historique est vide. Lancez votre première génération !</p>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            // Création de la carte vidéo au format Glassmorphism
            const element = `
                <div class="relative group rounded-2xl overflow-hidden border border-white/5 hover:border-purple-500/50 hover:shadow-[0_0_15px_rgba(168,85,247,0.2)] transition-all cursor-pointer">
                    <video src="${data.video_url}" class="w-full h-40 object-cover" loop muted onmouseover="this.play()" onmouseout="this.pause()"></video>
                    <div class="absolute bottom-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent pt-6 pb-2 px-3">
                        <p class="text-xs text-gray-300 truncate font-raleway">${data.prompt}</p>
                    </div>
                </div>
            `;
            galerieContainer.insertAdjacentHTML('beforeend', element);
        });
    } catch (error) {
        console.error("Erreur lors de la lecture de l'historique :", error);
        galerieContainer.innerHTML = '<p class="text-red-400 text-sm">Erreur de connexion.</p>';
    }
}
