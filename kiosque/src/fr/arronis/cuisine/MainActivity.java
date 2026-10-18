/*
 * MainActivity : appli kiosque du cadre cuisine, une WebView plein écran.
 *
 * Rôle    : afficher la page servie par Config.ORIGINE en plein écran immersif, écran toujours
 *           allumé, scène fixe de 1920 px de large, et rester utile quand le serveur tombe.
 * Entrées : Config.ORIGINE (classe générée par build.sh) ; extras d'intent « cle » (clé
 *           d'appareil, rangée une fois dans les SharedPreferences) et « debug » (booléen,
 *           débogage distant de la WebView), lus seulement s'ils arrivent par l'alias ReglageAdb.
 * Sorties : cookie cadre_cle posé sur l'origine avant chaque chargement de la page principale ;
 *           page de secours locale (assets/secours.html) quand la page principale est injoignable.
 * Pièges  :
 *  - Compatible API 21 : aucun appel plus récent. onRenderProcessGone (API 26) est un rappel,
 *    il n'est simplement jamais appelé avant Android 8.
 *  - Surcharges dépréciées mais voulues, une seule couvre toutes les versions :
 *    onReceivedError(WebView, int, String, String) est rappelée par la nouvelle surcharge à
 *    partir de l'API 23 (page principale seulement) ; shouldOverrideUrlLoading(WebView, String)
 *    est rappelée par la nouvelle surcharge à partir de l'API 24. Avant, elles sont appelées
 *    directement.
 *  - MainActivity est exportée (filtre HOME) : n'importe quelle appli du cadre peut la lancer.
 *    La clé et le débogage ne passent donc que par l'alias ReglageAdb du manifeste, protégé par
 *    la permission DUMP que seul le shell ADB détient [à vérifier sur le cadre].
 *  - Le débogage distant suit chaque intent : un lancement normal (accueil) le coupe.
 *  - Chromium 104 et plus plafonne la durée d'un cookie à 400 jours : le cookie est donc reposé
 *    avant chaque chargement de la page principale (démarrage, nouvel essai, perte du rendu).
 *    Un rechargement fait par la page elle-même (location.reload) ne le repose pas.
 *  - Le kiosque est aussi l'appli d'accueil (HOME) : la sortie à deux doigts ouvre les Réglages,
 *    jamais l'accueil (qui relancerait le kiosque). Le bouton retour ne fait rien.
 *  - Nouvel essai toutes les 15 s par une sonde HTTP en arrière-plan : la vraie page n'est
 *    rechargée que si le serveur répond, pour ne pas faire clignoter la page de secours. Ce
 *    rechargement remplace la secours sans la consulter : quand elle aura des minuteurs (M2),
 *    il faudra d'abord lui demander (evaluateJavascript) si un minuteur tourne ou sonne.
 *  - PortUsb garde le port USB-C en mode appareil (ADB par câble) : voir son en-tête.
 *  - ChienWifi (un seul par processus, thread à lui, démarré ici et jamais arrêté par l'activité : il survit à sa
 *    recréation) coupe et rallume le Wi-Fi quand la sonde de 4 Kio du serveur ne passe plus : voir son en-tête.
 */
