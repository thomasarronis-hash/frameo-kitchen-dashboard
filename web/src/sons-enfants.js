// web/src/sons-enfants.js
//
// Rôle    : les petits sons du tableau des enfants (choix de Thomas du 14/10, partie 4), doux et courts, en WebAudio : une
//           étape validée, les pièces qui tombent dans la bourse, le coffre qui s'ouvre, l'étoile de Pablo, un point gagné,
//           et la fin du minuteur d'écran (« Fin de la vidéo, puis on éteint »).
// Entrées : creerSonsEnfants({ obtenirContexte (() -> l'AudioContext partagé de la page, ou null) }) ; jouer(nom) après un
//           geste (ou à la fin du minuteur) ; deverrouiller() à chaque toucher sur l'écran des enfants.
// Sorties : creerSonsEnfants(...) -> { deverrouiller(), jouer(nom) -> vrai si le son est parti } ; SONS (description des
//           notes, testée sans audio) ; VOLUME_MAX.
// Pièges  :
//   - Pas de vacarme : sinusoïdes et triangles, volume crête 0,18 (la sonnerie des minuteurs est carrée à 0,12), attaque de
//     10 ms et extinction exponentielle, rien au-delà de 1,6 s. Un son de fin doux, pas d'alarme ni de bip d'avertissement
//     avant la fin (Hiniker, CHI 2016, cité par les propositions).
//   - Le contexte audio est celui de la sonnerie (main.js le partage) : un seul AudioContext pour la page, 2 Go de mémoire.
//     Suspendu (aucun toucher depuis le chargement, politique de lecture automatique), le son est simplement sauté : le
//     visuel suffit, rien ne lève.
//   - Notes planifiées sur l'horloge audio (précise), aucun minuteur JS.

export const VOLUME_MAX = 0.18;
const ATTAQUE_S = 0.01;
const AVANCE_S = 0.02;

const note = (frequence, debut, duree, type, fin) => ({
  frequence, debut, duree, type: type || 'sine', fin: fin || frequence,
});

export const SONS = {
  etape: [note(660, 0, 0.18), note(990, 0.12, 0.3)],
  piece: [note(1320, 0, 0.1, 'triangle'), note(1760, 0.08, 0.12, 'triangle'), note(1568, 0.2, 0.14, 'triangle')],
  coffre: [note(523, 0, 0.2, 'triangle'), note(659, 0.16, 0.2, 'triangle'), note(784, 0.32, 0.2, 'triangle'), note(1047, 0.48, 0.6, 'triangle')],
  etoile: [note(600, 0, 0.32, 'sine', 1200), note(1568, 0.28, 0.25)],
  point: [note(880, 0, 0.25), note(1175, 0.1, 0.35)],
  fin: [note(784, 0, 0.6), note(523, 0.45, 0.9), note(784, 1.0, 0.5), note(523, 1.1, 0.5)],
};

export function creerSonsEnfants({ obtenirContexte }) {
  function contexte() {
    try {
      return obtenirContexte() || null;
    } catch (err) {
      return null;
    }
  }

  return {
    deverrouiller() {
      const audio = contexte();
      if (!audio || audio.state !== 'suspended' || typeof audio.resume !== 'function') return;
      const promesse = audio.resume();
      if (promesse && typeof promesse.catch === 'function') promesse.catch(() => {});
    },
    jouer(nom) {
      const audio = contexte();
      const notes = SONS[nom];
      if (!audio || audio.state !== 'running' || !notes) return false;
      try {
        const depart = audio.currentTime + AVANCE_S;
        notes.forEach((n) => {
          const oscillateur = audio.createOscillator();
          const gain = audio.createGain();
          const debut = depart + n.debut;
          oscillateur.type = n.type;
          oscillateur.frequency.setValueAtTime(n.frequence, debut);
          if (n.fin !== n.frequence) oscillateur.frequency.exponentialRampToValueAtTime(n.fin, debut + n.duree);
          gain.gain.setValueAtTime(0.0001, debut);
          gain.gain.exponentialRampToValueAtTime(VOLUME_MAX, debut + ATTAQUE_S);
          gain.gain.exponentialRampToValueAtTime(0.0001, debut + n.duree);
          oscillateur.connect(gain);
          gain.connect(audio.destination);
          oscillateur.start(debut);
          oscillateur.stop(debut + n.duree + 0.02);
        });
        return true;
      } catch (err) {
        console.warn('sons des enfants : son impossible', err);
        return false;
      }
    },
  };
}
