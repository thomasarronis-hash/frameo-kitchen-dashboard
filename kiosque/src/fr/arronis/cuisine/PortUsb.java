/*
 * PortUsb : garde le port USB-C du cadre en mode appareil, pour que l'ADB reste joignable par câble.
 *
 * Rôle    : reposer la propriété persist.sys.otgmod à 0 tant que le kiosque tourne.
 * Entrées : le Handler du thread UI de MainActivity (pour la planification ; son
 *           removeCallbacksAndMessages dans onDestroy arrête aussi les passages).
 * Sorties : propriété système persist.sys.otgmod = 0 ; une ligne dans logcat (TAG « Cuisine ») à
 *           chaque fois qu'elle est reposée.
 * Pièges  :
 *  - Constat du 13/10/2026 sur le cadre (docs/jour-j.md) : le script du fabricant
 *    /system/bin/hostotg.sh, lancé à sys.boot_completed, efface persist.sys.otgmod puis, toutes
 *    les 3 s, passe le port en mode hôte (clé USB) dès que sys.usb.config vaut « adb ». Avec
 *    persist.sys.otgmod à 0, il le laisse en mode appareil. Sans cela, l'ADB disparaît 12 s
 *    après chaque démarrage, et seul Frameo savait le rallumer.
 *  - setprop depuis une appli ordinaire ne passe QUE parce que SELinux est permissif sur ce
 *    cadre : si une mise à jour du système le rend strict, l'appel échoue (journalisé) et le
 *    kiosque continue normalement, sans ADB par câble après un redémarrage.
 *  - Premier passage 20 s après le lancement, pour passer après l'effacement du script, puis
 *    une vérification par minute (getprop) : rien n'est écrit si la valeur est déjà bonne.
 *  - Les commandes tournent sur un thread à part : jamais d'attente de processus sur le thread UI.
 */
package fr.arronis.cuisine;

import android.os.Handler;
import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;

final class PortUsb {

    private static final String TAG = "Cuisine";
    private static final String PROPRIETE = "persist.sys.otgmod";
    private static final String MODE_APPAREIL = "0";
    private static final long PREMIER_PASSAGE_MS = 20000;
    private static final long INTERVALLE_MS = 60000;

    private final Handler ui;
    private final Runnable passage = new Runnable() {
        @Override
        public void run() {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    verifier();
                }
            }, "port-usb").start();
            ui.postDelayed(this, INTERVALLE_MS);
        }
    };

    PortUsb(Handler ui) {
        this.ui = ui;
    }

    void demarrer() {
        ui.removeCallbacks(passage);
        ui.postDelayed(passage, PREMIER_PASSAGE_MS);
    }

    private static void verifier() {
        try {
            if (MODE_APPAREIL.equals(lire())) {
                return;
            }
            Process setprop = new ProcessBuilder("setprop", PROPRIETE, MODE_APPAREIL).redirectErrorStream(true).start();
            int code = setprop.waitFor();
            String apres = lire();
            Log.i(TAG, "port USB : " + PROPRIETE + " reposé à " + MODE_APPAREIL + " (code " + code + ", relu « " + apres + " »)");
        } catch (IOException e) {
            Log.w(TAG, "port USB : setprop impossible", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String lire() throws IOException, InterruptedException {
        Process getprop = new ProcessBuilder("getprop", PROPRIETE).redirectErrorStream(true).start();
        BufferedReader lecteur = new BufferedReader(new InputStreamReader(getprop.getInputStream(), "UTF-8"));
        try {
            String ligne = lecteur.readLine();
            getprop.waitFor();
            return ligne == null ? "" : ligne.trim();
        } finally {
            lecteur.close();
        }
    }
}
