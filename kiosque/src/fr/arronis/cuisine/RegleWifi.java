/*
 * RegleWifi : règle de décision du chien de garde Wi-Fi (ChienWifi), sans aucun appel Android.
 *
 * Rôle    : après chaque passage du chien, dire s'il faut remettre le Wi-Fi à zéro, à partir des échecs de suite,
 *           de l'instant de la dernière remise et du nombre de remises restées sans succès ; dire aussi si le chien
 *           a lieu d'être (pas avec une origine en boucle locale).
 * Entrées : decider(etat, resultat, maintenantMs) ; maintenantMs vient d'une horloge monotone
 *           (SystemClock.elapsedRealtime côté Android), jamais de l'heure murale. origineEnBoucleLocale(origine).
 * Sorties : une Decision : l'état suivant, remettre (vrai : couper puis rallumer le Wi-Fi) et un motif en français
 *           pour logcat (null : rien à journaliser, cas normal d'une sonde réussie).
 * Pièges  :
 *  - Classe pure (ni android.*, ni horloge, ni hasard) : build.sh la vérifie avec le JDK seul
 *    (kiosque/tests/fr/arronis/cuisine/TestRegleWifi.java). N'y ajouter aucun import Android.
 *  - Origine en boucle locale (127.x.x.x, localhost : jour J, adb reverse) : la sonde passerait par le câble USB,
 *    pas par le Wi-Fi ; couper le Wi-Fi sur ses échecs n'aurait pas de sens. build.sh refuse les adresses IPv6.
 *  - Horloge monotone : l'heure du cadre est fausse après un redémarrage sans réseau (docs/cadre-ave948.md).
 *  - JAMAIS (-1) veut dire « aucune remise » : pas de Long.MIN_VALUE, la soustraction déborderait.
 *  - Remise faite : échecs remis à 0, il en faut de nouveau 2 de suite. Remise différée (trop tôt) : les échecs
 *    continuent de compter, la remise part au premier échec qui suit la fin de l'espacement.
 *  - NEUTRE (le serveur a répondu, mais pas la sonde attendue : 404 avant le redéploiement, autre taille) ne compte
 *    ni comme succès ni comme échec : le Wi-Fi a porté la réponse, le couper ne servirait à rien.
 *  - HORS_LIGNE (Wi-Fi désactivé ou pas connecté) : Android s'en charge, les échecs d'avant sont oubliés. Seule
 *    exception, hors de cette règle : une remise du chien restée inachevée, que RemiseWifi finit de rallumer.
 */
package fr.arronis.cuisine;

import java.net.URI;
import java.util.regex.Pattern;

final class RegleWifi {

    static final int ECHECS_AVANT_REMISE = 2;
    static final long ESPACEMENT_MS = 5 * 60 * 1000L;
    static final int REMISES_AVANT_RALENTI = 3;
    static final long ESPACEMENT_RALENTI_MS = 30 * 60 * 1000L;
    static final long JAMAIS = -1L;
    private static final Pattern IPV4_BOUCLE_LOCALE = Pattern.compile("127(\\.[0-9]{1,3}){3}");

    /** Issue d'un passage du chien. */
    enum Resultat { SUCCES, ECHEC, NEUTRE, HORS_LIGNE }

    /** État du chien entre deux passages (immuable). */
    static final class Etat {
        static final Etat INITIAL = new Etat(0, JAMAIS, 0);

        final int echecsDeSuite;
        final long derniereRemiseMs;
        final int remisesSansSucces;

        Etat(int echecsDeSuite, long derniereRemiseMs, int remisesSansSucces) {
            this.echecsDeSuite = echecsDeSuite;
            this.derniereRemiseMs = derniereRemiseMs;
            this.remisesSansSucces = remisesSansSucces;
        }
    }

    /** Ce que le chien doit faire après un passage. */
    static final class Decision {
        final Etat etat;
        final boolean remettre;
        final String motif;

        Decision(Etat etat, boolean remettre, String motif) {
            this.etat = etat;
            this.remettre = remettre;
            this.motif = motif;
        }
    }

    private RegleWifi() {
    }

    static Decision decider(Etat etat, Resultat resultat, long maintenantMs) {
        switch (resultat) {
            case SUCCES:
                return apresSucces(etat);
            case HORS_LIGNE:
                return horsLigne(etat);
            case NEUTRE:
                return new Decision(etat, false, "serveur joint mais sonde inattendue : ni succès ni échec");
            default: // ECHEC
                return apresEchec(etat, maintenantMs);
        }
    }

    private static Decision apresSucces(Etat etat) {
        Etat suivant = new Etat(0, etat.derniereRemiseMs, 0);
        if (etat.echecsDeSuite == 0 && etat.remisesSansSucces == 0) {
            return new Decision(suivant, false, null);
        }
        return new Decision(suivant, false, "sonde revenue après " + etat.echecsDeSuite + " échec(s) de suite et "
                + etat.remisesSansSucces + " remise(s) sans succès");
    }

    private static Decision horsLigne(Etat etat) {
        Etat suivant = new Etat(0, etat.derniereRemiseMs, etat.remisesSansSucces);
        if (etat.echecsDeSuite == 0) {
            return new Decision(suivant, false, null);
        }
        return new Decision(suivant, false, "Wi-Fi coupé ou pas connecté : Android s'en charge, "
                + etat.echecsDeSuite + " échec(s) oublié(s)");
    }

    private static Decision apresEchec(Etat etat, long maintenantMs) {
        int echecs = etat.echecsDeSuite + 1;
        if (echecs < ECHECS_AVANT_REMISE) {
            return new Decision(new Etat(echecs, etat.derniereRemiseMs, etat.remisesSansSucces), false,
                    "échec " + echecs + " sur " + ECHECS_AVANT_REMISE + " avant remise à zéro");
        }
        long espacement = etat.remisesSansSucces >= REMISES_AVANT_RALENTI ? ESPACEMENT_RALENTI_MS : ESPACEMENT_MS;
        long reste = etat.derniereRemiseMs == JAMAIS ? 0 : espacement - (maintenantMs - etat.derniereRemiseMs);
        if (reste > 0) {
            return new Decision(new Etat(echecs, etat.derniereRemiseMs, etat.remisesSansSucces), false,
                    echecs + " échecs de suite, remise différée de " + duree(reste) + " (au plus une toutes les "
                            + duree(espacement) + ")");
        }
        int remises = etat.remisesSansSucces + 1;
        return new Decision(new Etat(0, maintenantMs, remises), true,
                echecs + " échecs de suite : remise à zéro du Wi-Fi (n° " + remises + " depuis le dernier succès)");
    }

    /** Vrai si l'hôte de l'origine (http://hote:port) est en boucle locale : 127.x.x.x ou localhost. */
    static boolean origineEnBoucleLocale(String origine) {
        String hote = URI.create(origine).getHost();
        return hote != null && ("localhost".equalsIgnoreCase(hote) || IPV4_BOUCLE_LOCALE.matcher(hote).matches());
    }

    /** Durée lisible, arrondie à la seconde supérieure : « 45 s », « 4 min 30 s », « 30 min ». */
    static String duree(long ms) {
        long secondes = (ms + 999) / 1000;
        if (secondes < 60) {
            return secondes + " s";
        }
        long minutes = secondes / 60;
        long reste = secondes % 60;
        return reste == 0 ? minutes + " min" : minutes + " min " + reste + " s";
    }
}