package fr.arronis.cuisine;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final String TAG = "Cuisine";
    private static final String URL_PRINCIPALE = Config.ORIGINE + "/";
    private static final String URL_SECOURS = "file:///android_asset/secours.html";
    private static final long DELAI_ESSAI_MS = 15000;
    private static final int DELAI_SONDE_MS = 5000;
    private static final long DUREE_SORTIE_MS = 1500;
    private static final float TOLERANCE_SORTIE_DP = 24f;
    private static final String PREFERENCES = "kiosque";
    private static final String PREF_CLE = "cle";
    /** Alias déclaré dans le manifeste, seul chemin d'entrée des extras « cle » et « debug ». */
    private static final String ALIAS_ADB = "fr.arronis.cuisine.ReglageAdb";
    /** Clé d'appareil en hexadécimal ou base64url : rien qui puisse casser le cookie. */
    private static final Pattern FORMAT_CLE = Pattern.compile("[A-Za-z0-9_-]{16,256}");
    /** 400 jours (34 560 000 s), le plafond de Chromium 104 et plus. */
    private static final String ATTRIBUTS_COOKIE = "; Max-Age=34560000; Path=/; HttpOnly; SameSite=Strict";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final PortUsb portUsb = new PortUsb(ui);
    private FrameLayout conteneur;
    private WebView web;
    private boolean enSecours;

    /** Geste de sortie : identifiants des deux doigts et positions de départ (x0, y0, x1, y1). */
    private final int[] doigts = new int[2];
    private final float[] departs = new float[4];
    private boolean sortieArmee;

    private final Runnable essai = new Runnable() {
        @Override
        public void run() {
            sonderServeur();
        }
    };

    private final Runnable sortie = new Runnable() {
        @Override
        public void run() {
            sortieArmee = false;
            ouvrirReglages();
        }
    };

    @Override
    protected void onCreate(Bundle etatSauve) {
        super.onCreate(etatSauve);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        conteneur = new FrameLayout(this);
        setContentView(conteneur);
        lireIntent(getIntent());
        creerWebView();
        chargerPagePrincipale();
        portUsb.demarrer();
        ChienWifi.demarrer(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (lireIntent(intent)) {
            chargerPagePrincipale();
        }
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (web != null) {
            conteneur.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean aLeFocus) {
        super.onWindowFocusChanged(aLeFocus);
        if (aLeFocus) {
            masquerBarres();
        }
    }

    /** Bouton retour neutralisé : la sortie passe par le geste à deux doigts. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        Log.d(TAG, "Bouton retour ignoré");
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent evenement) {
        surveillerSortie(evenement);
        return super.dispatchTouchEvent(evenement);
    }

    // ---- Intent : débogage et clé d'appareil ----

    /**
     * Applique l'extra « debug » (absent : débogage coupé) et range l'extra « cle », seulement
     * si l'intent arrive par l'alias ReglageAdb. Tout autre intent coupe le débogage et laisse
     * la clé en place. Renvoie vrai si une nouvelle clé valide vient d'être rangée.
     */
    private boolean lireIntent(Intent intent) {
        if (intent == null) {
            WebView.setWebContentsDebuggingEnabled(false);
            return false;
        }
        ComponentName composant = intent.getComponent();
        boolean parAdb = composant != null && ALIAS_ADB.equals(composant.getClassName());
        if (!parAdb && (intent.hasExtra("cle") || intent.hasExtra("debug"))) {
            Log.w(TAG, "Extras cle et debug ignorés : passer par " + ALIAS_ADB);
        }
        WebView.setWebContentsDebuggingEnabled(parAdb && intent.getBooleanExtra("debug", false));
        String cle = parAdb ? intent.getStringExtra("cle") : null;
        if (cle == null) {
            return false;
        }
        if (!FORMAT_CLE.matcher(cle).matches()) {
            Log.w(TAG, "Clé d'appareil ignorée : format inattendu");
            return false;
        }
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(PREF_CLE, cle).apply();
        Log.i(TAG, "Clé d'appareil rangée");
        return true;
    }

    /** Pose le cookie cadre_cle sur l'origine : on ne dépend ni de sa survie ni de sa durée. */
    private void injecterCle() {
        String cle = getSharedPreferences(PREFERENCES, MODE_PRIVATE).getString(PREF_CLE, null);
        if (cle == null) {
            return;
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setCookie(Config.ORIGINE, "cadre_cle=" + cle + ATTRIBUTS_COOKIE);
        cookies.flush();
    }

    // ---- WebView, page principale et page de secours ----

    private void creerWebView() {
        web = new WebView(this);
        WebSettings reglages = web.getSettings();
        reglages.setJavaScriptEnabled(true);
        reglages.setDomStorageEnabled(true);
        reglages.setUseWideViewPort(true);
        reglages.setLoadWithOverviewMode(true);
        reglages.setSupportZoom(false);
        reglages.setBuiltInZoomControls(false);
        reglages.setDisplayZoomControls(false);
        reglages.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new PontKiosque(this), "Kiosk");
        web.setWebViewClient(new ClientKiosque());
        conteneur.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void chargerPagePrincipale() {
        enSecours = false;
        ui.removeCallbacks(essai);
        injecterCle();
        web.loadUrl(URL_PRINCIPALE);
    }

    private void afficherSecours() {
        enSecours = true;
        web.loadUrl(URL_SECOURS);
        ui.removeCallbacks(essai);
        ui.postDelayed(essai, DELAI_ESSAI_MS);
    }

    /** Sonde le serveur hors du thread UI ; recharge la page principale seulement s'il répond. */
    private void sonderServeur() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean joignable = serveurRepond();
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (web == null || !enSecours) {
                            return;
                        }
                        if (joignable) {
                            chargerPagePrincipale();
                        } else {
                            ui.postDelayed(essai, DELAI_ESSAI_MS);
                        }
                    }
                });
            }
        }, "sonde-serveur").start();
    }

    /** Vrai si l'origine répond en HTTP (code inférieur à 500) dans le délai de la sonde. */
    private static boolean serveurRepond() {
        HttpURLConnection connexion = null;
        try {
            connexion = (HttpURLConnection) new URL(URL_PRINCIPALE).openConnection();
            connexion.setRequestMethod("HEAD");
            connexion.setConnectTimeout(DELAI_SONDE_MS);
            connexion.setReadTimeout(DELAI_SONDE_MS);
            connexion.setUseCaches(false);
            int code = connexion.getResponseCode();
            return code > 0 && code < 500;
        } catch (IOException e) {
            return false;
        } finally {
            if (connexion != null) {
                connexion.disconnect();
            }
        }
    }

    /** Vrai si l'URL a le même schéma, le même hôte et le même port que Config.ORIGINE. */
    private static boolean estDeLOrigine(String url) {
        Uri cible = Uri.parse(url);
        Uri origine = Uri.parse(Config.ORIGINE);
        return origine.getScheme().equalsIgnoreCase(cible.getScheme())
                && origine.getHost().equalsIgnoreCase(cible.getHost())
                && port(origine) == port(cible);
    }

    private static int port(Uri uri) {
        if (uri.getPort() != -1) {
            return uri.getPort();
        }
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    /** Navigation limitée à l'origine, bascule sur la page de secours, survie à la perte du rendu. */
    private final class ClientKiosque extends WebViewClient {

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView vue, String url) {
            if (estDeLOrigine(url)) {
                return false;
            }
            Log.w(TAG, "Navigation bloquée hors de l'origine : " + url);
            return true;
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView vue, int code, String description, String urlEnEchec) {
            Log.w(TAG, "Page principale injoignable (" + code + ", " + description + ")");
            afficherSecours();
        }

        @Override
        public boolean onRenderProcessGone(WebView vue, RenderProcessGoneDetail detail) {
            Log.e(TAG, "Processus de rendu perdu : WebView recréée");
            conteneur.removeView(vue);
            vue.destroy();
            creerWebView();
            if (enSecours) {
                afficherSecours();
            } else {
                chargerPagePrincipale();
            }
            return true;
        }
    }

    // ---- Sortie à deux doigts immobiles pendant 1,5 s ----

    /** Arme la sortie quand exactement deux doigts se posent ; tout autre événement que MOVE l'annule. */
    private void surveillerSortie(MotionEvent evenement) {
        int action = evenement.getActionMasked();
        if (action == MotionEvent.ACTION_POINTER_DOWN && evenement.getPointerCount() == 2) {
            for (int i = 0; i < 2; i++) {
                doigts[i] = evenement.getPointerId(i);
                departs[2 * i] = evenement.getX(i);
                departs[2 * i + 1] = evenement.getY(i);
            }
            sortieArmee = true;
            ui.removeCallbacks(sortie);
            ui.postDelayed(sortie, DUREE_SORTIE_MS);
        } else if (action == MotionEvent.ACTION_MOVE) {
            if (sortieArmee && doigtsOntBouge(evenement)) {
                annulerSortie();
            }
        } else {
            annulerSortie();
        }
    }

    private boolean doigtsOntBouge(MotionEvent evenement) {
        float tolerance = TOLERANCE_SORTIE_DP * getResources().getDisplayMetrics().density;
        for (int i = 0; i < 2; i++) {
            int index = evenement.findPointerIndex(doigts[i]);
            if (index < 0
                    || Math.abs(evenement.getX(index) - departs[2 * i]) > tolerance
                    || Math.abs(evenement.getY(index) - departs[2 * i + 1]) > tolerance) {
                return true;
            }
        }
        return false;
    }

    private void annulerSortie() {
        if (sortieArmee) {
            sortieArmee = false;
            ui.removeCallbacks(sortie);
        }
    }

    private void ouvrirReglages() {
        Intent reglages = new Intent(Settings.ACTION_SETTINGS);
        reglages.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(reglages);
        } catch (ActivityNotFoundException e) {
            Log.e(TAG, "Réglages Android introuvables", e);
        }
    }

    // ---- Plein écran immersif ----

    @SuppressWarnings("deprecation")
    private void masquerBarres() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
}
