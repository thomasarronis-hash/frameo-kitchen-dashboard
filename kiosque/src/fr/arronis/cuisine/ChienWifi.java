/*
 * ChienWifi : chien de garde du Wi-Fi du cadre, le remet à zéro quand les gros paquets ne passent plus.
 *
 * Rôle    : un seul par processus. Dès son démarrage puis 30 s après la fin de chaque passage : finir une remise restée
 *           inachevée (RemiseWifi.reprendre), puis, si le Wi-Fi est activé et connecté, télécharger la sonde publique
 *           de 4 Kio (Config.ORIGINE + "/sonde.bin") ; après 2 échecs de suite, couper puis rallumer le Wi-Fi, ce que
 *           faisait « adb shell svc wifi disable / enable » le 14/10 (docs/cadre-ave948.md, « Wi-Fi qui décroche
 *           par moments »).
 * Entrées : un Context (celui de l'application est gardé) ; Config.ORIGINE ; la sonde web/public/sonde.bin du serveur.
 * Sorties : coupure et rallumage du Wi-Fi (RadioWifi) ; marque « remise en cours » dans les SharedPreferences
 *           « chien-wifi » ; lignes logcat (TAG « Cuisine », préfixe « chien Wi-Fi : »), seulement quand quelque chose
 *           se passe (une sonde réussie, cas normal, ne journalise rien).
 * Pièges  :
 *  - web/public/sonde.bin : une fois un kiosque installé, ne JAMAIS la renommer, la déplacer ni changer sa taille
 *    (TAILLE_SONDE, 4 096 octets) : les kiosques installés la cherchent à cette adresse, avec cette taille.
 *  - Pourquoi 4 Kio : la sonde est servie par @fastify/static à pleine vitesse (pas par serveur/cadence.js), sur une
 *    connexion neuve. 4 Kio, c'est un morceau de photo cadencée : la sonde n'envoie jamais au cadre une rafale plus
 *    grosse que les photos (une sonde de 64 Kio serait partie en rafales de 14 puis 29 Ko, le déclencheur supposé des
 *    décrochages). Trois segments TCP pleins suffisent : pendant un décrochage, tout paquet de plus de 1 000 octets
 *    se perd. Contenu figé, pseudo-aléatoire donc incompressible, régénérable à l'identique (sha256 8ca51382...e5a44)
 *    depuis la racine du projet :
 *    python3 -c "import hashlib,sys;sys.stdout.buffer.write(b''.join(hashlib.sha256(b'sonde %d' % i).digest()
 *    for i in range(128)))" > web/public/sonde.bin
 *  - Le serveur relève la liste des fichiers statiques à son démarrage (serveur/app.js) : la sonde n'est servie
 *    qu'après un redéploiement. Avant (404), le passage est NEUTRE : ni échec ni remise (RegleWifi).
 *  - Origine en boucle locale (127.0.0.1 ou localhost, jour J) : la sonde passerait par adb reverse sur le câble USB,
 *    pas par le Wi-Fi. Le chien ne démarre pas et le dit en une ligne de logcat.
 *  - Un seul chien par processus (demarrer, sur le thread UI, sans effet au 2e appel) et jamais arrêté par
 *    l'activité : une recréation de MainActivity (police ou langue changée dans les Réglages) n'oublie ni les échecs
 *    ni l'espacement de 5 min, et deux chiens ne sondent ni ne coupent jamais en même temps. Il meurt avec le
 *    processus.
 *  - Les décisions (échecs, espacements) sont dans RegleWifi, le déroulé d'une remise et sa reprise dans RemiseWifi,
 *    toutes deux pures et vérifiées par build.sh ; ici, seulement Android et HTTP. Échec = erreur de transport (délai,
 *    connexion refusée ou coupée, corps de plus de 10 s).
 *  - Remise interrompue : la marque est écrite par commit() (synchrone) AVANT la coupure, effacée quand le Wi-Fi est
 *    constaté allumé. Processus mort pendant la remise ou puce pas remontée : le démarrage suivant ou le passage
 *    suivant rallume. Un Wi-Fi coupé à la main (sans marque) n'est jamais rallumé.
 *  - Coupure sans effet (refus, consentement demandé à l'écran) : le chien s'arrête jusqu'au prochain démarrage du
 *    processus du kiosque.
 *  - Délais : 10 s pour la connexion, 10 s pour les en-têtes, 10 s pour tout le corps (vérifié entre deux lectures,
 *    chaque lecture bornée à 10 s) : une sonde dure 40 s au pire.
 *  - Thread à lui (HandlerThread « chien-wifi ») : sonde, coupure et rallumage ne touchent jamais au thread UI.
 *    Passage suivant 30 s après la FIN du précédent : jamais deux sondes à la fois.
 *  - Connection: close et Accept-Encoding: identity : chaque sonde ouvre une connexion neuve et reçoit les 4 Kio
 *    tels quels. Aucune clé d'appareil ne part : sonde publique, et les cookies de la WebView ne sont pas ceux
 *    de HttpURLConnection.
 *  - Horloge : SystemClock.elapsedRealtime (monotone), l'heure murale du cadre est fausse après un redémarrage
 *    sans réseau.
 */
