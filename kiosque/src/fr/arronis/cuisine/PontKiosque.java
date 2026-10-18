/*
 * PontKiosque : pont JavaScript exposé à la page sous le nom window.Kiosk.
 *
 * Rôle    : luminosité de la fenêtre du kiosque et volume média, rien d'autre (pont minimal,
 *           conception §2.5).
 * Entrées : appels JS Kiosk.setBrightness(0..1), Kiosk.setVolume(0..100), Kiosk.getVolume().
 * Sorties : attribut screenBrightness de la fenêtre ; volume du flux STREAM_MUSIC ;
 *           getVolume renvoie un pourcentage entier.
 * Pièges  :
 *  - Les méthodes @JavascriptInterface tournent sur un thread du pont, pas sur le thread UI :
 *    la fenêtre ne se modifie que depuis le thread UI, d'où runOnUiThread.
 *  - screenBrightness à 0 met le rétroéclairage au minimum sans l'éteindre. Le réglage ne vaut
 *    que pour la fenêtre du kiosque et disparaît quand on en sort.
 *  - Le pont est visible de toute page chargée dans la WebView (la navigation est limitée à
 *    l'origine par MainActivity) : n'ajouter ici aucune méthode sensible.
 *  - setStreamVolume sur STREAM_MUSIC ne demande pas de permission [à confirmer sur le cadre] ;
 *    un refus du système est journalisé, jamais remonté en exception à la page.
 */
package fr.arronis.cuisine;

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

public final class PontKiosque {

    private static final String TAG = "Cuisine";

    private final Activity activite;
    private final AudioManager audio;

    PontKiosque(Activity activite) {
        this.activite = activite;
        this.audio = (AudioManager) activite.getSystemService(Context.AUDIO_SERVICE);
    }

    /** Luminosité de la fenêtre de 0 (minimum) à 1 (maximum) ; hors bornes ramené, NaN ignoré. */
    @JavascriptInterface
    public void setBrightness(float niveau) {
        if (Float.isNaN(niveau)) {
            return;
        }
        final float borne = Math.max(0f, Math.min(1f, niveau));
        activite.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                WindowManager.LayoutParams attributs = activite.getWindow().getAttributes();
                attributs.screenBrightness = borne;
                activite.getWindow().setAttributes(attributs);
            }
        });
    }

    /** Volume média en pourcentage (0 à 100), sans afficher le curseur système. */
    @JavascriptInterface
    public void setVolume(int pourcentage) {
        int borne = Math.max(0, Math.min(100, pourcentage));
        int maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        try {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(borne * maximum / 100f), 0);
        } catch (SecurityException e) {
            Log.w(TAG, "Réglage du volume refusé par le système", e);
        }
    }

    /** Volume média actuel en pourcentage (0 à 100). */
    @JavascriptInterface
    public int getVolume() {
        int maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        if (maximum <= 0) {
            return 0;
        }
        return Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / maximum);
    }
}
