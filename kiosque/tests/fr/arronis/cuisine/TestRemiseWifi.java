/*
 * TestRemiseWifi : vérification de RemiseWifi (remise à zéro du Wi-Fi et sa reprise) avec le JDK seul, sans Android.
 *
 * Rôle    : jouer une remise et ses reprises sur une fausse radio et une fausse marque, et vérifier : marque déjà sur
 *           disque au moment de la coupure, rallumage toujours tenté, marque effacée seulement sur un Wi-Fi constaté
 *           allumé, nouvel essai tant qu'il ne l'est pas, Wi-Fi coupé à la main jamais rallumé.
 * Entrées : aucune ; lancé par kiosque/build.sh (étape 1) avant toute construction de l'APK.
 * Sorties : une ligne par défaut trouvé, puis un bilan ; code de sortie 1 si un seul contrôle échoue (build.sh
 *           s'arrête alors).
 * Pièges  :
 *  - La mort du processus ne se simule pas en Java (un finally s'exécute toujours) : elle est couverte en deux temps,
 *    marque posée pendant la coupure (remiseNormale), puis kiosque relancé avec la marque et un Wi-Fi coupé
 *    (processusMortPendantLaRemise).
 *  - Compilé avec les classes pures seules (RegleWifi.java, RemiseWifi.java), sans android.jar ; hors de
 *    kiosque/src, il n'entre pas dans l'APK.
 */
package fr.arronis.cuisine;

public final class TestRemiseWifi {

    private static int controles;
    private static int defauts;

    private TestRemiseWifi() {
    }

    public static void main(String[] arguments) {
        remiseNormale();
        processusMortPendantLaRemise();
        puceQuiNeRemontePas();
        remiseAcheveeJusteAvantLaMort();
        wifiCoupeALaMain();
        coupureSansEffet();
        coupureEnErreur();
        System.out.println("TestRemiseWifi : " + (controles - defauts) + " contrôles sur " + controles + " réussis");
        if (defauts > 0) {
            System.exit(1);
        }
    }

    // ---- Scénarios ----

    private static void remiseNormale() {
        FausseMarque marque = new FausseMarque();
        FausseRadio radio = new FausseRadio(marque);
        RemiseWifi.Issue issue = RemiseWifi.remettre(radio, marque);
        verifier(issue == RemiseWifi.Issue.FAITE, "remise normale : faite");
        verifier(radio.marquePendantCoupure, "remise normale : marque déjà posée au moment de la coupure");
        verifier(radio.allume && !marque.posee, "remise normale : Wi-Fi rallumé, marque effacée");
    }

    /** Le processus meurt entre la coupure et le rallumage : au relancement, la marque et un Wi-Fi coupé. */
    private static void processusMortPendantLaRemise() {
        FausseMarque marque = new FausseMarque();
        marque.posee = true;
        FausseRadio radio = new FausseRadio(marque);
        radio.allume = false;
        RemiseWifi.Reprise reprise = RemiseWifi.reprendre(radio, marque);
        verifier(reprise == RemiseWifi.Reprise.RALLUME, "relancement après une remise interrompue : rallumage");
        verifier(radio.allume && !marque.posee, "relancement : Wi-Fi rallumé, marque effacée");
        reprise = RemiseWifi.reprendre(radio, marque);
        verifier(reprise == RemiseWifi.Reprise.RIEN && radio.rallumages == 1, "passage suivant : plus rien à faire");
    }

    /** La puce ne remonte pas aux deux premiers rallumages : la marque reste et chaque passage retente. */
    private static void puceQuiNeRemontePas() {
        FausseMarque marque = new FausseMarque();
        FausseRadio radio = new FausseRadio(marque);
        radio.rallumagesMuets = 2;
        RemiseWifi.Issue issue = RemiseWifi.remettre(radio, marque);
        verifier(issue == RemiseWifi.Issue.A_REPRENDRE, "puce muette : remise à reprendre");
        verifier(!radio.allume && marque.posee, "puce muette : Wi-Fi éteint, marque gardée");
        RemiseWifi.Reprise reprise = RemiseWifi.reprendre(radio, marque);
        verifier(reprise == RemiseWifi.Reprise.TOUJOURS_ETEINT && marque.posee, "passage suivant : toujours éteint, "
                + "marque gardée");
        reprise = RemiseWifi.reprendre(radio, marque);
        verifier(reprise == RemiseWifi.Reprise.RALLUME && radio.allume && !marque.posee, "passage d'après : rallumé, "
                + "marque effacée");
        verifier(radio.rallumages == 3, "puce muette : 3 rallumages en tout");
    }

