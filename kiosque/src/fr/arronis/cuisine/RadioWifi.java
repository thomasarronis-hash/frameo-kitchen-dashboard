/*
 * RadioWifi : le Wi-Fi du cadre vu par RemiseWifi, avec le WifiManager d'Android (coupure, rallumage, constats).
 *
 * Rôle    : couper puis rallumer le Wi-Fi comme « adb shell svc wifi disable / enable » le 14/10, en constatant chaque
 *           changement d'état au lieu de se fier à la réponse de setWifiEnabled.
 * Entrées : le WifiManager de l'application.
 * Sorties : WifiManager.setWifiEnabled(false puis true) ; lignes logcat (TAG « Cuisine », préfixe « chien Wi-Fi : »)
 *           à chaque appel et à chaque état constaté.
 * Pièges  :
 *  - Appels bloquants (coupure 5 s au plus puis 1 s de pause, allumage 10 s au plus) : seulement depuis le thread du
 *    chien (ChienWifi), jamais depuis le thread UI.
 *  - Allumé = WIFI_STATE_ENABLED (isWifiEnabled). ENABLING ne suffit pas : une puce qui ne remonte pas retombe en
 *    DISABLED ou UNKNOWN, la marque de RemiseWifi reste alors et le passage suivant retente.
 *  - setWifiEnabled : déprécié en API 29 et refusé à partir de targetSdk 29, permis sur Android 9 avec
 *    CHANGE_WIFI_STATE et targetSdk 23. Si le système est en « permission review » (ro.permission_review_required),
 *    Android affiche une demande de consentement au lieu de couper [à vérifier sur le cadre] : le Wi-Fi reste allumé,
 *    couper() rend faux et le chien s'arrête (RemiseWifi.Issue.SANS_EFFET).
 *  - Horloge : SystemClock.elapsedRealtime (monotone), l'heure murale du cadre est fausse après un redémarrage
 *    sans réseau.
 */
package fr.arronis.cuisine;

import android.net.wifi.WifiManager;
import android.os.SystemClock;
import android.util.Log;

final class RadioWifi implements RemiseWifi.Radio {

    private static final long COUPURE_MAX_MS = 5000;
    private static final long ALLUMAGE_MAX_MS = 10000;
    private static final long POINTAGE_MS = 250;
    private static final long PAUSE_AVANT_RALLUMAGE_MS = 1000;

    private final WifiManager wifi;

    RadioWifi(WifiManager wifi) {
        this.wifi = wifi;
    }

    /** setWifiEnabled(false), attente de la coupure (5 s au plus), pause de 1 s. Vrai si le Wi-Fi a bougé. */
    @Override
    @SuppressWarnings("deprecation")
    public boolean couper() {
        try {
            if (!wifi.setWifiEnabled(false)) {
                Log.w(ChienWifi.TAG, ChienWifi.PREFIXE + "coupure refusée par setWifiEnabled(false)");
                return false;
            }
        } catch (SecurityException e) {
            Log.e(ChienWifi.TAG, ChienWifi.PREFIXE + "coupure interdite", e);
            return false;
        }
        int apres = attendre(WifiManager.WIFI_STATE_DISABLED, COUPURE_MAX_MS);
        Log.i(ChienWifi.TAG, ChienWifi.PREFIXE + "après coupure : " + nomEtat(apres));
        if (apres == WifiManager.WIFI_STATE_ENABLED) {
            return false;
        }
        SystemClock.sleep(PAUSE_AVANT_RALLUMAGE_MS);
        return true;
    }

    /** setWifiEnabled(true), puis attente de l'état allumé (10 s au plus). Vrai si le Wi-Fi est constaté allumé. */
    @Override
    @SuppressWarnings("deprecation")
    public boolean rallumer() {
        try {
            boolean accepte = wifi.setWifiEnabled(true);
            Log.i(ChienWifi.TAG, ChienWifi.PREFIXE + "rallumage "
                    + (accepte ? "demandé" : "refusé par setWifiEnabled(true)"));
        } catch (SecurityException e) {
            Log.e(ChienWifi.TAG, ChienWifi.PREFIXE + "rallumage interdit", e);
        }
        int apres = attendre(WifiManager.WIFI_STATE_ENABLED, ALLUMAGE_MAX_MS);
        boolean allume = apres == WifiManager.WIFI_STATE_ENABLED;
        Log.println(allume ? Log.INFO : Log.WARN, ChienWifi.TAG, ChienWifi.PREFIXE + "après rallumage : "
                + nomEtat(apres));
        return allume;
    }

    @Override
    public boolean allume() {
        return wifi.isWifiEnabled();
    }

    /** Attend que le Wi-Fi atteigne l'état voulu, au plus dureeMaxMs ; rend l'état constaté à la fin. */
    private int attendre(int etatVoulu, long dureeMaxMs) {
        long limite = SystemClock.elapsedRealtime() + dureeMaxMs;
        while (wifi.getWifiState() != etatVoulu && SystemClock.elapsedRealtime() < limite) {
            SystemClock.sleep(POINTAGE_MS);
        }
        return wifi.getWifiState();
    }

    private static String nomEtat(int etatWifi) {
        switch (etatWifi) {
            case WifiManager.WIFI_STATE_DISABLED:
                return "coupé";
            case WifiManager.WIFI_STATE_DISABLING:
                return "coupure en cours";
            case WifiManager.WIFI_STATE_ENABLING:
                return "allumage en cours";
            case WifiManager.WIFI_STATE_ENABLED:
                return "allumé";
            default:
                return "état inconnu (" + etatWifi + ")";
        }
    }
}
