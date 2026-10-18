// web/src/sonnerie.js
//
// Rôle    : la sonnerie des minuteurs : trois bips aigus chaque seconde jusqu'à l'arrêt, en WebAudio quand son
//           contexte tourne, sinon par un élément <audio> qui joue un WAV fabriqué ici ; volume média remonté
//           juste avant.
// Entrées : creerSonnerie({ creerContexte (() -> AudioContext ou null), creerAudio (octets WAV -> élément
//           <audio>), kiosque (kiosque.js) }) ; entretenir() à chaque tick de main.js (une fois par seconde).
// Sorties : creerSonnerie(...) -> { deverrouiller(), demarrer(), entretenir(), arreter(), active() } ;
//           genererWav() -> Uint8Array (WAV PCM 16 bits mono, les trois bips) ; VOLUME_SONNERIE (80).
// Pièges  :
//   - Politique de lecture automatique : un AudioContext créé sans geste reste « suspended » dans Chrome.
//     main.js appelle deverrouiller() à chaque toucher (le lancement d'un minuteur en est un) ; dans le kiosque,
//     setMediaPlaybackRequiresUserGesture(false) doit aussi permettre une sonnerie après un rechargement, sans
//     toucher (test du son du 13/10, conception §0.2). Son effet sur WebAudio est une supposition [S] : à chaque
//     série de bips, WebAudio n'est employé que si son contexte est « running » ; suspendu (sonnerie après un
//     rechargement, sans toucher), c'est l'élément <audio> qui sonne, et WebAudio reprend dès qu'un toucher l'a
//     déverrouillé. Le test du 13/10 tranche ainsi sans changer le code (conception §4 : « celui qui marche sans
//     geste »).
//   - Volume réglé par le pont AU DÉBUT de chaque sonnerie, quelqu'un a pu baisser le son depuis : remonté à
//     80 % s'il est plus bas, laissé tel quel s'il est plus haut (monté pour couvrir la hotte) ; repli
//     silencieux hors du kiosque (kiosque.js).
//   - Les bips sont planifiés sur l'horloge audio (précise) à chaque tick : pas de minuteur JS de plus que le
//     tick central. arreter() coupe aussi les bips déjà planifiés ; appelé sans sonnerie en cours (chaque
//     seconde par main.js), il ne fait rien.
//   - Onde carrée à 880 Hz, perçante ; amplitude 0,12 (0,5 avant le 16/10, « une vraie alarme » : -76 %, choix de
//     Thomas), assez pour l'évier sans faire sursauter.
//   - Aucun appel qui lève ne remonte : sans son possible, l'alerte plein écran reste.

export const VOLUME_SONNERIE = 80;
const FREQUENCE = 880;
const DEBUTS_BIPS_S = [0, 0.25, 0.5];
const DUREE_BIP_S = 0.15;
const VOLUME_ONDE = 0.12;
const AVANCE_S = 0.02;
const TAUX_WAV = 8000;
const FIN_MOTIF_S = 0.7;

// WAV PCM 16 bits mono : en-tête RIFF de 44 octets, puis les échantillons (bips carrés, silence entre).
export function genererWav() {
  const echantillons = Math.round(TAUX_WAV * FIN_MOTIF_S);
  const octets = new Uint8Array(44 + echantillons * 2);
  const vue = new DataView(octets.buffer);
  const ecrireTexte = (position, texte) => {
    for (let i = 0; i < texte.length; i += 1) octets[position + i] = texte.charCodeAt(i);
  };
  ecrireTexte(0, 'RIFF');
  vue.setUint32(4, 36 + echantillons * 2, true);
  ecrireTexte(8, 'WAVE');
  ecrireTexte(12, 'fmt ');
  vue.setUint32(16, 16, true);
  vue.setUint16(20, 1, true);
  vue.setUint16(22, 1, true);
  vue.setUint32(24, TAUX_WAV, true);
  vue.setUint32(28, TAUX_WAV * 2, true);
  vue.setUint16(32, 2, true);
  vue.setUint16(34, 16, true);
  ecrireTexte(36, 'data');
  vue.setUint32(40, echantillons * 2, true);
  const amplitude = Math.round(32767 * VOLUME_ONDE);
  for (let i = 0; i < echantillons; i += 1) {
    const t = i / TAUX_WAV;
    const dansUnBip = DEBUTS_BIPS_S.some((debut) => t >= debut && t < debut + DUREE_BIP_S);
    const valeur = dansUnBip ? (Math.floor(t * FREQUENCE * 2) % 2 === 0 ? amplitude : -amplitude) : 0;
    vue.setInt16(44 + i * 2, valeur, true);
  }
  return octets;
}

export function creerSonnerie({ creerContexte, creerAudio, kiosque }) {
  let contexte;
  let audio = null;
  let active = false;
  let notes = [];

  function obtenirContexte() {
    if (contexte === undefined) {
      try {
        contexte = creerContexte() || null;
      } catch (err) {
        contexte = null;
      }
    }
    return contexte;
  }

  function deverrouiller() {
    const audioContexte = obtenirContexte();
    if (!audioContexte || audioContexte.state !== 'suspended' || typeof audioContexte.resume !== 'function') return;
    const promesse = audioContexte.resume();
    if (promesse && typeof promesse.catch === 'function') promesse.catch(() => {});
  }

  function bipsWebAudio(audioContexte) {
    const depart = audioContexte.currentTime + AVANCE_S;
    notes = notes.filter((note) => note.fin > audioContexte.currentTime);
    DEBUTS_BIPS_S.forEach((debut) => {
      const oscillateur = audioContexte.createOscillator();
      const gain = audioContexte.createGain();
      oscillateur.type = 'square';
      oscillateur.frequency.value = FREQUENCE;
      gain.gain.value = VOLUME_ONDE;
      oscillateur.connect(gain);
      gain.connect(audioContexte.destination);
      oscillateur.start(depart + debut);
      oscillateur.stop(depart + debut + DUREE_BIP_S);
      notes.push({ oscillateur, fin: depart + debut + DUREE_BIP_S });
    });
  }

  function bipsAudio() {
    if (!audio) audio = creerAudio(genererWav());
    audio.currentTime = 0;
    const promesse = audio.play();
    if (promesse && typeof promesse.catch === 'function') promesse.catch(() => {});
  }

  function jouer() {
    try {
      const audioContexte = obtenirContexte();
      if (audioContexte && audioContexte.state === 'running') bipsWebAudio(audioContexte);
      else bipsAudio();
    } catch (err) {
      console.warn('sonnerie : son impossible', err);
    }
  }

  return {
    deverrouiller,
    demarrer() {
      if (active) return;
      active = true;
      kiosque.volumeAuMoins(VOLUME_SONNERIE);
      deverrouiller();
      jouer();
    },
    entretenir() {
      if (active) jouer();
    },
    arreter() {
      if (!active) return;
      active = false;
      notes.forEach((note) => {
        try {
          note.oscillateur.stop();
        } catch (err) {
          // Bip déjà terminé : rien à couper.
        }
      });
      notes = [];
      if (audio) audio.pause();
    },
    active: () => active,
  };
}