    /** Rallumage fait, processus mort avant d'effacer la marque : on l'efface sans rien redemander. */
    private static void remiseAcheveeJusteAvantLaMort() {
        FausseMarque marque = new FausseMarque();
        marque.posee = true;
        FausseRadio radio = new FausseRadio(marque);
        RemiseWifi.Reprise reprise = RemiseWifi.reprendre(radio, marque);
        verifier(reprise == RemiseWifi.Reprise.ACHEVEE, "marque et Wi-Fi allumé : remise achevée");
        verifier(!marque.posee && radio.rallumages == 0, "remise achevée : marque effacée, aucun rallumage demandé");
    }

    /** Wi-Fi coupé dans les Réglages, sans remise du chien : il le reste. */
    private static void wifiCoupeALaMain() {
        FausseMarque marque = new FausseMarque();
        FausseRadio radio = new FausseRadio(marque);
        radio.allume = false;
        RemiseWifi.Reprise reprise = RemiseWifi.reprendre(radio, marque);
        verifier(reprise == RemiseWifi.Reprise.RIEN, "Wi-Fi coupé à la main : rien");
        verifier(!radio.allume && radio.rallumages == 0, "Wi-Fi coupé à la main : jamais rallumé");
    }

    /** Refus ou consentement demandé à l'écran : le Wi-Fi ne bouge pas, le rallumage part quand même. */
    private static void coupureSansEffet() {
        FausseMarque marque = new FausseMarque();
        FausseRadio radio = new FausseRadio(marque);
        radio.coupureSansEffet = true;
        RemiseWifi.Issue issue = RemiseWifi.remettre(radio, marque);
        verifier(issue == RemiseWifi.Issue.SANS_EFFET, "coupure sans effet : signalée");
        verifier(radio.rallumages == 1 && radio.allume && !marque.posee, "coupure sans effet : rallumage tenté, "
                + "marque effacée");
    }

    /** Une exception pendant la coupure n'empêche pas le rallumage (finally). */
    private static void coupureEnErreur() {
        FausseMarque marque = new FausseMarque();
        FausseRadio radio = new FausseRadio(marque);
        radio.coupureEnErreur = true;
        boolean propagee = false;
        try {
            RemiseWifi.remettre(radio, marque);
        } catch (IllegalStateException e) {
            propagee = true;
        }
        verifier(propagee, "coupure en erreur : exception transmise");
        verifier(radio.allume && !marque.posee, "coupure en erreur : Wi-Fi rallumé quand même, marque effacée");
    }

    // ---- Doublures et outils ----

    /** Marque en mémoire : « posee » tient lieu du fichier de préférences, qui survit au processus. */
    private static final class FausseMarque implements RemiseWifi.Marque {
        boolean posee;

        @Override
        public boolean posee() {
            return posee;
        }

        @Override
        public void poser() {
            posee = true;
        }

        @Override
        public void effacer() {
            posee = false;
        }
    }

    /** Wi-Fi simulé : allumé au départ ; options pour une coupure refusée ou en erreur, une puce muette. */
    private static final class FausseRadio implements RemiseWifi.Radio {
        private final FausseMarque marque;
        boolean allume = true;
        boolean coupureSansEffet;
        boolean coupureEnErreur;
        int rallumagesMuets;
        int rallumages;
        boolean marquePendantCoupure;

        FausseRadio(FausseMarque marque) {
            this.marque = marque;
        }

        @Override
        public boolean couper() {
            marquePendantCoupure = marque.posee;
            if (coupureSansEffet) {
                return false;
            }
            allume = false;
            if (coupureEnErreur) {
                throw new IllegalStateException("coupure en erreur (doublure)");
            }
            return true;
        }

        @Override
        public boolean rallumer() {
            rallumages++;
            if (rallumagesMuets > 0) {
                rallumagesMuets--;
            } else {
                allume = true;
            }
            return allume;
        }

        @Override
        public boolean allume() {
            return allume;
        }
    }

    private static void verifier(boolean condition, String quoi) {
        controles++;
        if (!condition) {
            defauts++;
            System.out.println("DÉFAUT : " + quoi);
        }
    }
}
