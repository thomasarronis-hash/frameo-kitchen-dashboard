/*
 * TestRegleWifi : vérification de RegleWifi (chien de garde Wi-Fi) avec le JDK seul, sans Android.
 *
 * Rôle    : rejouer des suites de passages (succès, échecs, neutres, hors ligne) sur une horloge simulée et vérifier
 *           les remises à zéro décidées : 2 échecs de suite, au plus une toutes les 5 min, 30 min après 3 remises
 *           sans succès, retour à 5 min au premier succès. Vérifier aussi qu'une origine en boucle locale (jour J)
 *           est reconnue : le chien ne doit pas démarrer.
 * Entrées : aucune ; lancé par kiosque/build.sh (étape 1) avant toute construction de l'APK.
 * Sorties : une ligne par défaut trouvé, puis un bilan ; code de sortie 1 si un seul contrôle échoue (build.sh
 *           s'arrête alors).
 * Pièges  :
 *  - Compilé avec les classes pures seules (RegleWifi.java, RemiseWifi.java), sans android.jar : si RegleWifi
 *    importe un jour une classe Android, la compilation de ce test échoue, ce qui est voulu.
 *  - Hors de kiosque/src : il n'entre pas dans l'APK.
 */
package fr.arronis.cuisine;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class TestRegleWifi {

    private static final long S = 1000L;
    private static final long MIN = 60 * S;

    private static int controles;
    private static int defauts;

    private TestRegleWifi() {
    }

    public static void main(String[] arguments) {
        premierPassage();
        deuxEchecsDeSuite();
        espacementDeCinqMinutes();
        ralentiApresTroisRemises();
        succesRetablitCinqMinutes();
        neutreNeCoupePasLaSerie();
        horsLigneOublieLesEchecs();
        serveurArreteDeuxHeures();
        episodeReelPuisRechute();
        dureesLisibles();
        origineEnBoucleLocale();
        System.out.println("TestRegleWifi : " + (controles - defauts) + " contrôles sur " + controles + " réussis");
        if (defauts > 0) {
            System.exit(1);
        }
    }

    // ---- Scénarios ----

    private static void premierPassage() {
        RegleWifi.Decision d = RegleWifi.decider(RegleWifi.Etat.INITIAL, RegleWifi.Resultat.SUCCES, 0);
        verifier(!d.remettre, "succès initial : pas de remise");
        verifier(d.motif == null, "succès initial : rien à journaliser");
        verifier(d.etat.echecsDeSuite == 0 && d.etat.derniereRemiseMs == RegleWifi.JAMAIS,
                "succès initial : état vierge");
    }

    private static void deuxEchecsDeSuite() {
        RegleWifi.Decision d1 = RegleWifi.decider(RegleWifi.Etat.INITIAL, RegleWifi.Resultat.ECHEC, 40 * S);
        verifier(!d1.remettre && d1.etat.echecsDeSuite == 1, "1 échec : compté, pas de remise");
        verifier(d1.motif != null, "1 échec : journalisé");
        RegleWifi.Decision d2 = RegleWifi.decider(d1.etat, RegleWifi.Resultat.ECHEC, 70 * S);
        verifier(d2.remettre, "2 échecs de suite, aucune remise avant (horloge proche du démarrage) : remise");
        verifier(d2.etat.echecsDeSuite == 0, "remise faite : échecs remis à 0");
        verifier(d2.etat.derniereRemiseMs == 70 * S, "remise faite : instant noté");
        verifier(d2.etat.remisesSansSucces == 1, "remise faite : 1 remise sans succès");
    }

    private static void espacementDeCinqMinutes() {
        RegleWifi.Etat apresRemise = new RegleWifi.Etat(0, 0, 1);
        RegleWifi.Decision d = RegleWifi.decider(apresRemise, RegleWifi.Resultat.ECHEC, 30 * S);
        d = RegleWifi.decider(d.etat, RegleWifi.Resultat.ECHEC, 60 * S);
        verifier(!d.remettre && d.etat.echecsDeSuite == 2, "2 échecs 1 min après une remise : différée");
        verifier(d.motif != null && d.motif.contains("4 min"), "remise différée : délai restant dans le motif");
        d = RegleWifi.decider(d.etat, RegleWifi.Resultat.ECHEC, 5 * MIN - 1);
        verifier(!d.remettre, "4 min 59,999 s après la remise : toujours différée");
        d = RegleWifi.decider(d.etat, RegleWifi.Resultat.ECHEC, 5 * MIN);
        verifier(d.remettre && d.etat.remisesSansSucces == 2, "5 min pile après la remise : remise n° 2");
    }

    private static void ralentiApresTroisRemises() {
        RegleWifi.Etat troisRemises = new RegleWifi.Etat(1, 0, RegleWifi.REMISES_AVANT_RALENTI);
        RegleWifi.Decision d = RegleWifi.decider(troisRemises, RegleWifi.Resultat.ECHEC, 5 * MIN);
        verifier(!d.remettre, "3 remises sans succès : plus de remise à 5 min");
        d = RegleWifi.decider(d.etat, RegleWifi.Resultat.ECHEC, 30 * MIN - 1);
        verifier(!d.remettre, "3 remises sans succès : toujours rien juste avant 30 min");
        d = RegleWifi.decider(d.etat, RegleWifi.Resultat.ECHEC, 30 * MIN);
        verifier(d.remettre && d.etat.remisesSansSucces == 4, "3 remises sans succès : remise à 30 min");
    }

    private static void succesRetablitCinqMinutes() {
        RegleWifi.Etat ralenti = new RegleWifi.Etat(0, 0, 5);
        RegleWifi.Decision d = RegleWifi.decider(ralenti, RegleWifi.Resultat.SUCCES, 1 * MIN);
        verifier(d.etat.remisesSansSucces == 0 && d.etat.echecsDeSuite == 0, "succès : compteurs remis à 0");
        verifier(d.etat.derniereRemiseMs == 0, "succès : l'instant de la dernière remise est gardé");
        verifier(d.motif != null, "succès après des remises : journalisé");
        d = RegleWifi.decider(d.etat, RegleWifi.Resultat.ECHEC, 5 * MIN - 30 * S);
        d = RegleWifi.decider(d.etat, RegleWifi.Resultat.ECHEC, 5 * MIN);
        verifier(d.remettre, "après un succès, l'espacement revient à 5 min");
    }

    private static void neutreNeCoupePasLaSerie() {
        RegleWifi.Decision d = RegleWifi.decider(RegleWifi.Etat.INITIAL, RegleWifi.Resultat.ECHEC, 0);
        RegleWifi.Decision n = RegleWifi.decider(d.etat, RegleWifi.Resultat.NEUTRE, 30 * S);
        verifier(!n.remettre && n.etat == d.etat, "neutre : état inchangé, pas de remise");
        verifier(n.motif != null, "neutre : journalisé (sonde absente ou d'une autre taille)");
        d = RegleWifi.decider(n.etat, RegleWifi.Resultat.ECHEC, 60 * S);
        verifier(d.remettre, "échec, neutre, échec : la série d'échecs continue, remise");
        RegleWifi.Etat e = RegleWifi.Etat.INITIAL;
        boolean remise = false;
        for (long t = 0; t < 24 * 60 * MIN; t += 30 * S) {
            RegleWifi.Decision dn = RegleWifi.decider(e, RegleWifi.Resultat.NEUTRE, t);
            remise |= dn.remettre;
            e = dn.etat;
        }
        verifier(!remise, "24 h de 404 (serveur pas encore redéployé) : aucune remise");
    }

    private static void horsLigneOublieLesEchecs() {
        RegleWifi.Decision d = RegleWifi.decider(RegleWifi.Etat.INITIAL, RegleWifi.Resultat.ECHEC, 0);
        RegleWifi.Decision h = RegleWifi.decider(d.etat, RegleWifi.Resultat.HORS_LIGNE, 30 * S);
        verifier(!h.remettre && h.etat.echecsDeSuite == 0, "hors ligne : échecs oubliés, pas de remise");
        verifier(h.motif != null, "hors ligne après un échec : journalisé");
        d = RegleWifi.decider(h.etat, RegleWifi.Resultat.ECHEC, 60 * S);
        verifier(!d.remettre, "échec, hors ligne, échec : pas de remise");
        h = RegleWifi.decider(RegleWifi.Etat.INITIAL, RegleWifi.Resultat.HORS_LIGNE, 0);
        verifier(h.motif == null, "hors ligne sans échec : rien à journaliser");
    }

    /** Serveur arrêté : remises à 30 s, 5 min 30 s, 10 min 30 s, puis toutes les 30 min. */
    private static void serveurArreteDeuxHeures() {
        List<Long> remises = rejouer(new Rejeu() {
            @Override
            public RegleWifi.Resultat a(long t) {
                return RegleWifi.Resultat.ECHEC;
            }
        }, 2 * 60 * MIN);
        List<Long> attendues = Arrays.asList(30 * S, 330 * S, 630 * S, 2430 * S, 4230 * S, 6030 * S);
        verifier(remises.equals(attendues), "serveur arrêté 2 h : remises " + secondes(remises) + ", attendues "
                + secondes(attendues));
    }

    /** Décrochage réparé par la remise, puis rechute 2 min plus tard : la 2e remise attend les 5 min. */
    private static void episodeReelPuisRechute() {
        List<Long> remises = rejouer(new Rejeu() {
            @Override
            public RegleWifi.Resultat a(long t) {
                boolean enPanne = t < 60 * S || (t >= 180 * S && t < 600 * S);
                return enPanne ? RegleWifi.Resultat.ECHEC : RegleWifi.Resultat.SUCCES;
            }
        }, 20 * MIN);
        List<Long> attendues = Arrays.asList(30 * S, 330 * S);
        verifier(remises.equals(attendues), "décrochage puis rechute : remises " + secondes(remises) + ", attendues "
                + secondes(attendues));
    }

    private static void dureesLisibles() {
        verifier("0 s".equals(RegleWifi.duree(0)), "durée 0");
        verifier("1 s".equals(RegleWifi.duree(1)), "durée arrondie à la seconde supérieure");
        verifier("45 s".equals(RegleWifi.duree(45 * S)), "durée 45 s");
        verifier("4 min 30 s".equals(RegleWifi.duree(270 * S)), "durée 4 min 30 s");
        verifier("30 min".equals(RegleWifi.duree(30 * MIN)), "durée 30 min");
    }

    /** Jour J (adb reverse) : la sonde passerait par le câble ; M2 : par le Wi-Fi. */
    private static void origineEnBoucleLocale() {
        verifier(RegleWifi.origineEnBoucleLocale("http://127.0.0.1:8020"), "127.0.0.1 : boucle locale");
        verifier(RegleWifi.origineEnBoucleLocale("http://127.1.2.3:8020"), "127.1.2.3 : boucle locale (127/8)");
        verifier(RegleWifi.origineEnBoucleLocale("http://localhost:8020"), "localhost : boucle locale");
        verifier(RegleWifi.origineEnBoucleLocale("http://LocalHost"), "LocalHost sans port : boucle locale");
        verifier(!RegleWifi.origineEnBoucleLocale("http://192.168.1.187:8020"), "M900 : pas en boucle locale");
        verifier(!RegleWifi.origineEnBoucleLocale("http://127.example.lan:8020"), "nom commençant par 127. : pas en "
                + "boucle locale");
        verifier(!RegleWifi.origineEnBoucleLocale("https://cadre.lan"), "nom de la maison : pas en boucle locale");
    }

    // ---- Outils ----

    /** Résultat d'un passage à l'instant t (ms). */
    private interface Rejeu {
        RegleWifi.Resultat a(long t);
    }

    /** Passages toutes les 30 s de 0 à duree (exclue) ; renvoie les instants des remises. */
    private static List<Long> rejouer(Rejeu rejeu, long duree) {
        List<Long> remises = new ArrayList<Long>();
        RegleWifi.Etat etat = RegleWifi.Etat.INITIAL;
        for (long t = 0; t < duree; t += 30 * S) {
            RegleWifi.Decision d = RegleWifi.decider(etat, rejeu.a(t), t);
            if (d.remettre) {
                remises.add(t);
            }
            etat = d.etat;
        }
        return remises;
    }

    private static String secondes(List<Long> instants) {
        List<Long> enSecondes = new ArrayList<Long>();
        for (long t : instants) {
            enSecondes.add(t / S);
        }
        return enSecondes + " s";
    }

    private static void verifier(boolean condition, String quoi) {
        controles++;
        if (!condition) {
            defauts++;
            System.out.println("DÉFAUT : " + quoi);
        }
    }
}
