/*
 * RemiseWifi : déroulé d'une remise à zéro du Wi-Fi (couper, rallumer, constater) et sa reprise quand elle est restée
 * inachevée, sans aucun appel Android.
 *
 * Rôle    : garantir qu'une remise commencée par le chien (ChienWifi) finit par un Wi-Fi rallumé, même si le processus
 *           du kiosque meurt entre la coupure et le rallumage (adb install -r, tueur de mémoire) ou si la puce RK915 ne
 *           remonte pas du premier coup.
 * Entrées : une Radio (le Wi-Fi ; côté Android : RadioWifi) et une Marque « remise en cours » gardée sur disque (côté
 *           Android : les SharedPreferences « chien-wifi » de ChienWifi).
 * Sorties : remettre() rend l'Issue de la remise ; reprendre(), appelé au démarrage du chien puis à chaque passage,
 *           rend ce qu'il a fait d'une remise inachevée (Reprise). Les lignes logcat sont écrites par ChienWifi.
 * Pièges  :
 *  - setWifiEnabled(false) est persistant sous Android 9 (Settings.Global.WIFI_ON) : il survit à la mort du processus
 *    et au redémarrage, et un finally n'y peut rien. D'où la marque, posée AVANT la coupure et effacée seulement quand
 *    le Wi-Fi est constaté allumé.
 *  - Sans marque, reprendre() ne touche à rien : un Wi-Fi coupé à la main dans les Réglages le reste.
 *  - Le rallumage part TOUJOURS (finally), même si la coupure n'a pas été constatée ou a levé une exception.
 *  - Classe pure, comme RegleWifi : build.sh la vérifie avec le JDK seul
 *    (kiosque/tests/fr/arronis/cuisine/TestRemiseWifi.java). N'y ajouter aucun import Android.
 */
package fr.arronis.cuisine;

final class RemiseWifi {

    /** Le Wi-Fi vu par la remise ; les attentes bornées (coupure, allumage) sont du côté Android. */
    interface Radio {
        /** Demande la coupure et attend qu'elle soit constatée ; vrai si le Wi-Fi a quitté l'état allumé. */
        boolean couper();

        /** Demande le rallumage et attend qu'il soit constaté ; vrai si le Wi-Fi est allumé. */
        boolean rallumer();

        /** Vrai si le Wi-Fi est allumé (activé, connecté ou non). */
        boolean allume();
    }

    /** Marque « remise en cours », gardée sur disque : elle survit à la mort du processus. */
    interface Marque {
        boolean posee();

        void poser();

        void effacer();
    }

    /** Issue d'une remise. */
    enum Issue {
        /** Wi-Fi coupé puis constaté rallumé. */
        FAITE,
        /** Wi-Fi pas constaté rallumé : la marque reste, le passage suivant retente (reprendre). */
        A_REPRENDRE,
        /** Wi-Fi resté allumé malgré la demande de coupure (refus, consentement demandé à l'écran). */
        SANS_EFFET
    }

    /** Ce que reprendre() a fait. */
    enum Reprise {
        /** Pas de marque : aucune remise en cours, cas normal. */
        RIEN,
        /** Marque trouvée, Wi-Fi déjà allumé : marque effacée sans rien demander. */
        ACHEVEE,
        /** Marque trouvée, Wi-Fi éteint : rallumé et constaté, marque effacée. */
        RALLUME,
        /** Marque trouvée, Wi-Fi éteint et toujours éteint après le rallumage : la marque reste. */
        TOUJOURS_ETEINT
    }

    private RemiseWifi() {
    }

    static Issue remettre(Radio radio, Marque marque) {
        marque.poser();
        boolean coupe = false;
        boolean allume;
        try {
            coupe = radio.couper();
        } finally {
            allume = rallumer(radio, marque);
        }
        if (!allume) {
            return Issue.A_REPRENDRE;
        }
        return coupe ? Issue.FAITE : Issue.SANS_EFFET;
    }

    static Reprise reprendre(Radio radio, Marque marque) {
        if (!marque.posee()) {
            return Reprise.RIEN;
        }
        if (radio.allume()) {
            marque.effacer();
            return Reprise.ACHEVEE;
        }
        return rallumer(radio, marque) ? Reprise.RALLUME : Reprise.TOUJOURS_ETEINT;
    }

    private static boolean rallumer(Radio radio, Marque marque) {
        boolean allume = radio.rallumer();
        if (allume) {
            marque.effacer();
        }
        return allume;
    }
}