package fr.arronis.cuisine;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class ChienWifi {

    static final String TAG = "Cuisine";
    static final String PREFIXE = "chien Wi-Fi : ";
    private static final String URL_SONDE = Config.ORIGINE + "/sonde.bin";
    private static final int TAILLE_SONDE = 4096;
    private static final long INTERVALLE_MS = 30000;
    private static final int DELAI_RESEAU_MS = 10000;
    private static final String PREFERENCES = "chien-wifi";
    private static final String PREF_REMISE_EN_COURS = "remise_en_cours";

    /** Le chien du processus ; lu et écrit seulement sur le thread UI (demarrer). */
    private static ChienWifi unique;

    /** Issue d'une sonde : le résultat pour RegleWifi et un détail lisible pour logcat. */
    private static final class Mesure {
        static final Mesure HORS_LIGNE = new Mesure(RegleWifi.Resultat.HORS_LIGNE, "Wi-Fi désactivé ou pas connecté");

        final RegleWifi.Resultat resultat;
        final String detail;

        Mesure(RegleWifi.Resultat resultat, String detail) {
            this.resultat = resultat;
            this.detail = detail;
        }
    }

    /** Marque « remise en cours » de RemiseWifi, écrite par commit() : sur disque avant que la coupure ne parte. */
    private static final class MarqueDisque implements RemiseWifi.Marque {
        private final SharedPreferences preferences;

        MarqueDisque(SharedPreferences preferences) {
            this.preferences = preferences;
        }

        @Override
        public boolean posee() {
            return preferences.getBoolean(PREF_REMISE_EN_COURS, false);
        }

        @Override
        public void poser() {
            ecrire(true);
        }

        @Override
        public void effacer() {
            ecrire(false);
        }

        private void ecrire(boolean posee) {
            if (!preferences.edit().putBoolean(PREF_REMISE_EN_COURS, posee).commit()) {
                Log.w(TAG, PREFIXE + "marque de remise non écrite sur disque (" + posee + ")");
            }
        }
    }

    private final WifiManager wifi;
    private final ConnectivityManager connectivite;
    private final RemiseWifi.Radio radio;
    private final RemiseWifi.Marque marque;
    private Handler file;
    /** Lus et écrits seulement sur le thread du chien. */
    private RegleWifi.Etat etat = RegleWifi.Etat.INITIAL;
    private boolean arrete;

    private final Runnable passage = new Runnable() {
        @Override
        public void run() {
            try {
                passer();
            } catch (RuntimeException e) {
                Log.e(TAG, PREFIXE + "passage en erreur, chien maintenu", e);
            }
            if (arrete) {
                file.getLooper().quitSafely();
            } else {
                file.postDelayed(this, INTERVALLE_MS);
            }
        }
    };

    private ChienWifi(Context appli) {
        wifi = (WifiManager) appli.getSystemService(Context.WIFI_SERVICE);
        connectivite = (ConnectivityManager) appli.getSystemService(Context.CONNECTIVITY_SERVICE);
        radio = new RadioWifi(wifi);
        marque = new MarqueDisque(appli.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE));
    }

    /** Démarre le chien du processus (thread UI) ; sans effet s'il tourne déjà ou si l'origine est en boucle locale. */
    static void demarrer(Context contexte) {
        if (unique != null) {
            return;
        }
        if (RegleWifi.origineEnBoucleLocale(Config.ORIGINE)) {
            Log.i(TAG, PREFIXE + "non démarré, origine " + Config.ORIGINE
                    + " en boucle locale (adb reverse par le câble USB, pas le Wi-Fi)");
            return;
        }
        unique = new ChienWifi(contexte.getApplicationContext());
        unique.lancer();
    }

    private void lancer() {
        HandlerThread fil = new HandlerThread("chien-wifi");
        fil.start();
        file = new Handler(fil.getLooper());
        file.post(passage);
        Log.i(TAG, PREFIXE + "démarré, sonde " + URL_SONDE + " toutes les " + RegleWifi.duree(INTERVALLE_MS));
    }

    /** Un passage : remise inachevée, état du Wi-Fi, sonde, décision de RegleWifi, remise éventuelle. */
    private void passer() {
        reprendre();
        Mesure mesure = wifiConnecte() ? sonder() : Mesure.HORS_LIGNE;
        RegleWifi.Decision decision = RegleWifi.decider(etat, mesure.resultat, SystemClock.elapsedRealtime());
        etat = decision.etat;
        if (decision.motif != null) {
            boolean grave = mesure.resultat == RegleWifi.Resultat.ECHEC || mesure.resultat == RegleWifi.Resultat.NEUTRE;
            Log.println(grave ? Log.WARN : Log.INFO, TAG, PREFIXE + mesure.detail + " -> " + decision.motif);
        }
        if (decision.remettre) {
            remettreAZero();
        }
    }

    /** Finit une remise restée inachevée (processus mort pendant la remise, puce pas remontée). */
    private void reprendre() {
        RemiseWifi.Reprise reprise = RemiseWifi.reprendre(radio, marque);
        if (reprise == RemiseWifi.Reprise.ACHEVEE) {
            Log.i(TAG, PREFIXE + "remise précédente inachevée, Wi-Fi déjà allumé : marque effacée");
        } else if (reprise == RemiseWifi.Reprise.RALLUME) {
            Log.w(TAG, PREFIXE + "remise précédente inachevée : Wi-Fi rallumé");
        } else if (reprise == RemiseWifi.Reprise.TOUJOURS_ETEINT) {
            Log.w(TAG, PREFIXE + "remise précédente inachevée : Wi-Fi toujours éteint, nouvel essai dans "
                    + RegleWifi.duree(INTERVALLE_MS));
        }
    }

    /** Coupe puis rallume le Wi-Fi ; une coupure sans effet arrête le chien (refus ou consentement demandé). */
    private void remettreAZero() {
        RemiseWifi.Issue issue = RemiseWifi.remettre(radio, marque);
        if (issue == RemiseWifi.Issue.A_REPRENDRE) {
            Log.w(TAG, PREFIXE + "Wi-Fi pas rallumé après la remise : nouvel essai dans "
                    + RegleWifi.duree(INTERVALLE_MS));
        } else if (issue == RemiseWifi.Issue.SANS_EFFET) {
            arrete = true;
            Log.e(TAG, PREFIXE + "coupure sans effet (refus du système ou demande de consentement à l'écran) : "
                    + "chien arrêté jusqu'au prochain démarrage du kiosque");
        }
    }

    /**
     * Vrai si le Wi-Fi est activé et porte le réseau actif, connecté. NetworkInfo (déprécié en API 29) est nommé en
     * entier : en Java 8, importer une classe dépréciée donne un avertissement que @SuppressWarnings ne couvre pas.
     */
    @SuppressWarnings("deprecation")
    private boolean wifiConnecte() {
        if (!wifi.isWifiEnabled()) {
            return false;
        }
        android.net.NetworkInfo actif = connectivite.getActiveNetworkInfo();
        return actif != null && actif.getType() == ConnectivityManager.TYPE_WIFI && actif.isConnected();
    }

    /** GET de la sonde : corps lu en entier, en 10 s au plus après les en-têtes, et longueur vérifiée. */
    private static Mesure sonder() {
        HttpURLConnection connexion = null;
        try {
            connexion = (HttpURLConnection) new URL(URL_SONDE).openConnection();
            connexion.setUseCaches(false);
            connexion.setConnectTimeout(DELAI_RESEAU_MS);
            connexion.setReadTimeout(DELAI_RESEAU_MS);
            connexion.setRequestProperty("Connection", "close");
            connexion.setRequestProperty("Accept-Encoding", "identity");
            int code = connexion.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                return new Mesure(RegleWifi.Resultat.NEUTRE, "code HTTP " + code);
            }
            return lireCorps(connexion.getInputStream());
        } catch (IOException e) {
            return new Mesure(RegleWifi.Resultat.ECHEC, e.getClass().getSimpleName() + " (" + e.getMessage() + ")");
        } finally {
            if (connexion != null) {
                connexion.disconnect();
            }
        }
    }

    /** Lit le corps jusqu'au bout ; trop lent : échec ; fin normale mais mauvaise taille : neutre. */
    private static Mesure lireCorps(InputStream corps) throws IOException {
        long limite = SystemClock.elapsedRealtime() + DELAI_RESEAU_MS;
        byte[] tampon = new byte[8192];
        int total = 0;
        int lus;
        while (total <= TAILLE_SONDE && (lus = corps.read(tampon)) != -1) {
            total += lus;
            if (SystemClock.elapsedRealtime() > limite) {
                return new Mesure(RegleWifi.Resultat.ECHEC, "corps trop lent (" + total + " octets en "
                        + RegleWifi.duree(DELAI_RESEAU_MS) + ")");
            }
        }
        if (total > TAILLE_SONDE) {
            return new Mesure(RegleWifi.Resultat.NEUTRE, "sonde de plus de " + TAILLE_SONDE + " octets");
        }
        if (total < TAILLE_SONDE) {
            return new Mesure(RegleWifi.Resultat.NEUTRE, "sonde de " + total + " octets au lieu de " + TAILLE_SONDE);
        }
        return new Mesure(RegleWifi.Resultat.SUCCES, TAILLE_SONDE + " octets reçus");
    }
}
