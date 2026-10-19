# Cadre cuisine : document de conception

> **À lire d'abord.** Ce document est le journal de conception d'origine, écrit au fil du projet entre Thomas et Claude
> (d'où le tutoiement, les questions numérotées et les décisions datées). Il est gardé presque tel quel parce que les
> commentaires du code y renvoient (« conception §6.0 »...). Les prénoms de la famille y sont remplacés par des prénoms
> d'exemple. Pour installer le projet chez soi, suivre le README (« Installer chez soi »).
>
> **Geste parent, 14/10 au soir (décision de Thomas, essai sur le vrai cadre)** : appui long de 3 s sur le visage d'un enfant (en haut du mode enfant, ou sur sa carte d'entrée), mode parent de cet enfant ; remplace les trois doigts, impossibles sur ce cadre (contrôleur tactile à deux doigts au plus, relevé du 14/10 ; README, « Le mode parent »).
>
> **Tableau des enfants, décisions du 14/10 en fin d'après-midi** (détail dans les choix et dans le README, « Tableau des enfants ») : tout le matin de Timo **en confiance** (« Levé » et « N'excite pas Pablo » comptés dès qu'il coche, « Levé » toujours refusé avant 6 h 30 ; la validation par un parent reste permise au barème, plus utilisée) ; **« +1 » libre** dans l'en-tête de Timo (Quête et Points), sans mode parent, retour de 5 s, **10 par journée** (`points.plafond_libre`), annulation bornée côté serveur (dernier point libre, 10 s, une fois) ; **« −1 »** en mode parent (solde jamais sous 0) : Timo ne perd jamais de points par punition, un parent corrige ; ~~geste parent à trois doigts~~ (**remplacé le 14/10 au soir** par l'appui long de 3 s sur un visage, voir ci-dessus ; la navigation de l'écran Enfants est revenue au poser du doigt, sauf les visages). Écran : 10 emplacements annoncés par le gsl3673, **deux doigts au plus en pratique** (relevé du 14/10) ; la réserve « multi-touch pas vérifié » tient toujours au-delà de deux doigts.
>
> **Commandes de la Mégane (14/10)** (décision de Thomas, détail dans le README, « Voitures ») : toutes les commandes de l'intégration Renault sur l'écran Voitures (commencer la charge, démarrer la clim, appel de phares, klaxon : `button.press` ; niveaux de charge mini et cible : `number.set_value`, valeur contrôlée contre les bornes et le pas actuels), d'un simple appui, **sans protection contre les enfants** (ni geste parent ni confirmation : son choix). Nouveaux rôles facultatifs de `VOITURES`, domaine imposé par rôle ; entité figée au démarrage, jamais lue dans le corps (`serveur/ha/actions-voiture.js`, actions `voiture_commande` et `voiture_niveau`). **Troisième garde-fou séparé `ACTIONS_VOITURE`** (simulé par défaut, revérifié par la connexion HA, aucun croisement avec `ACTIONS_REELLES` ni `ACTIONS_MAISON`) : exception durable à accorder par Thomas comme les deux autres (§6.0). Limites côté serveur pour le quota de l'API Renault (60 requêtes par heure et par compte, déjà presque toutes prises par les relevés de HA) : même commande toutes les 30 s, même réglage toutes les 10 s, et surtout 10 commandes au plus par heure glissante, toutes voitures confondues (`429 trop_tot`) ; ce n'est pas une protection enfants. Sécurité : §2.4 (actions `voiture_commande`, `voiture_niveau`) et §2.5. Jamais d'entity_id (plaque) dans le flux, les réponses ni les journaux.
>
> **Constat du 14/10 après-midi, écran noir du mode Photos sur le cadre** : le Wi-Fi du cadre (puce RK915) décroche par épisodes (pertes de 25 à 100 % pendant quelques minutes, signal pourtant bon ; `docs/cadre-ave948.md`). Une photo dont le transfert cale ne finit jamais (ni `load` ni `error`), et le mode Photos, ouvert avant d'avoir une photo, restait sur le fond Ardoise. Les décrochages observés commençaient dans la seconde qui suivait une photo reçue d'un bloc (14 h 26 min 43 s, 14 h 54 min 28 s) : le serveur relaie maintenant les photos à 256 Ko/s en morceaux de 4 Ko, débit partagé (`serveur/cadence.js`). Parades dans la page : vue pas prête au bout de 20 s remplacée (`web/src/photos.js`), première vue préparée pendant la minute qui précède l'entrée et entrée seulement une fois elle chargée (`pilotage.js` rend `'preparer'`, `ecrans/photos.js`), lectures `lire` bornées à 10 s corps compris (`api.js`).
>
> **Relecture du 14/10 au soir appliquée (trois relecteurs, après les parties 1 à 4 ; détail au §1.5, §2.2, §2.3 et dans le README)** :
> - **Tempo sur l'Accueil seulement du 1er novembre au 31 mars** (ta décision du 14/10, jusqu'ici pas appliquée) : pastilles de « La semaine », case de la veille d'un rouge ou d'un blanc et liseré, bornes jugées sur le jour Tempo (6 h à 6 h), testées au 31/10, 1/11, 31/03 et 1/04. Hors période, l'alerte « Demain blanc » de la page Aujourd'hui reste, et la fiche s'ouvre toute l'année depuis une **entrée « Tempo »** (pastille du jour, 96 px) en haut à droite de la page Aujourd'hui, posée hors de la grille (les cartes ne bougent pas).
> - **Routine du matin close à 9 h** (`fin_routine` du barème, 10 h 30 à la relecture, 9 h par choix de Thomas du 14/10) : avant, les étapes se cochaient toute la journée et les minutes se gagnaient le soir avant 20 h. Un enfant ne coche plus (`409 routine_finie`), les cases restantes passent en gris (ni croix ni rouge, comme le prévoyaient les propositions) ; un parent coche, valide et corrige encore.
> - **Geste parent** : plus de cadenas dessiné ni d'anneau (il se remplissait comme les cases que Timo tient chaque matin, donc s'apprenait en regardant). Une zone de 96 px sans dessin dans le coin bas droit : la tenir 3 s, lâcher, puis la toucher deux fois dans les 3 s ; aucun retour pendant le geste (`web/src/composants/geste-parent.js`).
> - **Fête du coffre et rebond des points après le mode parent** : la comparaison attend la fermeture du mode parent ; la fête se joue quand la quête revient si le parent a validé la dernière étape, le point rebondit quand Timo revoit l'onglet Points (c'est le cas normal : « N'excite pas Pablo » et les points se donnent en mode parent).
> - **Visages du haut** du mode enfant : l'étoile « fini » seulement sur l'enfant affiché (l'ourson étoilé de Pablo à côté du renard de Timo était une comparaison chaque matin).
> - **Avatar** devant le coffre fermé quand il ne reste que des étapes en attente d'un parent (il revenait sur « Levé », comme s'il reculait) ou quand la routine est close.
> - **Annuler sans jeton** seulement une coche de l'enfant (une étape cochée par un parent n'offre plus « Annuler » et le serveur refuse sans jeton).
> - **Fichiers d'état abîmés mis de côté, jamais écrasés** (`serveur/etat-local.js`) : un registre des points non conforme (une faute de frappe dans une correction à la main) était remplacé par un registre vide puis écrasé à la première action (tous les points perdus). Il est maintenant renommé `registre.json.abime-<horodatage>`, journalisé en erreur, puis le serveur repart de zéro ; une erreur d'accès fait échouer l'action sans rien remettre à zéro. Même règle pour la journée, `draps.json` (relu avant chaque appui) et `tempo.json`. Récupération dans le README, « Fichier d'état abîmé ».
> - **Tempo, réponse de RTE incomplète** : un `tempoLight` sans la couleur de la date du jour compte comme un échec (repli lu) ; après 10 h 45, demain manquant chez RTE est lu chez le repli ; une saison qui compte plus de 2 dates de moins que les jours publiés est refusée (plus de « 22 rouges restants » en plein hiver sur une saison vide).
> - **Voiture : alerte à 25 % pile** (ta phrase « alerte à 25 % »), plus « sous 25 % ». **Draps** rangés par urgence dans les alertes. **VOITURES** : un élément sans rôle reconnu ne recopie plus le texte fautif (il pouvait contenir l'entity_id, donc la plaque, dans les journaux Docker).
> - Ménage : entrée de menu « désactivée » retirée (les 8 écrans existent), anneau de 3 s retiré ; « min » du minuteur d'écran et crédit de la fiche Tempo passés à 26 px ; tests aux bornes (30 points pile, 60 s du jeton et 20 points par jour écrits en dur, carte voiture grisée à 6 h 01, demain du repli, limite exacte de la purge).
>
> **Appliqué le 14/10 au soir, à valider par Thomas** :
> - L'heure de **fin de la routine : 9 h** (choix de Thomas du 14/10 ; 10 h 30 avait été proposé). La case des visages de l'Accueil s'efface à la même heure.
> - Le **geste parent** : « coin bas droit, 3 secondes, puis deux petits touchers ». L'appui à deux doigts des propositions n'est pas retenu : le multi-touch du cadre n'est pas vérifié.
> - La **case des deux visages de l'Accueil** et l'écran d'entrée gardent chacun leur étoile « fini » côte à côte (prévu par les propositions, sans chiffre) : à toi de dire si c'est déjà une comparaison.
> - La **barre du temps jusqu'à 8 h 10** reste la même tous les jours (barème « tous les jours, même le mercredi, le week-end » ; un seul départ) : dis-moi s'il faut la masquer les jours sans école.
>
> **Partie 4 appliquée le 14/10 : les écrans des enfants** (variante B « les quêtes » pour Timo, pictogrammes dessinés ; détail au §1.4, §1.5 « Enfants », §1.6, §2.3, §3.2 et dans le README, « Tableau des enfants ») :
> - **Entrée** : entrée « Enfants » du menu (active), écran de deux grandes cartes (visage dessiné de 380 px, prénom en 80 px) ; le matin (5 h à 9 h, fin de la routine), sur l'Accueil, la case des deux visages ouvre directement le tableau d'un enfant ; une étoile dorée sur un visage quand sa routine est finie, jamais de chiffre côte à côte.
> - **Mode enfant** : menu masqué, bouton maison de 96 px, les deux visages en haut pour passer de l'un à l'autre, retour à l'Accueil après 90 s sans toucher.
> - **Quête du matin de Timo** : chemin en S de cases rondes (pictogramme, pièce « +5 », cadenas des étapes qu'un parent valide), son avatar sur la case en cours, coffre au bout qui s'ouvre avec une fête quand tout est validé (aucune minute en plus) ; appui long d'une seconde avec un anneau qui se remplit, petit son, « +5 » qui vole vers la bourse, pièces qui tombent ; Annuler 5 s ; barre sauge du temps jusqu'à 8 h 10.
> - **Bourse et minuteur** : les minutes qui restent en très grand ; « Je regarde » (appui long) en fait un disque façon Time Timer qui se vide, Pause, Fini ; pastille dans le menu sur les autres écrans ; à la fin, un son doux et « Fin de la vidéo, puis on éteint » par-dessus tout. Le cadre ne pilote rien.
> - **Points et boutique** : total (étoile et nombre), 5 derniers gains (motif ou « Bravo ! »), petit, moyen, gros cadeau avec ce qu'il manque, « Je veux ça » (appui long), « En attente d'un parent ».
> - **Pablo** : « D'abord, ensuite » : trois grands pictogrammes d'un simple toucher, étoile qui tombe dans son bocal, puis « Ensuite : une histoire » ; aucun texte.
> - **Mode parent** : geste sur le coin bas droit (**changé à la relecture** : zone sans dessin, 3 s puis deux touchers, sans retour ; avant, appui long de 3 s sur un cadenas), 60 s (bandeau et temps restant) : valider ou refuser les étapes en attente, cocher un oubli, décocher une erreur, +1 point (Bravo, rangé, mis la table, aidé), valider ou refuser une demande d'échange, 7 jours en pastilles.
> - **Socle** : le rechargement après un déploiement attend la sortie de l'écran des enfants ; sons doux en WebAudio sur le contexte partagé avec la sonnerie ; serveur : `avatar` au barème, 5 derniers `gains` dans le flux, correction d'un parent sans délai.
>
> **Appliqué le 14/10 pour la partie 4, à valider par Thomas** :
> - **Visages** : un renard pour Timo, un ourson pour Pablo, dessinés au trait sur la couleur de chacun, sans initiale (champ `avatar` du barème : la variante B prévoyait « l'avatar choisi par Timo », à lui demander).
> - **Case du matin** : à la place de Wi-Fi invités, et prioritaire sur la case Tempo jusqu'à 9 h (fin de la routine) (les machines se lancent le soir ; l'alerte « Demain rouge » de la page Aujourd'hui reste le matin).
> - **Correction d'un parent** : « Décocher » une étape validée, sans délai, en mode parent ; la partie 3 l'interdisait (« seule l'annulation des 5 s ») ; je l'ai ouvert pour « un parent corrige si besoin ». Jamais de retrait de points.
> - **Bourse** : le grand nombre est ce qui reste à regarder (« 18 gagnées » en petit dès qu'une partie est regardée), pas le total du matin.
> - **Barre du temps** de 6 h 30 (heure du Levé) à 8 h 10, la même tous les jours, mercredi et week-end compris (le barème n'a qu'un départ).
> - **Minuteur d'écran** : retour à l'Accueil après 90 s même s'il tourne (sa pastille reste dans le menu) ; pas de mode Photos tant qu'il tourne ; message de fin 2 min au plus, sans son pour une fin de plus de 30 s (page rechargée) ; aucun message si Timo touche « Fini » avant la fin.
> - **Annuler** : en haut à droite de la carte de la quête ; pour Pablo, un bouton retour (icône seule) 5 s, pour l'adulte à côté.
> - **Mode parent** : la page parent remplace la quête ou la boutique pendant les 60 s, pour l'enfant de l'écran (son historique seulement) ; les visages du haut changent d'enfant sans fermer la session.
> - **Places** : pastille du minuteur d'écran pendue au haut du menu, sur « La cuisine » ; en mode enfant, la pastille des minuteurs de cuisine en bas à gauche.
> - **Mots** : titres « La quête du matin » et « Mes points », onglets « Quête » et « Points », « Je regarde », « Je veux ça », « En attente d'un parent », « À demain » après 20 h.
>
> **Partie 3 appliquée le 14/10 : le tableau des enfants, côté serveur** (les écrans : partie 4 ci-dessus ; détail au §2.1, §2.2, §2.3, §2.5, §3.2 et dans le README, « Tableau des enfants ») :
> - **Barème versionné** `config/enfants.json`, validé au démarrage (schéma ajv et règles ; faux : le serveur ne démarre pas), copié dans l'image : le matin de Timo tel que Thomas l'a donné (Levé 10 validé par un parent et pas avant 6 h 30, Déjeuner au calme 5, Dents 3, Habillé 5, Cartable 5, N'excite pas Pablo 4 validé par un parent ; 32 min au plus, tous les jours ; départ 8 h 10), Pablo en étoiles (Petit déjeuner, Dents, Chaussures, puis « Ensuite : une histoire »), 1 point par action donné par un parent, boutique 30, 60, 90.
> - **Stockage** dans `DOSSIER_ETAT/enfants` (jamais dans HA) : une journée par fichier (4 h à 4 h, heure de Paris), le registre des points (gains, échanges, demandes en attente) ; écriture atomique, schéma à l'écriture et à la lecture, 16 Ko par journée et 256 Ko pour le registre, 90 jours gardés (purge douce, solde des points jamais touché).
> - **Routes** `/api/enfants/*` (clé exigée, 60 touchers par minute) : cocher, annuler dans les 5 s, valider ou refuser une étape en attente, +1 point, demander un échange, le valider ou le refuser, minuteur d'écran de Timo (démarrer, pause, finir ; jamais au-delà des minutes gagnées ni de 20 h), historique de 7 jours. **Mode parent** : jeton de 60 s délivré après le geste parent, exigé par les routes parent ; barrière contre les doigts d'enfants, pas une sécurité forte.
> - **Flux** : `instantane.enfants` et `maj { enfants }` (barème et état du jour fondus), aussi à la fin du minuteur, à 20 h et à 4 h ; lue par la page depuis la partie 4.
> - **Page** : seulement les préparatifs que le barème nomme : 11 pictogrammes au trait dans le sprite et les jetons `--enfant-timo` (ambre) et `--enfant-pablo` (violet), contrastes testés.
>
> **Appliqué le 14/10 pour la partie 3, à valider par Thomas** :
> - « Minutes perdues le soir » : à **20 h** (`minutes_perdues` du barème) ; le minuteur s'arrête à 20 h au plus tard, plus de minutes après, et le lendemain repart de zéro.
> - Libellés courts : « Levé », « Déjeuner au calme », « Dents », « Habillé », « Cartable », « N'excite pas Pablo » (tes mots gardés ; une tournure positive, « Calme avec Pablo », est possible) ; motifs des points tirés des maquettes : « A rangé », « A mis la table », « A aidé », ou aucun.
> - Un parent peut refuser une étape en attente (retour « à faire », rien de gagné) et cocher lui-même n'importe quelle étape (validée tout de suite) : c'est ainsi qu'il « corrige si besoin » ; il ne peut jamais retirer une étape validée (seule l'annulation des 5 s le fait, plus 1 s de marge réseau, par n'importe qui). **Changé à la partie 4** : en mode parent, il peut aussi décocher une étape validée, sans délai (étape cochée par erreur).
> - Aucune annulation d'un +1 point (règle « jamais retirer de points ») ; 20 gains au plus par journée et par enfant (taille du fichier).
> - Une seule demande d'échange en attente par enfant : la nouvelle remplace l'ancienne ; le prix est recopié dans la demande ; solde revérifié à la validation.
> - Aucune heure limite pour cocher (ni avant ni après le départ de 8 h 10), sauf « Levé » à partir de 6 h 30. **Changé à la relecture** : routine close à `fin_routine` (9 h, choix de Thomas du 14/10). « Fini » referme le minuteur en gardant les minutes restantes.
> - Étoiles de Pablo comptées par journée (pas de bocal qui se remplit sur la semaine : non décidé).
> - Jeton parent : un seul à la fois, 60 s fixes depuis le geste (non prolongé par l'usage), oublié au redémarrage.
>
> **Partie 2 appliquée le 14/10 : les voitures** (le tableau des enfants viendra ensuite ; détail au §1.4, §1.5 « Voitures », §2.2, §2.5 et dans le README, « Voitures ») :
> - **Écran Voitures** (entrée « Voitures » du menu, lecture seule) : une carte par voiture, nom de la configuration (jamais le `friendly_name` de HA, qui contient la plaque), icône et mot de l'état (débranchée, branchée, en charge avec « prête vers 6 h 40 », charge programmée, erreur), pourcentage en 240 px, autonomie, jauge en forme de batterie ; grisée avec « vu il y a 9 h » au-delà de 6 h ; « Voiture pas encore reliée » sans configuration.
> - **Alerte** : de 18 h à minuit, batterie à 25 % ou moins (**changé à la relecture**, avant « sous 25 % ») et prise débranchée, dans les alertes de la page Aujourd'hui (après les ouvertures, avant les draps) et le compteur de son encart, pas sur l'Accueil.
> - **Configuration** : variable `VOITURES` (« Mégane: batterie=sensor.x, branchee=binary_sensor.y, ... », deux voitures au plus), vide par défaut, validée au démarrage ; `sensor` et `binary_sensor` seulement, au rôle qui les attend : jamais `device_tracker`, bouton, `select`, `number`, ni entity_id qui parle de position ou de kilométrage. L'intégration Renault n'est pas encore dans HA : à faire par Thomas (README).
> - **Menu** : 8 entrées (Accueil, Météo, Repas, Courses, Maison, Agenda, Enfants, Voitures) ; **l'entrée Photos est retirée** : mesuré le 14/10, une 9e entrée de 96 px porte le menu à 1 157 px au pire cas (pied sur 3 lignes), au lieu de 1 048 avec 8. Le mode Photos reste automatique après 3 min sans toucher ; sa face « page » (message quand il n'y a pas de photos), qui ne servait qu'à l'entrée du menu, est retirée aussi.
>
> **Appliqué le 14/10 pour la partie 2, à valider par Thomas** :
> - Seuil strict : « sous 25 % » (25 % pile ne donne pas d'alerte). **Changé à la relecture** : 25 % pile donne l'alerte (« alerte à 25 % »). L'alerte vaut aussi sur une donnée vieille (une voiture garée débranchée ne renvoie plus rien, c'est le cas à signaler) ; jamais sur une batterie ou une prise inconnues.
> - Entrée Enfants montrée **désactivée** (contour en pointillés, aucun effet) tant que son écran n'existe pas : sa place est réservée, le menu ne bougera pas à la partie 4 (active depuis ; le mécanisme « désactivée » est retiré à la relecture, les 8 écrans existent).
> - `batterie` et `branchee` obligatoires dans `VOITURES` (l'alerte du soir en a besoin), le reste facultatif ; deux voitures au plus (place mesurée : deux cartes de 471 px).
> - Signe % en demi-taille et en optique de texte (en Fraunces d'affichage à 240 px, son trait est un filet invisible à 2 m, vu sur capture).
> - Écart relevé à la partie 2 : la décision « Tempo sur l'Accueil seulement du 1er novembre au 31 mars » n'était pas appliquée. **Traité à la relecture du 14/10 au soir** (voir en tête).
>
> **Partie 1 appliquée le 14/10** :
> - **Accueil** : la carte « À faire » est retirée (doublon avec les alertes de la page Aujourd'hui) ; Courses et Air et pollens restent à parts égales.
> - **Draps** (demande d'Agathe) : trois cartes dans Maison > Entretien, cycle de 15 jours, rappel 2 jours avant puis « à changer », dans les alertes de la page Aujourd'hui seulement ; dates gardées par le serveur du cadre (`draps.json`), jamais dans HA.
> - **EDF Tempo** : JSON public de RTE, repli api-couleur-tempo.fr, filet local ; pastille dans « La semaine », fiche, case « Demain rouge » dès la pré-annonce (rappel plus discret la veille d'un blanc), « Heures creuses, les machines ! » à 22 h, liseré rouge un jour rouge, alerte de la page Aujourd'hui.
> - **Photos** : au hasard dans toute la photothèque (`IMMICH_SOURCE=tout`), sans vidéos, archivées, dossier verrouillé ni corbeille.
> - **Socle** : la page se recharge d'elle-même après un déploiement (empreinte du contenu servi dans l'instantané du flux).
>
> **Appliqué le 14/10 pour la partie 1, à valider par Thomas** (choix faits pour appliquer ces décisions ; détail au §1.5, §1.6, §2.2, §2.3 et dans le README) :
> - La case Tempo prend la place du bouton **Wi-Fi invités** (le moins utile au quotidien, l'onglet Wi-Fi de Maison reste à un toucher ; Minuteur, Alarme et Apple TV servent chaque jour) : même case de 386 x 96 px, « Demain rouge » sur une ligne en 32 px, « Heures creuses, / les machines ! » sur deux lignes en 26 px (mesuré). Rouge plein la veille d'un rouge, vert (bouton fort) aux heures creuses ; fond de carte cerclé pour un blanc (plus discret). De 22 h à 6 h, ce sont déjà les heures creuses de la veille.
> - Pré-annonce ou confirmation : la donnée de RTE ne le dit pas (sa clé `-fallback` signale un mode dégradé, seulement journalisée) ; une couleur lue la veille avant 10 h 40 est « pré-annonce » (pastille en pointillés, mot « pré-annonce » dans la fiche), après, confirmée. Règles fixes du filet : dimanche toujours bleu, pas de rouge le samedi, le dimanche, un férié de novembre à mars (lundi de Pâques compris) ni d'avril à octobre ; vérifiées sur la saison 2025-2026 réelle (365 jours, aucun rejet).
> - Rythme Tempo : 6 h 05, puis toutes les 30 min tant que demain n'est pas connu, 10 h 45, 11 h 15, 12 h 30, la saison une fois par jour (au démarrage et à partir de 11 h 15) ; 15 min après un échec des deux sources. Jours restants : demain compté dès qu'il est connu.
> - Draps : un lit jamais noté n'a ni rappel ni alerte (« pas encore noté ») ; annulation de 5 s faite dans la page avant l'envoi (le serveur n'a aucune date à rétablir) ; la carte des piles de l'Entretien montre 5 lignes au plus ; le bandeau « Mode essai » n'est plus montré sur l'onglet Entretien (les draps, eux, sont toujours notés).
> - Rechargement après un déploiement : bloqué par un minuteur qui tourne ou sonne, une recette ouverte, l'écran Enfants (partie 4) ou le bandeau sonnette, et attendu 60 s sans toucher (comme celui de 4 h).
>
> **Décisions de Thomas du 14/10/2026, après avoir vu le cadre (priment sur tout le reste du document, décisions plus anciennes comprises).** Ce que Thomas a dit, tel que la consigne du 14/10 le rapporte :
> - « j'aime pas la montagne de texte sous l'heure dans l'accueil » : le **brief du matin en phrases sous l'heure est refusé**.
> - « l'agenda j'imaginais un vrai calendrier pas des lignes » : il a choisi **la semaine en grille** (7 colonnes du lundi au dimanche, heures de haut en bas, rendez-vous en blocs colorés par personne, comme Google Agenda en vue semaine).
> - Pour le matin : « une page qui affiche quoi de prévu aujourd'hui depuis un petit bouton ou encart qui s'appelle Aujourd'hui ».
> - « maison top, repas top, courses top » : **Maison, Repas, Courses à garder tels quels**.
> - « météo ok mais trop verbeux ».
> - **Principe** (mémoire de Thomas) : l'écran est lu de loin, en passant, par toute la famille. Icônes, chiffres, grilles, pastilles ; un détail n'apparaît que s'il est utile, et le détail va sur une page dédiée. Pas de phrase quand une icône et un chiffre suffisent.
>
> **Appliqué le 14/10, à valider par Thomas** (choix faits pour appliquer ces décisions, pas des décisions de Thomas ; détail aux §1.5 « Accueil », « Aujourd'hui », « Météo », « Agenda » et dans le README) :
> - **Accueil** : le même toute la journée, dans l'option A validée le 11/10 (température actuelle en 120 px à droite de l'heure). Une fourchette « 15° → 21° » le matin a été essayée puis retirée : tirée de met.no, elle contredisait le maxi et le mini d'Open-Meteo de « La semaine », sur le même écran. Ligne du ciel : la pluie dans l'heure seulement s'il en tombe ; carte Air : pollen dominant écrit comme sur la Météo (« Graminées · élevé », « Pas de pollen »), sans grains/m³.
> - **Encart et page « Aujourd'hui »** : encart à droite de la date (une icône et un nombre par sujet : rendez-vous, rappels, alertes) ; quatre cartes (Météo, Repas, Rendez-vous, À prévoir) et la bande Alertes seulement s'il y en a ; ce qui est passé disparaît (périodes, rappels de la matinée, gamelle après 14 h, rendez-vous finis) ; rendez-vous à l'heure d'abord, puis une seule ligne « Journée » ; alertes à partir de ce qui demande d'agir : air « dégradé » (le « moyen » est le niveau de presque tous les jours à Saint-Savin), pollen « élevé » (seuils [S]), ouvertures, encre sous 15 %, piles ; place mesurée : 7 lignes de rendez-vous et 3 rappels, 4 et 2 avec la bande des alertes.
> - **Agenda** : heures de 7 h à 19 h, élargies à l'heure pleine de 6 h à 23 h au plus (au-delà, le bloc est collé au bord et coupé, avec sa vraie heure) ; rangée « journée entière » réduite à ses lignes de barres (aucune, une ou deux) ; blocs écrits « heure puis titre » ; chevauchements sur les vraies heures (moins de 30 min compte pour 30), deux colonnes au plus puis un bloc « +N » ; le serveur lit quatre semaines (un appel par calendrier, comme avant).
> - **Météo** : en tête pictogramme, température en 96 px et ciel ; le vent seulement à partir de 40 km/h (force 6 de Beaufort, citée de mémoire [S]) ; la pluie d'une heure seulement si elle tombe, celle d'un jour au-delà de 0,5 mm ; plus de probabilité de pluie (retirée aussi des requêtes du serveur) ; air en mot avec sa pastille et « indice 29 » dessous ; demain seulement s'il est pire ; pollens présents seulement ; crédits sur une ligne.
>
> **Décisions de Thomas du 11/10/2026 (priment sur le reste du document)**
> - **Agenda : OUI**, calendriers iCloud ET Google (Q10 tranchée). Sources : intégration CalDAV de HA pour iCloud (mot de passe d'application iCloud), intégration Google Calendar de HA (identifiants OAuth gratuits). Écran Agenda + agenda dans la colonne « La semaine » et dans le brief. Écritures dans HA = accord de Thomas.
> - **Sonnette : photo + direct + bascule de l'écran** (Q12 tranchée) : route `/api/sonnette.jpg` et action `script.sonnette_direct` prévues en M5.
> - **Télécommande : Apple TV ET télé TCL.**
> - **Non retenus** : « Je pars / Bonne nuit » (Q11 : pas de scripts, pas de boutons), « Qui est à la maison » (Q13), « Portes et fenêtres » (Q14).
> - **Trajet** : reste « à étudier » (M7).
> - **Visuel validé (Q6, Q7, Q8)** : menu large avec noms partout, masqué en Photos et en Nuit (un toucher le ramène) ; verre dépoli seulement sur le diaporama et le bandeau sonnette ; Chêne clair le jour, Ardoise le soir, nuit 23h-5h (heure seule, très atténuée).
> - **Portraits (Q9)** : par paires côte à côte.
> - **Q34 tranchée : option A** (température et pictogramme à droite de l'heure, ciel et pluie sur une ligne sous la date, plat du soir en 90 px sur une ligne avec le bouton Recette à droite). À appliquer en M3 avec le vrai menu. **Q33 (graisse des chiffres à 2 m)** : tranchée sur le cadre, à l'essai « Agathe lit à 2 m ».
> - **Docker** : image construite sur le M900 (pas de Docker sur le Clevo), chaque déploiement avec l'accord de Thomas.
> - **Jeton de dev** : jeton de Mur (vérifié non admin) dans `~/.config/cadre/ha_token_dev`, lecture seule jusqu'à M3.
> - **Météo : 7 jours quotidiens Open-Meteo, actuel et horaire met.no via HA** (met.no via HA ne donne que 6 jours ; une seule source pour toute la colonne « La semaine »).
>
> **Décision de Thomas du 13/10 (prime sur le §1.5 Maison, le §2.4 et M5)** : le cadre est loin de la sortie, il ne sert **ni à désarmer ni à armer** l'alarme. Pas de clavier à code ni d'armement : l'alarme est en **lecture seule** sur le cadre (« une petite vue quand on appuie sur Alarme pour voir ce qui est ouvert et fermé »). Les actions maison restantes (télécommandes, direct de la sonnette) passent par un garde-fou séparé, `ACTIONS_MAISON`, simulé par défaut.
>
> **Corrections de relecture (Claude, 11/10)**
> - §0.8 : ce sont les sous-agents de recherche qui ont été bloqués par le classifieur du mode auto. Depuis la session principale, les lectures SSH et les GET sur le M900 ont fonctionné. Les écritures en prod restent soumises à l'accord de Thomas.
> - Frameo ≥ 1.29 : vérifié sur immichframe.dev (« This is not possible with Frameo app versions >= 1.29 ») ; contournement documenté : désinstaller les mises à jour de l'appli Frameo (retour à la 1.24) puis la désactiver, la doc utilise `su`. Les cadres Frameo tournent souvent sous un très vieil Android (testé en Android 6.0.1). À relever le 13/10.
> - « Claude à l'écran » avec l'abonnement : zone grise des conditions d'utilisation, pas une interdiction établie. Reste en M7.
> - Relecture de l'écran Accueil : le budget de hauteur du §1.5 (982 px) était faux, relevé réel et options en Q34 ; le ciel de « La semaine » vient des heures de jour et non du code quotidien d'Open-Meteo (§2.2) ; le bandeau hors ligne quitte l'horloge (§1.6) ; deux questions visuelles nouvelles (§7.5).
>
> **Corrections de relecture (Claude, 13/10 soir, trois relecteurs ; détail dans le README)**
> - Sonnette : la photo de HA n'est réécrite que 7 à 20 s après la sonnerie, et parfois jamais ; le serveur suit donc de quand elle date (`serveur/ha/sonnette.js`, clé `sonnette` du flux) et le bandeau ne montre que la photo de CE coup. « Voir le direct » seulement avec un flux vidéo go2rtc : la photo fixe rafraîchie toutes les 2 s n'était pas un direct (retirée). La vidéo n'est demandée qu'après l'accord de la maison.
> - **Risque à trancher par Thomas** (§2.5) : le go2rtc de HA écoute le réseau local sans authentification ; `GO2RTC_FLUX_SONNETTE` reste vide d'ici là.
> - Un toucher qui masque le bandeau ou quitte le mode Photos ne déclenche plus le bouton dessous ; Veille et applis de l'Apple TV à l'appui long d'une seconde, applis limitées à une liste écrite ; bouton « Apple TV » (et non « Télé ») sur l'Accueil.
> - Agenda sur l'Accueil : le premier rendez-vous de chaque personne est toujours visible (« La semaine »), une ligne par personne dans le brief ; lien du lieu remplacé par « Visio ».
> - Serveur : lecture HA abandonnée au bout de 25 s, calendriers lus en parallèle ; corps lus sous plafond (Immich, photo) ; seules les photos d'un lot récent sont relayées (album) ; câblage des garde-fous testé.
> - Écrans pour la famille : plus de chemins ni de variables sur le cadre (Wi-Fi, Agenda) ; entrée Photos masquée sans clé Immich.


Révision de la v1 après la relecture contradictoire. Ce qui change :
- Le diagnostic « Eufy figé » est retiré. Il était faux, seul le mouvement ne remonte pas.
- Le lanceur et le son deviennent des tests obligatoires le 13/10, dans le délai de retour.
- M0 est réduit au kit du jour J.
- Le menu passe à 2 états.
- Les tailles sont recalculées pour une lecture à 2 m, et la grille de l'Accueil est corrigée.
- L'alarme est durcie.
- Les routes avec Claude sont complétées.
- Les incohérences de ta sélection deviennent des questions. Rien n'est codé avant ta réponse.
- La construction se fait sur le Clevo, pas sur le M900.
- L'exception durable à ta règle sur les écritures en prod est présentée à part.

**Marqueurs.**
- [V Rn] : vérifié par le rapport de recherche n, qui cite sa source.
- [V M] : vérifié dans les maquettes (`scratchpad/cadre-cuisine.html`).
- [V I] : vérifié dans l'inventaire HA local (`scratchpad/ha_states.json`, instantané du 11/10 à 11:41 UTC).
- [V L] : vérifié par moi aujourd'hui (commande locale sur le Clevo, fichier du scratchpad ou GET public). La source est citée.
- [V rel.] : vérifié par la relecture, source citée, pas revérifié par moi.
- [S] : supposition à confirmer.

Rapports : R1 navigateur et kiosque ; R2 Home Assistant et serveur intermédiaire ; R3 Immich ; R4 données externes ; R5 liaison avec Claude ; R6 matériel et veille.

---

## 0. À savoir avant tout

1. **Le mouvement Eufy ne remonte pas à HA. Les ouvertures et la sonnette, si.** La v1 disait le contraire, c'est corrigé. Les valeurs de `last_changed` [V I] :

   | Entité | Dernier changement (UTC) |
   |---|---|
   | `binary_sensor.porte_d_entree_sensor_open` | 10/10 21:00:02 (23:00 à Paris, l'heure de l'armement nuit : suspect, peut-être un passage unavailable vers off) |
   | `binary_sensor.doorbell_ringing` | 08/10 11:49:57 (`camera.doorbell` a changé à 11:53, ce qui ressemble à une vraie sonnerie) |
   | `binary_sensor.baie_vitree_centrale_sensor_open` | 07/10 16:03 |
   | `binary_sensor.porte_garage_sensor_open` | 07/10 13:34 |
   | `binary_sensor.fenetre_salon_sensor_open` | 06/10 17:50 |
   | `salon_motion_detected`, `garage_motion_detected`, `doorbell_motion_detected`, `doorbell_person_detected` | 04/10 05:40, au redémarrage de HA, et plus rien depuis |

   Seul constat solide : **le mouvement ne remonte pas**, ce qui rejoint la note de la mémoire sur le pont Eufy. En M1, une lecture de l'historique séparera les vrais changements des passages unavailable vers off. Aucune panne n'est annoncée sans cette preuve.
2. **Trois tests décident du projet le 13/10, dans le délai de retour** (30 jours d'après la fiche Amazon, environ jusqu'au 12/11, à confirmer sur la commande) : l'installation d'un APK, le remplacement du lanceur (démarrage seul après une coupure) et le son (minuteurs audibles).
3. **Le Wi-Fi invités ne passe pas par HA.** `switch.freebox_v9_r1_wi_fi` coupe tout le Wi-Fi, cadre compris, et l'intégration Freebox ne gère pas les clés invités [V R2, R4].
4. **Dans HA, un jeton non admin pilote toutes les entités.** La politique `system-users` vaut `{"entities": True}`, comme celle des admins [V R2]. Aucun jeton HA ne va donc sur le cadre : un serveur intermédiaire avec liste blanche est obligatoire.
5. **Deux portes contournent le panneau à code** : `alarm_control_panel.alarm_center` et `select.alarm_center_guard_mode` (code_format null) [V R2, I]. Elles sont interdites dans le serveur.
6. **Correction de l'inventaire.** L'entité Android TV Remote du TCL est `media_player.smart_tv_pro_2_2`. `media_player.smart_tv_pro_2` est l'entité Cast [V R2, I].
7. **Une exception durable à ta règle « pas d'écriture en prod sans accord » sera nécessaire** pour que le cadre serve au quotidien (publication du menu, liste de courses). Je la présente à part (§6.0) : tu la valides une fois, en connaissance de cause, ou tu la refuses.
8. **Le classifieur de Claude Code bloque les lectures en prod sur le M900** [V R2, R5]. Les commandes à lancer là-bas te seront données, comme pour `sauvegarde.sh`.

---

## 1. Synthèse visuelle

### 1.1 Ce que dit ta sélection [V M]
**Ce qui est retenu tel quel :**
- piste 1 : l'accueil grosse horloge avec la semaine à droite ;
- piste 2 : l'ambiance claire chêne, le menu large avec les noms, l'accueil en cartes, les gros boutons maison ;
- piste 5 : les pastilles en verre dépoli, le menu discret, la notification sonnette en haut.

**Non cochés, donc non prévus :** « Bonsoir selon l'heure », la barre d'état maison et la colonne d'icônes fine (piste 1), l'ambiance sombre de la piste 1, « les photos Immich en fond » (piste 5) et l'ajout rapide des produits habituels.

**Incohérences posées en questions (§7.2), sans code avant ta réponse :**
- le menu large et le menu discret sont choisis ensemble (Q6) ;
- le verre dépoli est choisi sans les photos en fond (Q7) ;
- l'Ardoise n'est pas cochée, mais le mode nuit l'est (Q8) ;
- l'affichage des portraits (Q9).

Chaque fois, une proposition par défaut est décrite plus bas.

### 1.2 Principes
- **Scène fixe de 1920x1080 px CSS.**
  - Page : meta `viewport width=1920, user-scalable=no`.
  - Kiosque : `setUseWideViewPort(true)`, `setLoadWithOverviewMode(true)`, `setSupportZoom(false)`.
  - Secours : mise à l'échelle par `transform` en JS si `innerWidth` n'est pas 1920, comme le fait Wes dans `dashboard/js/app.js` [V rel.]. La densité est peut-être de 240 dpi [S R1].
- **Deux distances de lecture.** Calcul : écran 15,6" en 16:9, pas de 0,180 mm par pixel [V L].

  | Lu de loin (2 m) | Taille | Angle de la capitale |
  |---|---|---|
  | Heure | 260 px | 56' |
  | Température actuelle, minuteur en cours | 120 px | 26' |
  | Plat du soir | 90 px | 19,5' |

  Le texte lu en touchant fait au moins 26 px, et les intitulés de carte 22 px en capitales espacées. Un texte de 26 px ne donne que 4' de hauteur d'x à 2 m, au seuil de l'acuité [V L]. La règle courante demande au moins 16' de hauteur de capitale, 20 à 22' conseillées (ISO 9241-3, cité de mémoire [S rel.]).
- **Cibles tactiles d'au moins 96 px partout**, menu compris.
- **Toucher.** La navigation part sur `pointerdown` (règle de Wes) [V R1]. Les actions (alarme, télé, cocher) partent sur `pointerup`, avec un déplacement inférieur à 20 px et 300 ms d'anti-répétition, à cause des doigts mouillés et des touches fantômes.
- **Polices** de la piste 2 : Fraunces (horloge, titres, chiffres) et Nunito Sans (texte). WOFF2 auto-hébergées, sous-ensemble latin, 2 graisses employées par police. Sur l'horloge, `font-variation-settings: "opsz" 144` est fixé explicitement, car l'ajustement optique automatique est peut-être absent d'une vieille WebView [S rel.] : il n'existe qu'à partir de Chrome 79, l'axe opsz est donc fixé partout où Fraunces sert. Les fichiers sont des polices variables complètes (Fraunces : instance par défaut Black, opsz 9 ; Nunito Sans : ExtraLight) : sans prise en charge des polices variables (essai « fvs » de `compat.html`, avant Chrome 62), il faudra des instances statiques. Finesse des chiffres à 2 m : Q33.
- **Icônes** : le sprite SVG des maquettes, 13 symboles [V M].
- **Animations** : uniquement `transform` et `opacity`, un seul tick central par seconde, vues préconstruites (règles de Wes) [V R1].
- **Heure** : `Intl.DateTimeFormat('fr-FR', {timeZone: 'Europe/Paris'})`, appliqué à `Date.now()` corrigé par le décalage tiré de `heure_serveur`. Le fuseau et l'horloge d'Android peuvent être faux sur un cadre sans Internet.

### 1.3 Thèmes et mode nuit
Les couleurs viennent des maquettes [V M]. Une correction : le texte secondaire sur le menu.

| Jeton | Jour « Chêne clair » (piste 2) | Soir et nuit « Ardoise » (piste 1, Q8) |
|---|---|---|
| fond | `#eef1ec` | `#1c2225` |
| menu latéral | `#e2d3bd`, bordure `#cdb999` | `#151a1c` |
| carte | `#ffffff` | `#232b2d` |
| texte | `#22302b` | `#e8ebe4` |
| texte secondaire (cartes, fond) | `#5d6b65` | `#8d9a95` |
| texte secondaire sur le menu | `#4d4433` (au lieu de `#5d6b65`) | `#8d9a95` |
| accent | `#2f5d50` | `#a9d3ae` |
| chiffres chauds | `#2f5d50` | `#f2c57c` |

Contrastes WCAG calculés [V L] :
- `#5d6b65` sur le menu `#e2d3bd` : 3,80:1, échec AA. D'où le remplacement par `#4d4433`, qui donne 6,52:1.
- `#5d6b65` : 5,59:1 sur blanc, 4,91:1 sur le fond.
- `#2f5d50` : 7,49:1 sur blanc.
- `#8d9a95` : 5,51:1 sur `#1c2225`, 4,94:1 sur `#232b2d`.
- `#7a8a83`, utilisé pour les intitulés dans la maquette, ne donne que 3,63:1 sur blanc : il n'est pas repris.

Un test automatique de contraste fait partie de M2.

**Bascule, horaires et soleil seulement** (« Bonne nuit » s'y ajoutera seulement si Q11 est tranchée) :
- **jour** quand `sun.sun.attributes.elevation` dépasse -6° ;
- **soir** en dessous, avec une hystérésis de 1° ;
- **nuit** de 20 h 30 à 6 h (choix de Thomas du 14/10 ; 23 h à 5 h au départ, les heures de l'alarme) : seule l'horloge reste, en Ardoise atténuée.

Luminosité par le pont du kiosque : 0,6 le jour, 0,3 le soir, 0,05 la nuit (1,0 et 0,4 au départ, baissés le 14/10 à la demande de Thomas ; 1,0 pendant une alerte). La valeur 0 met le rétroéclairage au minimum, elle ne l'éteint pas [V R1]. Si HA est injoignable, le dernier état est conservé.

### 1.4 Menu latéral : 2 états (proposition pour Q6)
- **Large, 240 px** (piste 2), sur tous les écrans sauf Photos et Nuit.
  - 7 entrées de 96 px de haut : icône et nom (Accueil, Météo, Repas, Courses, Maison, Photos, plus Agenda si Q10). **14/10 (partie 2)** : 8 entrées, Accueil, Météo, Repas, Courses, Maison, Agenda, Enfants (désactivée jusqu'à la partie 4, active depuis), Voitures ; **plus d'entrée Photos**. Mesure dans Chromium, pied au pire cas sur 3 lignes (« hors ligne depuis 12 min ») : 36 + marque 35 + 24 + 8 x 96 + 7 x 6 + 24 + pied 94 + 32 = 1 055 px, pied fini à 1 048 ; avec Photos en 9e entrée, 1 157 px, 77 de trop. Le mode Photos reste automatique (3 min sans toucher).
  - « La cuisine » en tête.
  - En pied, l'état de la connexion (« à jour », « hors ligne depuis 3 min ») en `#4d4433`.
- **Masqué** en Photos et en Nuit : rien à l'écran. Un toucher n'importe où ramène l'Accueil avec le menu. C'est le « menu discret qui se fait oublier » de la piste 5, sans colonne fine de 58 px, trop petite pour un doigt.

Pas d'animation de largeur. On bascule en un seul fondu d'opacité.

### 1.5 Les écrans

**Accueil** (pistes 1 et 2, menu large affiché)
- Grille : menu 240 px, puis zone principale avec 32 px de marge et `grid-template-columns: minmax(0,1fr) 560px; column-gap: 32px; grid-template-rows: 1fr auto`. Le compte : 240 + 32 + 1024 + 32 + 560 + 32 = 1920 px.
- **Colonne gauche, 1024 px :**
  - heure en Fraunces 260 px, puis la date « Mardi 13 octobre · Paris » en 40 px ;
  - ligne météo : température en 120 px, puis le ciel et, seulement s'il en tombe, la pluie dans l'heure (goutte et quantité) en 40 px (Open-Meteo au pas de 15 min, voir §4) ;
  - bloc **« Ce soir »** : le plat en 90 px (2 lignes au plus), le temps en 32 px et un bouton Recette de 96 px. Le même matin et soir depuis le 14/10 (le brief du matin en phrases qui le remplaçait de 5h à 10h30 est refusé) ;
  - 14/10 : **encart « Aujourd'hui »** (300 x 96 px) à droite de la date et de la ligne du ciel, sans changer la hauteur de la colonne : une icône et un nombre par sujet non vide (rendez-vous, rappels, alertes : ce qui reste à faire aujourd'hui), « rien de prévu » sinon ; il ouvre la page Aujourd'hui. La température reste l'actuelle toute la journée (une fourchette du matin, essayée le 14/10, contredisait « La semaine ») ;
  - une rangée de **cartes** (piste 2, texte de 26 px), à parts égales (500 px chacune, mesuré) : « Courses · n » (4 premiers articles, précédés d'une puce : on coche dans l'écran Courses, pas depuis l'Accueil) et « Air et pollens » (pastille et niveau en mot, « indice 29 », puis le taxon dominant avec son niveau, « Graminées · élevé », ou « Pas de pollen » : les mots de l'écran Météo, seuils [S] en attendant les seuils EAACI). La 3e carte « À faire » (encre, piles) est **retirée le 14/10** (choix de Thomas : doublon avec les alertes de la page Aujourd'hui, où vont aussi les rappels nouveaux, draps et Tempo).
- **Colonne droite, 560 px : « La semaine »** (piste 1). Sept lignes d'environ 124 px, aujourd'hui en avant : jour, pictogramme, maxi et mini en 40 px, repas du soir en 26 px (plus le midi le week-end). 14/10 : **pastille EDF Tempo** de 36 px (seulement du 1er novembre au 31 mars, relecture du 14/10 au soir) (éclair sur bleu, blanc cerclé ou rouge ; « ? » gris si inconnue ; pointillés si pré-annoncée) à côté d'aujourd'hui et de demain, dans une colonne de 40 px entre le jour et le ciel (il reste 218 px aux températures, mesuré), zone de toucher de 96 x 96 px (marges négatives : la ligne ne grandit pas) ; un toucher ouvre la **fiche Tempo** (aujourd'hui, demain, jours restants rouge, blanc, bleu, heures creuses de 22 h à 6 h, « Jour rouge jusqu'à 22 h » un jour rouge, la source).
- **Barre du bas, sur les deux colonnes : gros boutons maison** (piste 2) de 96 px.
  - Version 1 : Minuteur, Alarme (état et ouvertures, ouvre la vue Alarme de l'écran Maison, lecture seule), Wi-Fi invités, Télé.
  - 14/10 (partie 4) : de 5 h à 9 h (fin de la routine), la **case des enfants** prend la place de Wi-Fi invités (et passe avant la case Tempo) : les deux visages dessinés de 72 px, chacun sur sa moitié de case, ouvrent le tableau de leur enfant ; une étoile dorée sur celui dont la routine est finie, jamais de chiffre.
  - 14/10 : la veille d'un jour Tempo rouge (dès la pré-annonce) ou blanc, la **case Tempo** prend la place de Wi-Fi invités : « Demain rouge » (lave-linge, fond rouge ; pour un blanc, fond de carte cerclé, plus discret), puis à partir de 22 h « Heures creuses, / les machines ! » (vert) jusqu'au mode nuit ; un toucher ouvre la fiche Tempo. Justification et mesures dans le bloc du 14/10 en tête.
  - « Bonne nuit » et « Je pars » sont dans la maquette choisie [V M], mais leur fonction n'est pas cochée (Q11).
- **Hauteurs réelles** (relevées le 11/10 dans Chrome à 1920x1080 ; l'estimation de 982 px de la v2 était fausse) :
  - colonne gauche disponible : 1080 - 32 - 32 (marges) - 96 (barre) - 24 (écart) = 896 px ;
  - parts fixes : heure 224 (260 px, interligne 0,86), date 12 + 48, météo 28 + 120, marge avant « Ce soir » 40, soit 472 px ;
  - cartes : 248 px (2 cartes, 4 articles), 294 px dans le pire cas relevé (3 cartes, « Extrêmement mauvais » sur 2 lignes, piles aux noms longs) ;
  - reste pour « Ce soir » : **176 px, 130 dans le pire cas**.
  - Besoin de « Ce soir » tel que décrit plus haut : intitulé 29 + 10, plat 99 px par ligne, temps 42, bouton 96, soit 276 px avec un plat sur une ligne et 375 avec deux. Plats mesurés à 90 px : « Gratin de potiron » 588 px (1 ligne), « Saucisson brioché, salade verte » 1047 px et « Soupe de potiron, croque-monsieur » 1202 px : deux lignes est le cas courant.
  - Il manque donc 100 à 250 px. La répartition est à trancher avant M3 (Q34) ; d'ici là, « Ce soir » n'affiche que « Menu pas encore publié ».

**Aujourd'hui** (décision du 14/10, à la place du brief du matin ; menu visible, aucune entrée marquée, retour à l'Accueil après 60 s)
- Grille de 2 x 2 grandes cartes, une par sujet : **Météo** (matin, après-midi et soir encore à venir : pictogramme, température en 84 px, pluie seulement s'il en tombe), **Repas** (gamelle ou midi du week-end jusqu'à 14 h, plat du soir en 48 px, temps, bouton Recette), **Rendez-vous** (à l'heure d'abord : heure en 48 px, pastille de la personne, titre ; puis une seule ligne « Journée » pour les événements sur toute la journée, deux et « +N » ; « Rien de prévu »), **À prévoir** (rappels du menu dont le moment n'est pas passé : matin jusqu'à midi, midi jusqu'à 14 h, après-midi jusqu'à 18 h, soir jusqu'à minuit ; 2 lignes chacun au plus).
- Bande **Alertes** sur toute la largeur, seulement s'il y en a, et seulement pour ce qui demande d'agir, dans cet ordre : veille d'un jour Tempo rouge ou blanc (dès la pré-annonce : « Demain rouge · machines après 22 h », puis « lancer les machines » à 22 h), ouvertures ouvertes, voiture à brancher (14/10, partie 2 : de 18 h à minuit, batterie à 25 % ou moins et prise débranchée, « Mégane » puis « 18 % · à brancher »), draps (« Lit de Timo · draps dans 2 jours », « à changer », « draps, 3 jours de retard » (court : la case des alertes coupait « à changer (3 jours de retard) », vu sur capture), la plus urgente d'abord), air à partir de « dégradé » (pastille jaune ; « moyen », vert, est le niveau de presque tous les jours, 96 heures sur 96 dans la réponse du 11/10), pollen « élevé » (seuils [S] de `web/src/air.js`), encre sous 15 %, piles faibles (4 cases au plus, ou 3 et « + N »). Seuils de l'air à valider par Thomas. L'encart de l'Accueil les compte toutes.
- Place mesurée sur capture du pire cas : 7 lignes de rendez-vous (la ligne « Journée » comprise) et 3 rappels sans alertes, 4 et 2 avec ; au-delà, « + N autres ». L'encart de l'Accueil compte tout ce qui reste, pas seulement ce que la page montre. Calculée dans la page (`web/src/ecrans/aujourdhui-donnees.js`), sans appel nouveau.
- **Entrée Tempo** (relecture du 14/10 au soir) : bouton doux de 96 px en haut à droite (pastille du jour Tempo en cours et « Tempo »), en position absolue de 24 à 120 px du haut, hors de la grille (l'en-tête garde ses 79 px) ; il ouvre la fiche Tempo toute l'année (hors période, l'Accueil n'en montre rien).

**Météo** (allégée le 14/10 : « ok mais trop verbeux » ; un détail n'apparaît que s'il sert)
- En tête, le temps qu'il fait, lu de loin : pictogramme (80 px), température en 96 px (le plus gros chiffre de l'écran), ciel en 40 px ; le vent (icône et vitesse) seulement à partir de 40 km/h, le début de la force 6 de Beaufort (39 à 49 km/h, échelle citée de mémoire [S]).
- Bandeau sur 48 h : heure, pictogramme, température ; la pluie (goutte et quantité) seulement sur les heures où met.no en prévoit, et sa rangée seulement si une des 48 heures en a. Plus de probabilité de pluie ni de légende (« pluie en mm » est l'étiquette lue de la goutte : « 1,3 mm » ne tient pas dans une colonne de 84 px en 26 px).
- Encart « pluie dans l'heure » : « Pas de pluie » quand l'heure est sèche ; sinon 4 barres de 15 min avec leur heure et le total (plus de valeur par barre).
- Liste sur 7 jours : jour, pictogramme (le libellé du ciel n'est plus écrit), maxi, mini ; la pluie seulement au-delà de 0,5 mm, le vent seulement à partir de 40 km/h, chacun dans sa colonne (goutte ou icône du vent, valeur). Plus de probabilité.
- Panneau air et pollens : le niveau de l'indice européen actuel en mot (40 px) avec sa pastille, et « indice 29 » dessous en 26 px (en 72 px et sans mot, l'indice se lisait comme une température) ; « Demain » seulement si le maximum de demain est d'un niveau pire que celui d'aujourd'hui ; les pollens du jour seulement s'ils sont présents (niveau faible ou plus, du plus fort au plus faible), sinon une ligne « Pas de pollen » (« Pollens : pas de donnée » sans valeur). Plus de tableau des 6 taxons sur 3 jours, plus de note sur l'unité et les seuils (les seuils restent marqués [S] dans `web/src/air.js` et au §4).
- Crédits sur une ligne, en petit (22 px) : « Sources : met.no · Open-Meteo.com (CC BY 4.0) · CAMS/Copernicus ». L'attribution lue dans `weather.forecast_maison` (« Weather forecast from met.no, delivered by the Norwegian Meteorological Institute. ») [V L] devient « met.no » quand elle cite met.no, et reste telle quelle sinon (autre fournisseur dans HA) ; « Open-Meteo.com (CC BY 4.0), CAMS/Copernicus » [V R4].
- Unités lues dans les attributs et dans les unités d'Open-Meteo, jamais codées en dur ; les seuils (km/h, mm) sont comparés après conversion depuis l'unité reçue. La visibilité est en mi [V R2] et n'est pas affichée.
- La probabilité de pluie n'est plus demandée au serveur (`precipitation_probability_max` d'Open-Meteo retiré de la requête des 7 jours, `precipitation_probability` de met.no plus projetée) : la page ne l'affiche plus.

**Repas**
- Les 9 repas, du samedi midi au vendredi soir. Les midis de semaine sont déduits de `gamelles.pour`.
- Étiquettes : plaisir, poisson, frigo seul, sans viande.
- « Recette à venir » tant que `recette` vaut null.
- Aucune action de modification (échanger, pas fait, reporté) : elles ne sont pas cochées (Q18).

**Recette pas à pas** (sous-écran, menu masqué, pas de retour automatique à l'Accueil tant qu'il est ouvert)
- À gauche, les ingrédients, cochables localement.
- À droite, l'étape en 40 px et plus, avec « Étape 3/7 » et de très gros boutons Précédent et Suivant.
- Un bouton « Lancer Saucisson 35 min » si l'étape porte un `minuteur`, un badge four si elle porte `four`.
- Les astuces en fin de recette.

**Minuteurs** (tiroir ouvert depuis le gros bouton, une étape de recette ou la pastille)
- Plusieurs minuteurs nommés, réglés avec +1 et +5 min.
- Fin stockée dans localStorage, en heure corrigée par le serveur.
- Sonnerie et alerte plein écran jusqu'au toucher. Juste avant de sonner, la page remonte le volume média à la valeur réglée (80 % par défaut) par le pont.
- Pastille visible sur tous les écrans, Photos et Nuit compris.

**Courses**
- La liste `todo.shopping_list` : articles à faire d'abord, cochés grisés.
- Saisie avec le clavier Android si le test du 13/10 est bon. Sinon, un clavier HTML est ajouté.
- Pas de suggestions de produits habituels (l'ajout rapide n'est pas coché, Q19).
- Bouton **« Prêt pour le drive »** (et non « Envoyer », Q22) : il pose un drapeau que /courses lit.

**Maison** (13/10 : six onglets ; détail dans le README, « Maison »)
- **Alarme, en lecture seule** (décision du 13/10) : l'état en grand (Désarmée, Maison, Nuit, Absent, Déclenchée), depuis quand, le résumé « Tout est fermé » ou « 2 ouvertures », puis les 9 ouvertures (ouvertes en tête, Ouverte / Fermée lisible à 2 m avec icône, depuis quand, pile faible). Aucun armement, aucun clavier. Le gros bouton Alarme de l'Accueil ouvre cette vue et dit « tout fermé » ou le nombre d'ouvertures.
- **Télécommande**, un onglet Apple TV et un onglet Télé : pavé directionnel, OK, retour, « Menu TV », lecture/pause, volume (allumer et veille pour l'Apple TV, muet pour la télé), applis de vidéo de l'Apple TV (liste écrite, présentes dans `source_list`) ; Veille et applis à l'appui long d'une seconde (13/10 soir).
- **Sonnette** : dernière photo et de quand elle date (du dernier coup, d'avant, inconnue), dernier coup de sonnette vu par le serveur ; « Voir le direct » (vidéo go2rtc, 3 min) seulement si un flux est configuré (13/10 soir : plus de photo rafraîchie).
- **Wi-Fi invités** : QR code, nom et mot de passe (chasse fixe, chiffres d'une autre couleur), affichés après un toucher, puis masqués au bout de 2 min ; « pas encore prêt, à préparer sur le serveur » tant que le fichier secret n'existe pas.
- **Entretien** : 14/10, en haut, trois cartes **Draps** (demande d'Agathe) : « Lit de Timo », « Lit de Pablo », « Notre chambre » (523 x 329 px) : « changés il y a 3 jours », jauge du cycle de 15 jours, « prochain dans 12 jours » (en couleur d'alerte dès 2 jours avant, « à changer » le jour J et en retard), gros bouton « Changés aujourd'hui » (96 px ; un toucher montre tout de suite le changement et « Annuler » pendant 5 s, la demande ne part qu'ensuite ; appui long d'une seconde : « Hier » et « Avant-hier ») ; en bas, encre noire et couleur, piles faibles nommées avec leur appareil (5 lignes au plus, puis « + N autres »). Pas de mode parent : tout le monde peut cocher. Pas de bandeau « Mode essai » sur cet onglet.
- Non retenus : qui est là (Q13), alerte portes et fenêtres (Q14).

**Photos** (mode ambiant, piste 5 ; 13/10 : écrit en développement, détail dans le README, « Photos »)
- Une photo Immich plein écran, fondu de 1,5 s toutes les 30 s ; image entière (bandes Ardoise hors 16:9), jamais rognée.
- Les portraits (environ 60 % [V R3]) par paires côte à côte (Q9 tranchée) ; un portrait sans autre portrait dans le lot, seul sur fond Ardoise.
- Après 3 min sans toucher (14/10 : seule entrée, plus d'entrée au menu, §1.4) ; jamais pendant une recette, une alerte de minuteur, le bandeau sonnette, la nuit, un direct, un Wi-Fi affiché, hors ligne ni sans photos (sans clé Immich, lot vide ou Immich injoignable : l'Accueil reste) ; menu masqué. La face « page » qui expliquait l'absence de photos ne servait qu'à l'entrée du menu : retirée le 14/10.
- Pastilles :
  - horloge et date en bas à gauche ;
  - météo en haut à droite ;
  - « Ce soir » et minuteur en cours en bas à droite ;
  - légende (ville et date de prise de vue, via `withExif`, qui se combine avec `filter` [V L, `search.dto.ts` et spec 3.2.0]).
- Un toucher ramène à l'Accueil.

**Agenda** (Q10 tranchée ; 13/10 : un seul agenda qui mélange les rendez-vous de toute la famille, une couleur par personne ; 14/10 : la semaine en grille, décision de Thomas, au lieu de la liste de 7 à 14 jours ; plage, rangée journée et chevauchements revus après relecture le 14/10)
- **Grille de la semaine** (menu visible, 1 616 x 1 016 px utiles) : en-tête de 96 px (la semaine montrée en 40 px, « Cette semaine · du 12 au 18 octobre » ; la légende des personnes et l'alerte d'un calendrier absent ou en échec dessous ; à droite, trois boutons de 96 px : semaine précédente, « Cette semaine », semaine suivante), puis une carte de 900 px : en-têtes « Lun 12 » des 7 colonnes de 217 px (aujourd'hui : numéro dans un rond, colonne surlignée), puis 828 px pour la rangée « journée entière » et les heures. La rangée journée ne prend que ses lignes de barres : rien sans barre, 50 px pour une ligne, 96 pour deux (« +N » au-delà ; un rendez-vous à l'heure de 24 h ou plus y va aussi) ; les heures ont le reste (828, 778 ou 732 px).
- **Heures** : de 7 h à 19 h, élargies à l'heure pleine si un rendez-vous de la semaine commence avant ou finit après, mais jamais avant 6 h ni après 23 h : ce qui en sort (retour de soirée « fin 01:00 », train de 5 h) est collé au bord de la grille, coins carrés, avec sa vraie heure, et la nuit vide ne tasse plus toute la semaine. La grille tient toujours dans l'écran, sans défilement, seule l'échelle change. Lignes des heures en filet discret, graduation « 7 h » en 26 px, ligne rouge de l'heure actuelle (avec son point) dans la colonne d'aujourd'hui.
- **Blocs** : un par rendez-vous et par jour couvert (coupé à minuit, « fin 00:30 » le lendemain), placé à l'heure de l'horloge de Paris (le 25/10, un rendez-vous de 01:30 à 03:30 couvre deux heures de grille), haut comme sa durée, 30 px au moins (une ligne de texte de 26 px sur 27). Fond de la couleur de la personne ; au fil du texte l'initiale (rond aux couleurs inversées, 20 px), l'heure puis le titre en gras (« 13:00 Rendez-vous kiné », comme « La semaine »), sur les lignes qui tiennent : de 7 h à 19 h, une heure en a deux, même avec deux lignes de barres ; une seule ligne : ellipse, l'heure reste visible. **Chevauchements** sur les vraies heures : deux rendez-vous qui se suivent restent l'un sous l'autre en pleine largeur (le premier raccourci au besoin, « serré » s'il ne tient plus une ligne entière) ; seul un rendez-vous de moins de 30 min compte pour 30. Ceux qui se recouvrent passent côte à côte, deux colonnes au plus (initiale et heure serrées pour tenir dans 107 px) ; au-delà, un bloc « +N » à droite, cerné, avec les pastilles des personnes, ouvre la fiche en liste.
- **Toucher** : un bloc, une barre ou « +N » ouvre une fiche (titre complet en 44 px, horaire en toutes lettres, lieu, personne ; trois entrées puis « + N autres ») qu'un toucher n'importe où referme. Un bloc est souvent plus petit que les 96 px demandés au §1.2 : le plus proche à 40 px au plus compte aussi (un bloc isolé se touche sur 110 px au moins). Les boutons de semaine ont, eux, leurs 96 px.
- **Navigation** : les semaines lues par le serveur seulement (la précédente, la semaine en cours, les deux suivantes) ; rouvrir l'écran (menu, retour à l'Accueil après 60 s) ramène à la semaine en cours.
- Sources : calendriers iCloud (intégration CalDAV) et Google de HA, lus par `calendar.get_events` sur quatre semaines, du lundi de la semaine précédente au lundi qui suit la deuxième semaine suivante (minuit de Paris, un appel par calendrier et par lecture), liste blanche `AGENDA_CALENDRIERS` au format `calendar.domicile=Thomas` (chaque calendrier associé à sa personne), doublons d'une même personne retirés. L'iCloud de Thomas est relié depuis le 13/10 (`calendar.domicile`, `calendar.travail`) [V L] ; celui de sa femme viendra ensuite. « Aucun agenda relié » tant que rien n'est configuré.
- Repris dans « La semaine » (une ligne sous le repas, le premier rendez-vous de chaque personne toujours visible, inchangé le 14/10) et dans la carte Rendez-vous de la page Aujourd'hui (le brief du matin, qui les reprenait aussi, est retiré le 14/10) ; les deux écartent les rendez-vous finis. Détail dans le README, « Agenda ».

**Voitures** (choix de Thomas du 14/10 : une Renault Mégane électrique, entrée « Voitures » au menu ; retour à l'Accueil après 60 s ; commandes ajoutées le 14/10 après-midi, voir le dernier point)
- Une carte blanche par voiture (deux au plus) : en tête, la voiture dessinée et le nom de `VOITURES` (48 px ; jamais le `friendly_name`, qui porte la plaque) ; à droite, l'icône (72 px) et le mot de l'état : prise barrée « Débranchée », prise « Branchée », éclair « En charge » avec « prête vers 6 h 40 » (fin connue et pas passée), lune « Charge programmée », triangle « Erreur de charge » ; rien de connu, « État inconnu » sans icône. Ordre : erreur, en charge, programmée, puis la prise.
- Au milieu, le pourcentage en Fraunces de 240 px (signe % en demi-taille, opsz 40), l'autonomie en 96 px ; en bas, une jauge en forme de batterie de 160 px (contour et téton au trait du texte, remplissage --accent, --alerte à 25 % ou moins). Deux voitures : deux cartes de 471 px l'une sous l'autre, pourcentage en 150 px, jauge de 88 px (mesuré).
- Donnée de plus de 6 h (dernière activité de la batterie) : toute la carte en --texte-2 et « vu il y a 9 h » à la place du détail (en jours au-delà de 48 h). Sans ce capteur, jamais grisée. Débranchée à 25 % ou moins : icône et mot en couleur d'alerte.
- Sans `VOITURES` : « Voiture pas encore reliée » (56 px) sous la voiture dessinée ; la marche à suivre pour Thomas est dans le README, jamais à l'écran.
- Alerte du soir (pas sur l'Accueil) : voir « Aujourd'hui ».
- **Commandes** (décision de Thomas du 14/10 après-midi : toutes, d'un simple appui, sans protection contre les enfants), seulement celles que le flux donne : sous la carte, 4 boutons à pictogramme de 128 px (Charger, Clim, Phares, Klaxon) et 2 réglages « − 45 % + » (Charge mini, Charge cible, boutons de 96 px), une ligne de retour ; deux voitures : à droite de chaque carte, colonne réservée sur les deux blocs dès qu'une voiture en a (même largeur de carte). « Mode essai : rien n'est envoyé » en tête tant que `ACTIONS_VOITURE` ne vaut pas `1`. Actions et garde-fous : §2.4.

**Enfants** (choix de Thomas du 14/10, partie 4 : variante B « les quêtes » pour Timo, pictogrammes dessinés ; détail dans le README, « Tableau des enfants »)
- **Entrée** (menu visible) : deux cartes de 600 x 780 px, visage dessiné (renard de Timo, ourson de Pablo, au trait sur sa couleur) de 380 px et prénom en 80 px ; étoile dorée sur un visage dont la routine du matin est finie. Le matin, la case des deux visages de l'Accueil y mène directement (voir « Accueil »).
- **Mode enfant** (menu masqué, toute la scène) : en-tête de 96 px (maison, titre ou bandeau du mode parent, onglets « Quête » et « Points » de Timo, les deux visages pour passer de l'un à l'autre), corps de 1 856 x 888 px, « +1 » libre de Timo dans l'en-tête (14/10 en fin d'après-midi) ; appui long de 3 s sur un visage pour le mode parent (14/10 au soir) ; l'étoile « fini » des visages du haut seulement sur l'enfant affiché ; retour à l'Accueil après 90 s sans toucher.
- **Quête de Timo** : carte du chemin (1 304 px) et bourse (520 px). Chemin en pointillés sur deux rangées, cases de 200 px (pictogramme de 108 px, pièce « +5 » en Fraunces, cadenas des étapes parent, libellé en 30 px), avatar sur la première case à faire (devant le coffre quand il n'a plus rien à faire), coffre au bout ; cases pas faites en gris à partir de 10 h 30 ; barre sauge de 6 h 30 à 8 h 10 en haut de la carte ; appui long d'une seconde (anneau d'or), Annuler 5 s en haut à droite.
- **Bourse** : minutes qui restent en 220 px sous une bourse dessinée ; « Je regarde » (appui long) : disque de 400 px façon Time Timer (or, gris en pause), minutes restantes en 150 px, Pause, Fini ; « Fin de la vidéo, puis on éteint » ; « À demain » après 20 h.
- **Points** : total en 200 px avec l'étoile d'or, 5 derniers gains ; trois cartes de cadeau (dessin de 120, 170 puis 220 px, prix, jauge, « encore 23 » ou « Je veux ça », « En attente d'un parent »).
- **Pablo** : trois cartes de 380 x 560 (pictogrammes de 280 px), flèche, case « Ensuite » (pointillés, pleine de sa couleur une fois tout fait), bocal de 300 px avec ses étoiles ; aucun texte.
- **Mode parent** (60 s, après le geste parent : appui long de 3 s sur le visage d'un enfant, depuis le 14/10 au soir) : bandeau à la place du titre (temps restant, Fermer) ; étapes de l'enfant (Valider, Refuser, Cocher, Décocher, boutons de 96 px), points de Timo (solde et son « −1 », quatre « +1 » de 120 px), demande d'échange, 7 jours en pastilles.
- Rien de punitif : ni croix, ni rouge ; jamais les deux tableaux côte à côte.

### 1.6 Couches communes
- **Bandeau sonnette** (piste 5) : en haut au centre, verre « teinte » (`rgba(255,255,255,.95)` le jour, Ardoise le soir, sans flou). Il affiche « On a sonné · 19:41 », la photo de ce coup seulement (« Photo en cours… » d'ici là) et « Voir le direct » s'il y a un flux vidéo (Q12), réveille l'écran (luminosité au jour, sortie du mode nuit le temps du bandeau) et se masque après 2 min ou au toucher, toucher qui ne déclenche rien dessous. Couche commune : par-dessus tous les écrans, recette et Photos compris.
- **Pastille des minuteurs.**
- **Pastille du minuteur d'écran de Timo** (partie 4) : son visage et les minutes qui restent, pendue au haut du menu (sur « La cuisine », 224 x 95 px), sur tous les écrans qui ont le menu ; elle ouvre sa quête. Pas de mode Photos tant qu'elle est là.
- **Fin de la vidéo** (partie 4) : à la fin du minuteur d'écran, un son doux et, par-dessus tout (sous l'alerte des minuteurs de cuisine), une carte « Fin de la vidéo, puis on éteint » avec son visage et une télé, 2 min au plus ou jusqu'au premier toucher.
- **Liseré Tempo** (14/10) : un jour rouge, de 6 h à 22 h, un filet rouge de 8 px en haut de toute la scène (menu compris, par-dessus tous les écrans, sous les bandeaux et les alertes), qui ne capte pas le toucher ; jamais la nuit.
- **Bandeau « hors ligne »** quand le flux du serveur est muet depuis plus de 45 s. Jamais sur l'horloge, seule information encore fiable hors ligne : il prend la place des boutons Alarme, Wi-Fi invités et Télé, qui ne peuvent rien sans le serveur (le Minuteur, local, reste visible).

**Le verre dépoli.** Mesure du 13/10 (docs/cadre-ave948.md) : 16 FPS sous 3 pastilles floutées, donc **teinte seulement**, sans réglage `verre` ni code de flou. Le fond à 55 % prévu ci-dessous ne tient pas 4,5:1 sur une photo claire : 95 % pour le bandeau sonnette, 78 % pour les pastilles du mode Photos (textes contrôlés au pire cas par tests/contraste.test.js). Prévu avant la mesure :
- `teinte` (par défaut) : fond `rgba(20,28,26,.55)`, bordure 1px `rgba(255,255,255,.2)`, sans flou. Le coût est quasi nul.
- `flou` : `backdrop-filter: blur(14px)` sous `@supports`. On ne le retient que si `compat.html` mesure au moins 30 FPS **pendant un fondu de 2 s sous 3 pastilles floutées**, puisque le fondu est justement un fond animé qui force le recalcul du flou [V R1].
- Si c'est limite : on retire le flou pendant le fondu (classe `.en-fondu`), ou on passe au « faux verre » de R1 (miniature de la photo étirée en fond de pastille).

---

## 2. Architecture

### 2.1 Composants
```
Cadre (Android, appli kiosque fr.arronis.cuisine : WebView + pont "Kiosk",
       page de secours embarquée : horloge + minuteurs locaux)
   │  HTTP, réseau local seulement, cookie d'appareil réinjecté au démarrage
   ▼
M900 : conteneur cadre-bff :8020 (Node 22.23.3 + Fastify 5.12)
   ├─ WebSocket local ─► Home Assistant :8123 (jeton de "Mur", liste blanche)
   ├─ HTTP local ──────► Immich :2283 (clé asset.read + asset.view)
   ├─ HTTPS ───────────► Open-Meteo (air, pollens, pluie au pas de 15 min, semaine sur 7 jours, sans clé)
   ├─ HTTPS ───────────► RTE, repli api-couleur-tempo.fr (EDF Tempo, JSON public, sans compte, 14/10)
   ├─ (plus tard) ─────► API Freebox OS, TomTom ou Waze
   └─ fichiers : data/menus (lecture seule), data/etat (drive.json, draps.json, tempo.json, enfants/),
                 config/enfants.json dans l'image (barème des enfants, partie 3)
        ▲
Clevo : Claude Code /menu et /courses
   ├─ rsync, clé SSH bridée par rrsync ─► ~/cadre/data/menus
   └─ outils/cadre.mjs, en-tête X-Cadre-Cle ─► /api/courses, /api/etat, /api/action/courses_cocher
```
**Pourquoi un serveur intermédiaire (BFF)** [V R2] :
- le jeton reste hors du cadre, et seules les actions de la liste blanche passent ;
- il faut de toute façon un serveur pour la clé Immich, le cache Open-Meteo et les menus ;
- la page n'a besoin que d'EventSource et de fetch, ce qui marche même sur une vieille WebView ;
- une seule connexion va vers HA, sans Wi-Fi entre les deux.

Contrepartie : c'est un point unique de panne. Parades : redémarrage automatique, healthcheck, bandeau hors ligne, et une **page de secours dans l'APK** affichée par `onReceivedError`, avec horloge et minuteurs locaux. Un Service Worker est impossible sur `http://192.168.1.187`, qui n'est pas un contexte sécurisé.

### 2.2 Flux de données (uniquement des API documentées)

| Donnée | Chemin | Rafraîchissement |
|---|---|---|
| États HA | `subscribeEntities` de home-assistant-js-websocket (API publique de la bibliothèque officielle, voir §8), filtrés et projetés, puis flux SSE | push |
| Prévisions heure par heure (48 h) | `weather.get_forecasts` (`type` hourly) avec `return_response` | toutes les 30 min |
| Semaine (7 jours) | `https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&hourly=weather_code&timezone=Europe/Paris&forecast_days=7` (réponse du 11/10 à 16h39 enregistrée [V L, `tests/fixtures/open-meteo-semaine.json`]). Le `weather_code` quotidien n'est pas demandé : c'est le code le plus sévère des 24 heures, et une heure de brouillard au lever suffisait à afficher « Brouillard » (6 jours sur 7 le 11/10). Le serveur tire le ciel de la journée des codes horaires : le plus sévère qui couvre au moins 3 heures entre 8h et 20h (seulement les heures restantes pour aujourd'hui) [S, règle à juger à l'usage] | toutes les heures |
| Courses | `todo.get_items` avec `status: ["needs_action","completed"]` toujours passé, sur changement d'état de `todo.shopping_list` et toutes les 60 s (un renommage ne change pas l'état [S]) | quasi push |
| Air et pollens | `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=48.8566&longitude=2.3522&current=european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&hourly=european_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=Europe/Paris&forecast_days=4` [V R4] | toutes les heures |
| Pluie dans l'heure | `https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&minutely_15=precipitation&models=meteofrance_seamless&forecast_minutely_15=8&timezone=Europe/Paris` (HTTP 200 sans clé [V rel.], réponse de 8 pas enregistrée [V L, `revue/om_min15.json`]) | toutes les 15 min |
| Menu | fichier JSON déposé par rsync, relu et validé par le BFF, événement `menu` dans le flux | à la publication |
| Photos | `POST /api/search/random` d'Immich (lot de 100, format `filter` d'Immich 3.2), revérification de chaque photo avant envoi, preview servie telle quelle (13/10 : pas de redimensionnement) | lot demandé par la page toutes les 30 min |
| Heure | `heure_serveur` dans le flux | toutes les 20 s |
| EDF Tempo (14/10) | `https://www.services-rte.com/cms/open_data/v1/tempoLight` (aujourd'hui et demain) et `https://www.services-rte.com/cms/open_data/v1/tempo?season=2026-2027` (la saison d'après la date de demain, pour les jours restants), JSON public de RTE sans compte [V L, réponses du 14/10 enregistrées dans `tests/fixtures/tempo-*.json`] ; repli `https://www.api-couleur-tempo.fr/api/jourTempo/today`, `.../tomorrow`, `.../stats` seulement si RTE échoue (une réponse sans la couleur du jour compte comme un échec ; après 10 h 45, demain manquant chez RTE est lu chez le repli ; saison incomplète refusée) ; filet `data/etat/tempo.json` et règles fixes (`serveur/sources/tempo-calendrier.js`). User-Agent `cadre-cuisine/<version>`, 15 s, réponses plafonnées | 6 h 05, toutes les 30 min tant que demain est inconnu, 10 h 45, 11 h 15, 12 h 30 ; saison une fois par jour ; 15 min après un échec complet |
| Draps (14/10) | `data/etat/draps.json`, écrit par `POST /api/draps/:lit`, relu au démarrage et avant chaque écriture (abîmé : mis de côté, jamais écrasé) | push à chaque appui |
| Tableau des enfants (14/10, partie 3) | barème `config/enfants.json` (dans l'image, validé au démarrage) ; état dans `data/etat/enfants/journees/AAAA-MM-JJ.json` et `data/etat/enfants/registre.json`, écrit par les routes `/api/enfants/*`, relu au démarrage (abîmé : mis de côté, jamais écrasé), valeur `enfants` du flux (`serveur/enfants/projection.js`) | push à chaque action, à la fin du minuteur d'écran, à `fin_routine` (9 h : routine close), à 20 h (minutes perdues) et à 4 h (nouvelle journée) |
| Voitures (14/10) | entités de `VOITURES` lues dans le même abonnement `subscribeEntities` (collection partagée, aucune requête de plus), projetées par `serveur/ha/voitures.js` sous le nom de la configuration ; HA relève les serveurs Renault de lui-même (quota de 60 requêtes par heure et par compte) | push |
| Empreinte de la page (14/10) | hachage des fichiers de `DOSSIER_WEB`, calculé au démarrage | à chaque instantané |

Open-Meteo : 24 + 96 + 24 = 144 appels par jour, très loin des 10 000 autorisés [V R4]. Tempo : une vingtaine de lectures de RTE par jour au plus (40 si demain n'arrive jamais), le repli seulement en cas d'échec. Les données externes poussées dans le flux évitent d'avoir des routes GET en plus.

### 2.3 API du BFF
La page statique (`web/dist`) est servie sans authentification : elle ne contient aucun secret. Tout ce qui est sous `/api` exige le cookie `cadre_cle` ou l'en-tête `X-Cadre-Cle`, sauf `/api/sante`. Un 401 affiche « Cadre non appairé ».

| Route | Étape | Rôle |
|---|---|---|
| `GET /api/flux` | M1 | SSE : `instantane` (états projetés, prévisions, air, pluie, courses, version du menu, heure serveur ; 14/10 : `empreinte` du contenu servi, `draps`, `tempo` ; partie 2 : `voitures`), puis `maj`, `sonnette`, `menu`, et `ping` toutes les 20 s avec `retry: 3000`. Le client recrée l'EventSource après 45 s de silence ; une reconnexion qui annonce une autre empreinte fait recharger la page (14/10). |
| `GET /api/sante` | M1 | `{ha: "ok"/"ko", version, empreinte}` pour le healthcheck (empreinte depuis le 14/10 : celle que la page reçoit). Le champ `immich` prévu n'est pas écrit (13/10). |
| `GET /api/menu` | M3 | Menu dont le cycle couvre aujourd'hui (dernière version valide). |
| `GET /api/courses` | M3 | Liste pour cadre.mjs. |
| `POST /api/action/:nom` | M3, M5 | Action de la liste blanche (§2.4), corps validé par schéma. |
| `POST /api/drive-pret` | M3 | Écrit `data/etat/drive.json` (`{pret_le}`). |
| `POST /api/draps/:lit` | 14/10 | `lit` dans une liste fermée (`timo`, `pablo`, `parents`), corps `{quand: "aujourdhui" \| "hier" \| "avant-hier"}` : le serveur calcule la date à l'heure de Paris (jamais une date fournie) et écrit `data/etat/draps.json` (écriture atomique, schéma ajv, 16 Ko au plus) ; `200 {lit, change_le}`, 404 `lit_inconnu`, 400 `corps_invalide`, 10 par minute. Rien dans HA. |
| `POST /api/enfants/parent` | partie 3 | Jeton du mode parent, `{jeton, expire_le}` (60 s, un seul à la fois), 10 par minute ; à renvoyer en `X-Cadre-Parent` (masqué dans le journal). |
| `POST /api/enfants/:enfant/etapes/:etape` (`/annuler`, `/decision`) | partie 3 | Cocher (validée tout de suite en mode parent, « en attente » pour une étape parent cochée par l'enfant), annuler dans les 5 s (sans délai en mode parent : correction, partie 4), valider ou refuser une étape en attente (mode parent). Le serveur prend son heure (Paris), la valeur vient du barème. |
| `POST /api/enfants/:enfant/points`, `/echanges`, `/echanges/:demande/decision` | partie 3 | +1 point (mode parent, motif facultatif de la liste), demande d'échange (refusée sans assez de points), validation ou refus (mode parent). Jamais de retrait de points hors échange. |
| `POST /api/enfants/:enfant/minuteur` | partie 3 | `{action: demarrer \| pause \| finir}` ; borné aux minutes gagnées non utilisées et à 20 h. |
| `GET /api/enfants/historique` | partie 3 | 7 journées par enfant (faites, gagnées, utilisées, points), mode parent. Toutes ces routes : clé exigée, 60 par minute, corps de 256 octets, refus en `{erreur}` (README). |
| `GET /api/etat` | M3 | `{drive_pret_le, demandes[]}` pour cadre.mjs (clé Clevo seulement). |
| `GET /api/photos/lot` | M4 | `[{id, portrait, legende}]` ; 404 `photos_non_configurees` sans clé, 502 si Immich ne répond pas. |
| `GET /api/photos/:id.jpg` | M4 | Revérifie `GET /api/assets/{id}` : `isTrashed` vrai (et, 13/10 : archive, dossier verrouillé, plus favorite, supprimée) donne 410 (champ présent dans `AssetResponseDto` [V L, spec 3.2.0]). Ensuite `GET /api/assets/{id}/thumbnail?size=preview&edited=true` relayée telle quelle en flux (13/10 : sans sharp), `Cache-Control: no-store` ; uuid contrôlé (400). |
| `GET /api/sonnette.jpg` | M5 | Proxy de `/api/camera_proxy/camera.sonnette_derniere_photo?width=960&height=540`, en `no-store` ; chaque photo lue nourrit le suivi des coups de sonnette (`sonnette` du flux : de quand date la photo). |
| `GET /api/sonnette.mjpeg` | M5 | Relais en lecture de `/api/stream.mjpeg?src=<flux>` de go2rtc (API joignable sur le M900, constat du 13/10), si `GO2RTC_FLUX_SONNETTE` est donné ; 3 min 30 s au plus, 2 directs à la fois. Vide tant que le risque du §2.5 n'est pas tranché. |
| `GET /api/wifi-invites` | M5 | `{configure, ssid, mot_de_passe, chaine_qr}`, où la chaîne `WIFI:T:WPA;S:..;P:..;;` est échappée côté serveur ; `{configure: false}` sans fichier. |
| `GET /api/brief` | M6 | Abandonnée : le brief en phrases est refusé le 14/10 ; la page Aujourd'hui qui le remplace est calculée dans la page (`web/src/ecrans/aujourdhui-donnees.js`) avec ce que le flux apporte déjà. |
| `POST /api/demande` | M6, si Q17 | Ajoute une ligne à `data/etat/demandes.jsonl`. |

Quelques précisions :
- `cadre.mjs etat` passe par HTTP. La clé SSH bridée reste limitée à l'écriture des menus, et /menu lit le drapeau et les demandes sans accès SSH en plus.
- Il n'y a plus de cache disque des photos : chaque photo est demandée une fois par lot et relayée sans copie. Donc rien à purger, et une photo retirée n'a pas de copie qui traîne sur le M900. (13/10 : plus de redimensionnement, la preview de 1440 px d'Immich est envoyée telle quelle ; pas de sharp, donc pas de paquet natif à ajouter.)

### 2.4 Liste blanche des actions (entités figées dans `serveur/ha/actions.js`)

| Nom | Appel HA | Garde-fous |
|---|---|---|
| `courses_ajouter {texte ≤ 60}` | `todo.add_item` sur `todo.shopping_list` | |
| `courses_cocher {uid, fait}` | `todo.update_item {item: uid, status}` | toujours par uid [V R2] |
| `courses_supprimer {uid}`, `courses_vider_coches` | `todo.remove_item`, `todo.remove_completed_items` | |
| `appletv_touche {touche}` | `remote.send_command` sur `remote.sejour_sejour` : up, down, left, right, select, menu, home, play_pause, volume_up, volume_down, wakeup, suspend (13/10 : réduite aux touches affichées, play_pause pour un seul bouton) | hors limite globale, 10 par seconde au plus |
| `appletv_appli {source}` | `media_player.select_source` sur `media_player.sejour_sejour`, source prise dans `source_list` | |
| `tv_touche {touche}` | `remote.send_command` sur `remote.smart_tv_pro_2` : DPAD_UP/DOWN/LEFT/RIGHT, DPAD_CENTER, BACK, HOME, VOLUME_UP/DOWN, MUTE, MEDIA_PLAY_PAUSE (POWER selon le test du Screenless service) | hors limite globale, 10 par seconde au plus |
| `sonnette_direct` | `script.turn_on` sur `script.sonnette_direct` (Q12) | seul script permis ; « Bonne nuit », « Je pars » non retenus (Q11) |
| `voiture_commande {voiture, commande}` (14/10, `serveur/ha/actions-voiture.js`) | `button.press` sur l'entité du rôle `charger`, `clim`, `phares` ou `klaxon` de `VOITURES`, figée au démarrage (le corps ne donne qu'un nom de voiture et un rôle) | `ACTIONS_VOITURE` ; même commande toutes les 30 s, 10 commandes par heure glissante toutes voitures confondues (quota Renault), `429 trop_tot` |
| `voiture_niveau {voiture, reglage, valeur}` (14/10) | `number.set_value {value}` sur l'entité du rôle `charge_min` ou `charge_cible`, valeur contrôlée contre `min`, `max` et `step` actuels (400 sinon) | `ACTIONS_VOITURE` ; même réglage toutes les 10 s, et le même budget horaire |

Les actions maison ont leur garde-fou, `ACTIONS_MAISON` (simulé par défaut, réel seulement à « 1 »), séparé de `ACTIONS_REELLES` (courses), revérifié par la connexion HA.

Les commandes de la voiture ont le leur, `ACTIONS_VOITURE` (14/10) : simulées par défaut (aucun appel à HA, « Mode essai » sur l'écran Voitures), réelles seulement à « 1 », sans croisement avec `ACTIONS_REELLES` ni `ACTIONS_MAISON` ; la connexion HA (`ecrireVoiture`) revérifie le drapeau et n'accepte que les couples service et entité tirés de `VOITURES`. Une fois le drapeau à « 1 », Klaxon, Phares, Clim, Charger et les deux niveaux de charge partent vraiment vers HA, d'un simple appui, sans protection contre les enfants (choix de Thomas). Aucun entity_id (plaque) dans les réponses ni les journaux.

**Interdits, chacun vérifié par un test :**
- `switch.freebox_*`, `button.freebox_*` ;
- tout le domaine `alarm_control_panel` (13/10 : ni armement ni désarmement depuis le cadre), `alarm_center` compris, et `select.alarm_center_guard_mode` ;
- `notify.*`, `shell_command.*`, les `script.*` hors liste ;
- `remote.turn_off` sur l'Apple TV, qui déconnecte l'intégration au lieu d'éteindre [V R2] ;
- `button.*` et `number.*` hors des entités de commande de `VOITURES` (aucune pour les courses et la maison), et avec un autre service que `button.press` ou `number.set_value` (`verifierActions`, message sans l'entité) ; `device_tracker` et `select` de la voiture, refusés dès la lecture de `VOITURES`.

### 2.5 Sécurité
- **Jeton HA** : jeton longue durée de « Mur » (non admin, local_only), créé en se connectant en tant que Mur. Fichier en 600, monté en lecture seule, hors git. On ne réutilise jamais `~/homeassistant/ha_token` (admin). Le réseau bridge Docker (172.16.0.0/12) est bien « local » pour `local_only` [V L, `revue/network.py`, tag 2026.9.1].
- **Liste blanche de lecture et projection** : on ne renvoie que les attributs utiles. Voitures (14/10) : seules les entités de `VOITURES`, chacune au domaine que son rôle impose (`sensor` et `binary_sensor` en lecture ; `button` pour les rôles `charger`, `clim`, `phares`, `klaxon` et `number` pour `charge_min`, `charge_cible`, les seules entités que les commandes peuvent écrire, sous `ACTIONS_VOITURE`, §2.4), projetées sans entity_id ni `friendly_name` (la plaque), jamais position ni kilométrage (`device_tracker` et `select` toujours refusés au démarrage, comme les entity_id qui parlent de position ou de kilométrage). On retire latitude et longitude, `access_token`, `entity_picture` et les numéros de téléphone (`sensor.freebox_v9_r1_appels_manques` n'est pas exposé).
- **Clés d'appareil** : deux clés aléatoires de 32 octets, `secrets/cle_cadre` et `secrets/cle_clevo`, révocables séparément.
  - Le kiosque reçoit la sienne **une seule fois** : `adb shell am start -n fr.arronis.cuisine/.ReglageAdb --es cle "$(cat cle_cadre)"`. `.ReglageAdb` est un alias de MainActivity protégé par la permission DUMP, que seul le shell ADB détient : MainActivity est exportée (filtre HOME), et sans ce verrou n'importe quelle appli du cadre pourrait écraser la clé. Le kiosque la range dans ses SharedPreferences et la **réinjecte avant chaque chargement de la page principale** (démarrage, nouvel essai, perte du rendu ; `CookieManager.setCookie`, avec `Max-Age=34560000; HttpOnly; SameSite=Strict`, puis `flush()`). On ne dépend donc plus de la survie du cookie au redémarrage de la WebView. Chromium 104 et plus plafonne un cookie à 400 jours (34 560 000 s) : un cadre qui ne recharge sa page que par `location.reload` pendant plus de 400 jours perdrait le cookie, à couvrir en M2 (par exemple, renouvellement par le BFF).
  - cadre.mjs lit `~/.config/cadre/cle` (600) et l'envoie en `X-Cadre-Cle`.
  - Une liste d'IP s'ajoute dès que le bail fixe du cadre existe.
- **Limites** (@fastify/rate-limit) :
  - 300 requêtes par minute et par IP sur `/api` ;
  - télécommande hors limite globale, mais plafonnée à 10 par seconde (compteur de contexte, avant la clé) ;
  - pas de désarmement depuis le cadre (13/10).
- **Journaux** : le logger masque `code`, `x-cadre-cle` et `cookie` (14/10 : et `x-cadre-parent`, le jeton du mode parent).
- **Mode parent du tableau des enfants (partie 3)** : jeton de 60 s délivré par `POST /api/enfants/parent` à tout appareil qui porte une clé, sans autre preuve. C'est une barrière contre les doigts d'enfants, **pas une sécurité forte** : la vraie barrière reste la clé d'appareil, et rien de dangereux n'en dépend (ni la maison ni HA). Limites dédiées : 60 touchers par minute pour les routes des enfants, 10 jetons par minute, la limite avant le contrôle du jeton.
- **Réseau** : réseau local, en HTTP. Aucune redirection de port sur la Freebox. Pas de HTTPS : il manque les racines Let's Encrypt avant Android 7.1.1 [V R1].
- **Kiosque** :
  - navigation limitée à l'origine compilée dans l'APK (`shouldOverrideUrlLoading`) ;
  - filtre d'intent VIEW générique supprimé ;
  - aucune iframe ni contenu tiers ;
  - pont minimal : `setBrightness`, `setVolume`, `getVolume` ;
  - débogage distant seulement avec `--ez debug true`, passé par l'alias `.ReglageAdb` [V R1].
- **Cadre** : logiciel inconnu, et précédent AiMOR dans la mémoire (shell root distant). Je recommande de **lui couper Internet par défaut** dès que Frameo est désactivé (contrôle parental Freebox). L'heure est couverte par `heure_serveur`, et Open-Meteo passe par le BFF.
- **ADB** : en USB pendant le développement, pas de `tcpip 5555` permanent.
- **Clé Immich** côté serveur seulement, jamais en `?apiKey=` [V R3].
- **Vu en marge** : les photos de sonnette dans `/config/www` sont lisibles sans authentification sur le réseau local [V R2].
- **go2rtc ouvert sur le réseau local (13/10 soir, à trancher par Thomas)** : l'API (1984), le RTSP (8554) et le WebRTC (8555) du go2rtc de HA répondent sans authentification [V L, lecture de `/api/streams`] ; tout appareil du réseau peut regarder la sonnette en direct sans le BFF, et l'API permet aussi de modifier les flux d'après sa documentation. Pistes (écritures sur le M900) : limiter 1984 et 8554 à 127.0.0.1 et au pont Docker, ou activer l'authentification de go2rtc (le BFF enverra alors un en-tête Basic lu dans un secret). `GO2RTC_FLUX_SONNETTE` reste vide d'ici là.

### 2.6 Hébergement Docker sur le M900
**On construit sur le Clevo, pas sur le M900.**
- Le Dockerfile tient en une étape : `FROM node:22.23.3-alpine` (tag publié le 23/09/2026 [V L, Docker Hub]), `npm ci --omit=dev`, copie de `serveur/`, `partage/` et `web/dist/` (le `vite build` est fait sur le Clevo), `USER node`.
- Construction et test sur le Clevo. Docker n'y est pas installé [V L] : c'est un accord (§6.2).
- Envoi : `docker save cadre-bff:AAAA-MM-JJ | ssh thomas@192.168.1.187 docker load`.
- Retour arrière : remettre le tag précédent dans le compose.
- Ni dépôt nu ni `git pull` en prod. Si tu refuses Docker sur le Clevo, on construit sur le M900, avec ton accord à chaque fois.

```
~/cadre/
  docker-compose.yml
  secrets/      (700)  ha_token, immich_cle, cle_cadre, cle_clevo, wifi_invites.json (600)
  data/menus/          écrit par rsync, monté en lecture seule
  data/etat/           drive.json, draps.json, tempo.json (14/10), enfants/ (journees/, registre.json : partie 3),
                       demandes.jsonl (si Q17)
```
Le service `cadre-bff` :
- `image: cadre-bff:<tag>`, `restart: unless-stopped`, `ports: ["8020:8020"]` ;
- `extra_hosts: ["host.docker.internal:host-gateway"]`, avec les URL `http://host.docker.internal:8123`, `:2283` et, si Q22, `:2586`. HA serait en réseau host d'après la mémoire [S R2], à vérifier par `docker inspect` ;
- `read_only: true`, `tmpfs: /tmp`, `user: "1000:1000"` (uid à vérifier par `id` [S]) ;
- `mem_limit: 256m` (13/10 : sans sharp, une photo relayée en flux, 15 Mo au plus) ;
- healthcheck : `wget -qO- http://127.0.0.1:8020/api/sante`.

Le port 8020 semble libre [S R2] : à vérifier avec `ss -ltn`, lecture que tu lanceras.

### 2.7 Sauvegarde, récupération, maintenance
- **Sauvegarde** : ajouter `~/cadre/secrets`, `~/cadre/data` et `docker-compose.yml` à `/usr/local/bin/sauvegarde.sh` (restic). Tu poses la modification, car le classifieur bloque l'écriture en prod (même procédure que le 04/10).
- **`docs/recuperation.md`**, écrit en M0 et complété le 13/10 :
  - cadre déjà au mur avec un Wi-Fi changé : garder le port USB-C accessible, puis `adb shell am start -a android.settings.WIFI_SETTINGS` ;
  - retour arrière complet : `pm enable net.frameo.frame`, `cmd package set-home-activity <activité Frameo relevée le 13/10>`, `adb uninstall fr.arronis.cuisine` ;
  - sortie du kiosque : deux doigts immobiles pendant 1,5 s.
- **Maintenance** : après chaque mise à jour de HA (image `stable` flottante) ou d'Immich (tag `v3` flottant, la 3.3.1 est déjà sortie [V R3]), relancer `npm run verif-ha` et `npm run verif-immich`, deux scripts en lecture seule. Un rechargement automatique de la page à 4h, sauf si un minuteur tourne, limite les fuites mémoire de la WebView. 14/10 : après un déploiement, la page se recharge d'elle-même (empreinte du contenu servi dans l'instantané du flux), mais pas tant qu'un minuteur tourne ou sonne, qu'une recette est ouverte, que l'écran Enfants est ouvert ou que le bandeau sonnette est affiché, ni avant 60 s sans toucher.

---

## 3. Stack et arborescence

### 3.1 Stack

| Brique | Choix | Statut |
|---|---|---|
| Exécution | Node 22.23.3 LTS « Jod » (23/09/2026), image `node:22.23.3-alpine` | [V L] |
| Serveur | fastify 5.12.5, @fastify/static 10.1.6, @fastify/rate-limit 11.2.1, @fastify/cookie 11.1.3 | [V L, registre npm] |
| Client HA | home-assistant-js-websocket 9.7.1, WebSocket natif de Node 22 sans le paquet `ws`. Sous Node, `window`, `location` et `document` ne servent que dans les fonctions OAuth, pas avec `createLongLivedTokenAuth` [V rel.] | [V L] version, fonctionnement [S] |
| Images | aucune bibliothèque (13/10) : la preview d'Immich est relayée telle quelle ; plus de sharp | [V L] |
| Validation | ajv 8.20.0 importé depuis `ajv/dist/2020` + ajv-formats 3.0.1, hors du validateur interne de Fastify, partagés par le serveur et cadre.mjs | [V L] |
| Front | JS vanilla en modules, sans framework. Vite ^8.3 avec `build: { target: 'chromeNN', cssTarget: 'chrome61' }`. @vitejs/plugin-legacy seulement si NN < 64 | [V R1] |
| QR code | écrit dans la page (`web/src/qr.js`, 13/10) au lieu de qrcode-generator : mode octet, correction M, versions 1 à 10, vérifié contre OpenCV | [V L] |
| Kiosque | Java, compilé sans Gradle : aapt2, javac 8, d8, zipalign, apksigner. openjdk-17-jdk 17.0.20.1, adb 34.0.5 et `/lib/udev/rules.d/51-android.rules` sont déjà installés. Manquent build-tools 34.0.0 et platform android-34 (`~/Android/Sdk` absent) | [V L] |
| Tests | `node --test` (intégré) | |

Les versions sont figées par `package-lock.json`. @fastify/static et @fastify/rate-limit ont quelques jours : on garde le lockfile et on n'avance pas à l'aveugle.

Avant la mesure du 13/10, la cible provisoire est `chrome74` (pire cas plausible : Android 10).

Règles CSS (détail en R1) :
- pas de gap en flex (utiliser grid), pas d'`aspect-ratio`, d'`inset`, de `:is`, de `:has`, de `color-mix`, d'imbrication ni de `dvh` ;
- `rgba()` littéral et `transform` ;
- `display:none` plutôt que `content-visibility` si NN < 85.

### 3.2 Arborescence de `~/Projets/cadre-cuisine`
Seuls les fichiers des fonctions cochées et tranchées sont prévus. Ceux marqués « (si Qn) » ne s'écrivent qu'après ta réponse.
```
README.md                     démarrage, construction, déploiement, sécurité
.gitignore                    node_modules, web/dist, secrets/, *.keystore, *.apk, fixtures privées
.env.example                  variables sans valeurs
package.json, package-lock.json
Dockerfile                    une étape, web/dist construit sur le Clevo
deploiement/docker-compose.yml
docs/
  conception.md               ce document
  cadre-ave948.md             relevé du 13/10 (sortie de identifier-cadre.sh, décision GO ou RETOUR)
  recuperation.md             Wi-Fi perdu, retour arrière, sortie du kiosque
config/
  enfants.json                barème du tableau des enfants (partie 3, versionné, copié dans l'image, validé au démarrage)
partage/
  schema-menu-v1.json         schéma du menu (R5, draft 2020-12), lu par le serveur ET par cadre.mjs
  valider-menu.js             ajv 2020 + ajv-formats + règles hors schéma (9 créneaux, gamelles, durées)
serveur/
  index.js                    démarrage Fastify, plugins, routes
  config.js                   variables d'env, chemins des secrets, ACTIONS_REELLES (0 par défaut)
  garde-fous.js               câblage testé des deux garde-fous d'écriture (ACTIONS_REELLES, ACTIONS_MAISON)
  corps.js                    lecture d'une réponse sous plafond d'octets, abandonnée au dépassement
  empreinte.js                empreinte du contenu servi (DOSSIER_WEB), dans l'instantané et /api/sante (14/10)
  etat-local.js               fichiers de data/etat : écriture atomique, lecture plafonnée et validée, fichier abîmé mis de côté (14/10)
  heure-paris.js              date et heure de Paris côté serveur, partagées par les sources (14/10)
  securite.js                 clés d'appareil, cookie, liste d'IP, masquage dans les journaux, limites
  ha/connexion.js             connexion, ping toutes les 30 s, arrêt de la boucle sur ERR_INVALID_AUTH
  ha/entites.js               liste blanche de lecture et projection
  ha/actions.js               table nom -> {domain, service, entity_id, schéma} des courses
  ha/actions-maison.js        télécommandes et direct de la sonnette, garde-fou ACTIONS_MAISON (13/10)
  ha/photo-sonnette.js        dernière photo de la sonnette (REST camera_proxy, lecture seule)
  ha/sonnette.js              suivi des coups de sonnette : dernier coup vu, de quand date la photo (13/10 soir)
  ha/meteo.js                 weather.get_forecasts toutes les 30 min
  ha/courses.js               todo.get_items sur changement d'état + toutes les 60 s, opérations par uid
  sources/open-meteo.js       air et pollens (1 h), pluie au pas de 15 min (15 min), semaine sur 7 jours (1 h)
  sources/immich.js           lot aléatoire filtré, revérification, preview relayée telle quelle (M4)
  sources/immich-demo.js      faux Immich de démonstration (IMMICH_DEMO=1, développement seulement, hors image Docker)
  sources/menus.js            choix du fichier qui couvre aujourd'hui, dernière version valide (M3)
  sources/tempo.js            EDF Tempo : RTE, repli api-couleur-tempo.fr, filet tempo.json, rythme de lecture (14/10)
  sources/tempo-calendrier.js règles fixes Tempo : jour de 6 h à 6 h, saison, couleurs impossibles, pré-annonce (14/10)
  sources/draps.js            dates des draps, draps.json, date calculée à l'heure de Paris (14/10)
  sources/enfants.js          tableau des enfants : file unique des lectures et écritures, bascule de 4 h, flux (partie 3)
  enfants/bareme.js           lecture et validation de config/enfants.json (partie 3)
  enfants/journee.js          règles d'une journée : étapes, attente, annulation 5 s (sans délai pour un parent), minutes, minuteur d'écran
  enfants/registre.js         points et boutique : +1, demandes, échanges, purge douce
  enfants/stockage.js         fichiers de data/etat/enfants : schémas, plafonds, purge de 90 jours
  enfants/projection.js       valeur « enfants » du flux et historique de 7 jours
  enfants/mode-parent.js      jeton court du mode parent (barrière, pas sécurité)
  enfants/erreur.js           refus voulus des règles, traduits en 4xx
  sources/direct-sonnette.js  direct MJPEG relayé depuis go2rtc (si GO2RTC_FLUX_SONNETTE)
  sources/wifi-invites.js     fichier secret du Wi-Fi invités, chaîne du QR échappée
  routes/flux.js, sante.js, menu.js, courses.js, actions.js, etat.js, photos.js, wifi.js, sonnette.js, draps.js (14/10), enfants.js (partie 3)
web/
  index.html                  rechargement si le bundle n'a pas démarré en 10 s (idée de Wes)
  secours.html                2e entrée Vite : horloge + minuteurs, copiée dans kiosque/assets/
  vite.config.js
  compat/compat.html          diagnostic du 13/10, écrit à la main en ES5, sans build
  src/main.js                 assemblage, tick unique, rechargement à 4h
  src/routeur.js              routeur d'écrans (l'écran quitté libère images, direct, Wi-Fi), testé
  src/etat.js                 magasin d'état alimenté par le flux
  src/api.js                  EventSource, POST, chien de garde de 45 s, décalage d'horloge
  src/heure.js                Intl Europe/Paris + décalage serveur (partagé avec secours.html)
  src/kiosque.js              façade du pont Kiosk, repli silencieux sur le Clevo
  src/inactivite.js           retour à l'Accueil après 60 s, Photos après 3 min, nuit
  src/theme.js                jour, soir et nuit d'après sun.sun et l'heure, luminosité
  src/ecrans/accueil.js, aujourdhui.js (+ aujourdhui-donnees.js, 14/10), meteo.js, repas.js, recette.js, courses.js, agenda.js (+ agenda-donnees.js, agenda-grille.js), maison.js (+ maison-*.js, dont maison-draps.js et draps-donnees.js, 14/10), photos.js (+ photos-donnees.js), voitures.js (+ voitures-donnees.js, partie 2)
  src/ecrans/enfants.js       écran des enfants (partie 4) : entrée, mode enfant, mode parent ; enfants-quete.js, enfants-bourse.js, enfants-boutique.js, enfants-pablo.js, enfants-parent.js, enfants-effets.js, enfants-plus-un.js (« +1 » libre, 14/10 en fin d'après-midi) ; règles sans DOM : enfants-donnees.js, quete-donnees.js, boutique-donnees.js, pablo-donnees.js, parent-donnees.js
  src/sons-enfants.js         sons doux du tableau des enfants (WebAudio, contexte partagé avec la sonnerie)
  src/tempo.js                règles EDF Tempo sans DOM : jour Tempo, veille, heures creuses, liseré, fiche (14/10)
  src/rechargement.js         rechargement de 4h et après un déploiement (empreinte, 14/10)
  src/photos.js               règles du diaporama sans DOM (lot, paires, préchargement, échecs)
  src/composants/menu.js, minuteurs.js, bandeau-sonnette.js, photo-sonnette.js, pastille.js, appui.js, rendez-vous.js, carte.js (carte titrée de l'Accueil et de la page Aujourd'hui), tempo.js (pastille éclair et fiche Tempo, 14/10), avatar.js, anneau.js, pastille-ecran.js, fin-video.js (enfants, partie 4), geste-parent.js (appui long de 3 s sur un visage pour le mode parent, 14/10 au soir)
  src/qr.js, src/sonnette.js  QR sans bibliothèque (mode octet, M, v1 à 10) ; règles de la sonnette sans DOM
  src/composants/clavier.js   (seulement si le clavier Android échoue le 13/10)
  src/diag.js                 superposition ?diag (FPS, jank, délai entre toucher et clic), réécrite d'après Wes
  styles/jetons.css, base.css, menu.css, verre.css, tempo.css (14/10), avatar.css, anneau.css, pastille-ecran.css, fin-video.css (partie 4), ecrans/*.css
  public/polices/*.woff2, public/icones.svg, public/sonde.bin (4 Kio, sonde du chien Wi-Fi du kiosque : ne pas
                              renommer ni déplacer)
kiosque/
  AndroidManifest.xml         INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE et CHANGE_WIFI_STATE (chien Wi-Fi, 14/10),
                              catégorie HOME, targetSdk 23 (jamais 29 ou plus : setWifiEnabled refusé)
  build.sh                    ANDROID_HOME=$HOME/Android/Sdk, ORIGINE passée en argument
  assets/secours.html         copié depuis web/dist
  src/fr/arronis/cuisine/MainActivity.java   WebView, immersif, sortie à 2 doigts, clé réinjectée,
                                             secours et nouvel essai toutes les 15 s, onRenderProcessGone
  src/fr/arronis/cuisine/PontKiosque.java    setBrightness(float), setVolume(int), getVolume()
  src/fr/arronis/cuisine/PortUsb.java        port USB-C gardé en mode appareil (ADB par câble)
  src/fr/arronis/cuisine/ChienWifi.java, RadioWifi.java, RegleWifi.java, RemiseWifi.java
                                             chien de garde Wi-Fi (14/10) : sonde /sonde.bin toutes les 30 s, remise
                                             à zéro du Wi-Fi après 2 échecs (5 min entre deux, 30 min après 3 sans succès)
  tests/fr/arronis/cuisine/TestRegleWifi.java, TestRemiseWifi.java   règles pures, lancées par build.sh (JDK seul)
outils/
  cadre.mjs                   verifier, publier, liste, etat, cocher
  identifier-cadre.sh         relevé ADB en lecture seule
  verif-ha.mjs, verif-immich.mjs   présence des entités et des filtres, en lecture seule
tests/
  entites.test.js             aucune latitude, longitude, access_token, entity_picture ni numéro ne sort
  actions.test.js             domaines interdits refusés, simulation, courses en réel
  actions-maison.test.js      aucun service d'alarme, touches et applis hors liste refusées, ACTIONS_MAISON, 10/s
  qr.test.js, wifi.test.js    QR contre OpenCV et vecteurs publiés ; chaîne WIFI échappée, fichier secret
  maison-donnees.test.js, sonnette-page.test.js, sonnette-serveur.test.js
  garde-fous.test.js          ACTIONS_REELLES=1 seul laisse la maison simulée, et inversement (de la config à la connexion)
  ecrans-dom.test.js          sur un faux DOM (faux-dom.js) : images du mode Photos déchargées, direct arrêté en quittant
                              Maison, Wi-Fi masqué à 2 min, bandeau, télécommandes (appui long)
  immich.test.js, photos-page.test.js, photos-demo.test.js   faux Immich ; diaporama et mode Photos ; démonstration absente de la production
  menu.test.js                menu du 10/10 valide, 3 menus cassés refusés
  contraste.test.js           chaque texte des feuilles >= 4,5:1 sur le fond où il s'affiche, sans opacité partielle
  open-meteo.test.js, aujourdhui.test.js, aujourdhui-dom.test.js   page Aujourd'hui sans DOM et sur faux DOM (encart et ligne du ciel de l'Accueil compris : ce qui est passé retiré, rendez-vous à l'heure avant la ligne « Journée », seuils des alertes, chaque texte à sa place)
  agenda-grille.test.js, agenda-dom.test.js   Agenda en grille sans DOM et sur faux DOM (plage bornée, rangée journée repliée, chevauchements sur les vraies heures, « +N », place et largeur des blocs)
  meteo-ecran.test.js, meteo-dom.test.js   écran Météo allégé sans DOM et sur faux DOM (pluie, vent, air de demain, pollens seulement quand ils servent)
  tempo.test.js, tempo-page.test.js   Tempo côté serveur (règles, saison, repli, filet, pré-annonce, rythme ; réponses réelles de RTE du 14/10) et côté page (veille, heures creuses, liseré, case, fiche, Accueil sur faux DOM)
  draps.test.js, draps-page.test.js   draps côté serveur (date de Paris, liste fermée, écriture atomique, flux) et côté page (rappels, cartes sur faux DOM, annulation de 5 s, appui long)
  empreinte.test.js, rechargement-version.test.js   empreinte du contenu servi (instantané, /api/sante) et rechargement de la page après un déploiement
  enfants-bareme.test.js, enfants-journee.test.js, enfants-registre.test.js, enfants-routes.test.js   tableau des enfants côté serveur (valeurs de Thomas, 4 h à 4 h et changements d'heure, 32 min, attente parent, annulation, correction d'un parent, minuteur borné, minutes perdues, points jamais retirés par punition, point libre et annulation bornée, −1 d'un parent, échange, jeton expiré, plafonds, purge, flux)
  enfants-page.test.js, enfants-dom.test.js (+ enfants-valeur.js)   écrans des enfants (partie 4) : règles sans DOM (case du matin, pastille et fin du minuteur, quête, bourse, boutique, Pablo, mode parent, sons, pilotage) et faux DOM (gestes, envois, jeton, refus)
  fixtures/                   états HA anonymisés, réponses Open-Meteo, menu 2026-10-10.json
```

### 3.3 Règles de code (les tiennes)
- **Chaque fichier commence par un en-tête utile** : rôle, entrées, sorties, pièges. Exemple pour `serveur/ha/entites.js` : « Rôle : liste blanche des entités lisibles par le cadre et projection (jamais de GPS ni de jeton). Entrées : états bruts. Sorties : objet envoyé au flux. »
- **Zéro code mort.** Rien n'est écrit pour une fonction non tranchée : agenda, scènes, sonnette en direct, trajet, actions sur les repas, suggestions, boîte à demandes, clavier HTML, récepteur BOOT_COMPLETED, vraie veille. Une fonction n'est ajoutée que quand tu dis oui, ou quand un test du 13/10 la rend nécessaire.
- **Une seule source de vérité par flux** : uniquement des API documentées, pas de doublon « commande non documentée plus repli ».
- **Pas de copie du dépôt de Wes**, qui n'a pas de fichier LICENSE [V R1]. On s'en inspire et on réécrit.
- **cadre.mjs en Node** plutôt que le `cadre.py` de R5 : le même validateur que le serveur (`partage/valider-menu.js`). Le module `jsonschema` manque sur le Clevo [V R5].

---

## 4. Les fonctions une par une

| Fonction | Source | Faisable ? | Étape | Points d'attention |
|---|---|---|---|---|
| Minuteurs de cuisine | page seule, et page de secours | oui, **si le son passe le 13/10** | M0 (test), M3 | Fin en localStorage, en heure corrigée par le serveur. Son en WebAudio ou en `<audio>` : celui qui marche sans geste sur le cadre, `setMediaPlaybackRequiresUserGesture(false)` dans le kiosque [V R1, effet sur WebAudio S]. Volume remonté par le pont avant de sonner. Pas de rechargement à 4h tant qu'un minuteur tourne. |
| Menus de la semaine | /menu, JSON, rsync, BFF | oui | M3 | Publication en 2 temps : étape 6 `valide` sans recettes, étape 7 `commande` avec recettes [V R5]. Message « menu pas encore publié » le samedi. |
| Liste de courses partagée vers le drive | `todo.shopping_list` + /courses | oui, avec réserve | M3 | Le cadre ne remplit pas le drive : il faut le navigateur du Clevo et ta session Leclerc [V R5]. « Prêt pour le drive » pose un drapeau lu par `cadre.mjs etat`. Cocher passe par `/api/action/courses_cocher`, après ton « oui ». `status` toujours passé, cibles par uid [V R2]. |
| Recette du jour pas à pas | `recette` du JSON | oui | M3 | Vide entre l'étape 6 et l'étape 7 de /menu. « 35 à 40 min » devient `duree_s` 2100 et `duree_max_s` 2400. |
| Alarme, en lecture seule (13/10) | `alarm_control_panel.alarme_maison` + les 9 ouvertures | oui | M5 | Plus de clavier ni d'armement (décision du 13/10) : état et ouvertures seulement, temps réel depuis le correctif du pont Eufy du 11/10. |
| Wi-Fi invités et QR code | Freebox OS, **pas HA** | oui (QR statique) | M5 | Tu crées une clé invité dans Freebox OS, en `net_only`, et **sans expiration** : `remaining` à 0 signifie que la clé n'expire pas [V L, doc Freebox embarquée]. Une clé avec durée rendrait le QR faux sans prévenir. « Allumer le Wi-Fi invités » n'est pas couvert : le réseau invité existe tant qu'une clé existe, et créer ou supprimer une clé demande l'app_token (Q20). WPA2 ou WPA3 à lire avant de construire le QR [S R4]. |
| Télécommande TV et Apple TV | `remote.sejour_sejour`, `media_player.sejour_sejour`, `remote.smart_tv_pro_2`, état par `media_player.smart_tv_pro_2_2` | oui, sauf l'allumage | M5 | Le TCL devient indisponible une fois éteint, sauf avec le « Screenless service », et ses touches ne marchent pas dans Netflix [V R2]. Allumage : on teste d'abord le Screenless service, sinon `wakeup` de l'Apple TV par CEC, **sans garantie** (CEC jugé non fiable dans la mémoire). La macro « Apple TV sur la télé » (TV_INPUT, DPAD_RIGHT x4, DPAD_CENTER) est à retester. |
| Encre et piles faibles | `sensor.hp_deskjet_2800_series_black_ink` / `_tri_color_ink`, 12 `binary_sensor.*_battery_low` [V I] | oui | M2 | N'apparaît que quand il faut agir (encre sous 15 %, pile faible). |
| Météo heure par heure et 7 jours | Actuel et heure par heure : `weather.forecast_maison` (met.no). 7 jours : Open-Meteo (`daily` + `weather_code` horaire). Pluie dans l'heure : Open-Meteo au pas de 15 min | oui | M2 | met.no via HA ne donne que 6 jours de quotidien : toute la colonne « La semaine » vient d'Open-Meteo (décision du 11/10), ciel de la journée tiré des heures de jour (§2.2). « Pluie dans l'heure » au pas de 15 min, modèle `meteofrance_seamless`, sans rien toucher dans HA. Attributions affichées : met.no depuis HA [V L], Open-Meteo (CC BY 4.0). |
| Pollens et qualité de l'air | Open-Meteo, sans clé | oui | M2 | Pollens sur 4 jours, modèle CAMS de 11 km, null possible [V R4]. Seuils de niveau par taxon (EAACI, en image dans le PDF Atmo) à transcrire à la main [S]. Indices officiels Atmo en option plus tard. |
| Temps de trajet | Waze dans HA ou TomTom | **à étudier** | M7 | Bloqué par tes réponses (destinations, horaires, cas d'Agathe, Q24). Waze : endpoint non officiel. TomTom : compte gratuit, 20 000 requêtes par mois [V R4]. Les adresses partent chez un tiers. |
| Photos Immich quand personne ne regarde | Immich 3.2.0 | oui | M4 | Format `filter` avec `trashedAt {eq:null}` et `visibility {eq:"timeline"}` **obligatoires** [V R3], plus une revérification de `isTrashed` avant chaque envoi. Album et utilisateur dédiés recommandés (Q21). |
| Veille et réveil avec le capteur de mouvement | aucun capteur fiable | **à étudier** | M7 | Le cadre n'a très probablement pas de capteur [S R6], et le mouvement Eufy ne remonte pas [V I]. En attendant : inactivité au toucher, puis Photos, puis nuit horaire. Un capteur mmWave (ESP32 + HLK-LD2410C, environ 10 €) contredirait le « zéro payant » (Q26). |
| Mode nuit automatique | `sun.sun` + horaires + pont | oui | M2 | Horaires et élévation du soleil seulement, tant que Q11 n'est pas tranchée. |
| EDF Tempo (14/10) | JSON public de RTE, repli api-couleur-tempo.fr, filet local | oui | 14/10 (dev) | Sans compte ni intégration HA ; URL de RTE non documentée (format validé strictement, repli sinon) ; pré-annonce déduite de l'heure de lecture (10 h 40) ; jour Tempo de 6 h à 6 h. |
| Draps (14/10, demande d'Agathe) | serveur du cadre, `data/etat/draps.json` | oui | 14/10 (dev) | Aucune écriture dans HA ; date calculée par le serveur ; rappel sur le cadre seulement (pas de notification sur l'iPhone, décision de Thomas). |
| Brief du matin | page Aujourd'hui, calculée dans la page | remplacé le 14/10 | M6 | Brief en phrases refusé par Thomas après l'avoir vu sur le cadre ; à la place, la page Aujourd'hui en cartes visuelles, ouverte par l'encart de l'Accueil (décision en tête du document). |
| Demander quelque chose à Claude | boîte à demandes (P1) ou temps réel (P2) | **à étudier** | M6 (P1 si Q17), M7 | Le P2 avec ton abonnement sur un écran familial ressemble à un partage de compte, interdit par les conditions grand public [V R5]. Les alternatives : une clé API (payante) ou Assist local (`conversation.process`, gratuit, sans Claude) [V R2]. |

**Pourquoi trois fonctions restent à étudier :**
- **Trajet** : il manque des données de ta part, aucun obstacle technique.
- **Veille au mouvement** : il n'y a pas de capteur exploitable aujourd'hui. La vraie veille (écran éteint) ne sera étudiée que si la veille actuelle pose un problème concret (lueur la nuit, consommation).
- **Claude à l'écran** : c'est une question de conditions d'utilisation et de coût, pas de technique.

---

## 5. Plan par étapes

### M0 : le kit du jour J (dimanche 11 et lundi 12/10, sur le Clevo seulement)
Rien d'autre avant le GO : le reste serait perdu en cas de retour.
- **APK minimal** `cuisine-debug.apk`, construit pour l'origine `http://127.0.0.1:8020` :
  - MainActivity : WebView plein écran, immersif, sortie à deux doigts, `setMediaPlaybackRequiresUserGesture(false)`, viewport fixe, catégorie HOME, réinjection de la clé, nouvel essai sur erreur ;
  - PontKiosque : `setBrightness`, `setVolume`, `getVolume` (`AudioManager.setStreamVolume(STREAM_MUSIC, ...)`, sans permission [S]) ;
  - avec ton accord : téléchargement de build-tools 34.0.0 et de la platform android-34. Sauvegarde de `~/.android/debug.keystore`.
- **`web/compat/compat.html`**, écrit à la main en ES5 et servi par `python3 -m http.server 8020`. Ce qu'il teste :
  1. identité : userAgent (version de Chrome), `innerWidth`, `devicePixelRatio` ;
  2. `CSS.supports` : backdrop-filter, aspect-ratio, inset, `:is`, `:has`, color-mix, dvh, font-variation-settings, plus le gap en flex **mesuré** par `getBoundingClientRect` ;
  3. JS : `?.` et `??` via `new Function`, `Intl` avec `timeZone: 'Europe/Paris'`, EventSource, localStorage ;
  4. FPS d'un fondu de 2 s entre deux images 1920x1080 générées en canvas : sans pastille, avec 3 pastilles teintées, avec 3 pastilles floutées ;
  5. **son** : bouton « Bip » (WebAudio, et `<audio>` avec un WAV généré en JS), puis « Recharger et tester », qui fait un bip automatique 3 s après le rechargement, sans toucher ;
  6. pont : `setBrightness(0)`, `(0.05)`, `(1)`, `setVolume(80)`, `getVolume()` ;
  7. **clavier** : un champ texte où taper « crème fraîche » (le clavier Android apparaît-il, a-t-il les accents, que cache-t-il ?) ;
  8. diaporama de test de 10 min avec des images canvas, pour surveiller `dumpsys meminfo` depuis le Clevo.
- **`outils/identifier-cadre.sh`**, en lecture seule :
  - `getprop` : `ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`, `ro.board.platform`, `ro.hardware`, `ro.product.cpu.abi`, `ro.build.type`, `ro.build.tags`, `ro.debuggable`, `ro.secure`, `ro.adb.secure`, `ro.boot.slot_suffix` ;
  - `id`, `getenforce`, `dumpsys webviewupdate`, `head -3 /proc/meminfo`, `wm size`, `wm density`, `df -h` ;
  - `dumpsys sensorservice | head -40`, `getevent -lp`, **`dumpsys audio | head -60`** ;
  - `ime list -s`, `settings get secure default_input_method` ;
  - `pm list packages -f | grep -iE 'frameo|fota|adups|update|ota'` ;
  - `dumpsys package net.frameo.frame | grep versionName` ;
  - `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME` (activité d'accueil de Frameo, utile pour revenir en arrière ; syntaxe à confirmer sur l'appareil [S]) ;
  - `dumpsys power | grep -E 'mWakefulness|mScreenBrightnessSetting'`, `settings get system screen_off_timeout`.
- Une première version de `docs/recuperation.md`.

**Terminé quand :**
- `apksigner verify` passe, `aapt2 dump badging` affiche `fr.arronis.cuisine`, et `aapt2 dump xmltree` montre la catégorie HOME ;
- `compat.html` tourne sans erreur dans Chrome sur le Clevo, pont absent (repli silencieux) ;
- `grep -nE 'put|disable|enable|setprop|install|tcpip|reboot|rm ' outils/identifier-cadre.sh` ne renvoie rien (lecture seule prouvée) ;
- tu as répondu aux questions du §7.1.

### M1 : le BFF en lecture seule contre le vrai HA (avant ou après le 13/10, dès que le jeton de développement de Mur existe)
Ce travail reste utile même en cas de retour, puisque le BFF ne dépend pas du cadre.
- Squelette du BFF sur le Clevo : `index.js`, `config.js`, `securite.js`, `ha/connexion.js`, `ha/entites.js`, `ha/meteo.js`, `ha/courses.js` (lecture), `sources/open-meteo.js`, routes `flux` et `sante`. **Aucune route d'action n'existe encore.**
- `npm run verif-ha` : chaque entité de la liste blanche existe, et ses attributs d'unité sont relevés.
- **Historique Eufy en lecture seule**, pour conclure le point 0.1 : `GET /api/history/period/2026-10-04T00:00:00Z?end_time=2026-10-11T23:59:59Z&filter_entity_id=binary_sensor.porte_d_entree_sensor_open,binary_sensor.doorbell_ringing,binary_sensor.baie_vitree_centrale_sensor_open,binary_sensor.salon_motion_detected&no_attributes`, sans `minimal_response`, avec le jeton de développement (ou lancé par toi). On compte les vrais changements on/off et on les sépare des passages par `unavailable`.

**Terminé quand :**
- `verif-ha` signale 0 entité manquante ;
- `tests/entites.test.js` est vert sur la fixture et sur 1 min de flux réel capturé ;
- les valeurs météo sont identiques à celles de l'interface HA ;
- avec le Wi-Fi du Clevo coupé 2 min, `/api/sante` passe à `ha: "ko"`, puis tout reprend seul ;
- la conclusion sur l'historique est écrite dans `docs/` (sonnette et ouvertures, fiables ou non).

### Jour J : réception du cadre (mardi 13/10), ne pas le fixer, garder l'emballage
1. Noter la date limite de retour exacte sur la commande (30 jours d'après la fiche Amazon, environ le 12/11, à confirmer).
2. Allumer sur secteur. **Relever la version de Frameo** (À propos) avant toute connexion à Internet.
   - Si l'assistant de démarrage exige un Wi-Fi : un point d'accès 2,4 GHz du Clevo **sans Internet** [S, à tester]. Par exemple `nmcli device wifi hotspot ifname <carte> band bg ssid cadre-test password <...>` (commande que tu lances), Ethernet débranché pour qu'il n'y ait pas de sortie Internet. Une connexion pourrait sinon déclencher une mise à jour de Frameo, et l'inscription à la bêta en apporte de toute façon [V R6].
3. Câble USB-A (Clevo) vers USB-C (cadre). Activer « Transfert depuis l'ordinateur », puis À propos, Bêta, ADB, et accepter la clé (ton accord) [V R6]. Si l'appareil reste « unauthorized », couper puis remettre la bêta.
4. Lancer `identifier-cadre.sh` et consigner le résultat dans `docs/cadre-ave948.md`.
5. **Test d'installation** (ton accord) : `adb install cuisine-debug.apk`, puis `adb reverse tcp:8020 tcp:8020` et le serveur de `compat.html` sur le Clevo. Passer tous les tests de compat.html, son compris, pour décider du réglage `verre`.
6. **Test du lanceur, obligatoire et réversible** (ton accord) :
   - noter l'activité d'accueil de Frameo ;
   - `cmd package set-home-activity fr.arronis.cuisine/.MainActivity`, puis `adb reboot` : le kiosque doit démarrer seul ;
   - revenir avec `cmd package set-home-activity <activité Frameo>`, puis redémarrer.

   Cette commande n'existe qu'à partir d'Android 7 [V R6]. Avec Frameo en 1.29 ou plus, la doc ImmichFrame dit que le lanceur n'est plus remplaçable [V R3].
7. Si un retour est envisagé : `adb uninstall fr.arronis.cuisine`.

**Grille de décision :**

| Constat | Décision |
|---|---|
| ADB invisible malgré le câble, le réglage « transfert » et la bêta coupée puis remise | RETOUR |
| `adb install` refusé (INSTALL_FAILED_INVALID_APK), sans root | RETOUR (le plan B ImmichFrame a aussi besoin d'un APK) |
| Lanceur non remplaçable | Plan B testé avant la date limite de retour : un récepteur BOOT_COMPLETED dans le kiosque. Sous Android 10 et plus, le lancement d'une activité en arrière-plan est restreint, contournement possible par `adb shell appops set fr.arronis.cuisine SYSTEM_ALERT_WINDOW allow` [S]. Si le plan B échoue : RETOUR |
| Aucun son, même au toucher (pas de haut-parleur ou son muet) | RETOUR conseillé (minuteurs inaudibles), à toi de trancher |
| Son au toucher seulement, pas sans geste après un rechargement | GO : le minuteur s'arme au toucher qui le lance, et la page ne se recharge pas pendant qu'un minuteur tourne |
| WebView < 64, ou Android < 7 sans root | RETOUR conseillé |
| WebView de 64 à 75 | GO, `verre: teinte` |
| WebView ≥ 76 | GO, `verre` selon la mesure du fondu |
| RAM réelle < 1,5 Go | Diaporama de test pendant 1 h : si la WebView plante (`onRenderProcessGone`), RETOUR |
| `adb shell id` renvoie uid=0 | GO, sans ADB réseau, Internet coupé au cadre |
| Android 15 ou plus | GO avec targetSdk 24 |
| Clavier Android absent ou inutilisable | GO, clavier HTML ajouté en M3 |

**Terminé quand :**
- `docs/cadre-ave948.md` est rempli : Android, SoC, RAM réelle, WebView NN, root, `ro.adb.secure`, capteurs, audio, clavier, version de Frameo (avant et après Internet), paquets de mise à jour, activité d'accueil de Frameo ;
- la décision GO ou RETOUR est écrite avec sa raison, et la date limite de retour est notée.

### M2 : kiosque autonome, BFF sur le M900, Accueil et Météo (seulement si GO)
- **Sur le cadre** (ton accord, point par point) :
  - régler le Wi-Fi dans les réglages Android **avant** de désactiver Frameo [V R6] ;
  - `cmd package set-home-activity` ;
  - `pm disable-user --user 0 net.frameo.frame`, et les paquets de mise à jour trouvés ;
  - transmettre la clé par `am start --es cle` ;
  - puis couper Internet au cadre (recommandé).
- **Sur la Freebox** (ton accord) : un bail fixe pour le cadre.
- **Kiosque** : origine `http://192.168.1.187:8020`, page de secours embarquée, `onRenderProcessGone`, `build.target` réglé sur la version mesurée.
- **BFF** :
  - Docker sur le Clevo (ton accord), image construite et testée en local ;
  - sur le M900 (ton accord) : `~/cadre`, les secrets, `docker load`, `docker compose up -d` ;
  - jeton « cadre-bff » de Mur ;
  - ajout à `sauvegarde.sh` (tu le poses).
- **Page** (après tes réponses à Q6, Q7 et Q8) :
  - `jetons.css`, menu à 2 états ;
  - Accueil (grille du §1.5), Météo avec pluie au pas de 15 min, Entretien ;
  - thèmes, luminosité, retour à l'Accueil après 60 s, rechargement à 4h, bandeau hors ligne.
- **Installation physique**, une fois les critères remplis :
  - fixation (non annoncée, à voir au dos) ;
  - prise et câble secteur ;
  - centre de l'écran à hauteur des yeux ;
  - à distance des plaques (chaleur, vapeur, graisse) et des reflets de fenêtre ;
  - port USB-C toujours accessible pour la récupération.

**Terminé quand :**
- après une coupure de courant, le cadre revient seul sur l'Accueil en moins de 2 min ;
- avec le BFF arrêté au démarrage, la page de secours affiche l'heure et les minuteurs, puis la vraie page reprend seule quand le BFF revient ;
- `?diag` montre au moins 30 FPS en navigation, et moins de 200 ms entre le toucher et le clic ;
- `tests/contraste.test.js` est vert ;
- **Agathe lit à 2 m** l'heure, la température et le plat du soir sans s'approcher ;
- `curl http://192.168.1.187:8020/api/flux` sans clé, depuis le Clevo, renvoie 401 ;
- le passage en soir est constaté au crépuscule, et en nuit à 20 h 30 ;
- le cadre tient 24 h sans intervention, y compris pendant un redémarrage du BFF.

### M3 : repas, recette, minuteurs, courses
- `partage/schema-menu-v1.json`, le schéma de R5 repris tel quel :
  - `version`, `cycle{debut, fin}`, `statut` (valide ou commande), `maj_le` ;
  - `repas[9]{id, date, creneau, titre, accompagnement, temps_min, kcal_adulte, tags, gamelles|null, avis, recette|null}` ;
  - `recette{portions, preparation_min, cuisson_min, ingredients[], etapes[{texte, four, minuteur{libelle, duree_s, duree_max_s}}], astuces[]}` ;
  - `petits_dejeuners`, `rappels`, `panier`, `memo`.
- `partage/valider-menu.js` ajoute les règles hors schéma : 9 créneaux, gamelles bien placées, `duree_max_s ≥ duree_s`.
- La fixture du menu du 10/10, convertie à la main.
- `cadre.mjs` : verifier, publier (`rsync -e "ssh -i ~/.ssh/cadre_menus -o IdentitiesOnly=yes" --chmod=F644 <fichier> thomas@192.168.1.187:`), liste, etat, cocher.
- Avec ton accord :
  - la clé `~/.ssh/cadre_menus` ;
  - la ligne `restrict,command="/usr/bin/rrsync -no-del cadre/data/menus"` sur le M900 (`/usr/bin/rrsync` fait partie du paquet rsync de Debian 13 [V rel.]) ;
  - les diffs de R5 sur les skills, adaptés à cadre.mjs ;
  - **l'exception durable du §6.0**.
- Écrans Repas, Recette, Minuteurs, Courses, et le bouton « Prêt pour le drive ».

**Terminé quand :**
- `cadre.mjs verifier` accepte le menu du 10/10 et refuse 3 menus cassés : un créneau manquant, des gamelles mal placées, `duree_max_s < duree_s` ;
- un vrai /menu publie le JSON, et le cadre l'affiche en moins d'1 min sans rechargement ;
- un minuteur lancé depuis une étape sonne à l'heure, même après un rechargement, et **s'entend depuis l'évier, hotte allumée** ;
- un article ajouté sur le cadre apparaît en moins de 5 s dans l'appli HA de l'iPhone. Un ajout ou une coche faite sur l'iPhone apparaît en moins de 5 s sur le cadre, un renommage en moins de 65 s ;
- /courses affiche la liste partagée et le drapeau, et ne coche qu'après ton « oui ».

### M4 : photos Immich et verre
- 13/10 : écrit en développement, sans clé (serveur, page, tests sur un faux Immich, démonstration en développement seulement) ; format du lot vérifié dans les sources d'Immich 3.2.0. Reste à faire avec ton accord : la clé, la source (album ou favoris), le déploiement.
- Avec ton accord : l'utilisateur Immich « cadre », l'album « Cadre cuisine » (ou les favoris, Q21) et la clé avec `asset.read` et `asset.view`.
- Requête du lot : `POST http://host.docker.internal:2283/api/search/random` avec `{"size":100,"withExif":true,"filter":{"type":{"eq":"IMAGE"},"visibility":{"eq":"timeline"},"trashedAt":{"eq":null},"albumIds":{"any":["<uuid>"]}}}` (ou `"isFavorite":{"eq":true}` à la place d'`albumIds`). 14/10 (choix de Thomas) : `IMMICH_SOURCE=tout` par défaut, sans `albumIds` ni `isFavorite` : au hasard dans toute la photothèque (images de la chronologie seulement, hors corbeille) ; `favoris` et `album` (avec `IMMICH_ALBUM_ID`) restent possibles. Toujours seules les photos d'un lot rendu depuis moins de 2 h sont servies.
- Revérification `isTrashed` (et visibilité, favori), preview relayée telle quelle.
- Passage en Photos après 3 min sans toucher, pastilles en verre « teinte », légende.

**Terminé quand :**
- après 2 h de diaporama, `dumpsys meminfo fr.arronis.cuisine` reste stable à 10 % près ;
- une photo que tu mets à la corbeille renvoie 410 dès l'appel suivant, et une photo retirée de l'album disparaît en 60 min au plus ;
- le fondu tourne à au moins 30 FPS ;
- **endurance** : 7 jours sans intervention.

### M5 : maison
- 13/10 : écrit en développement, actions maison simulées (`ACTIONS_MAISON` absent) : alarme en lecture seule et ouvertures, télécommandes, sonnette (photo, direct, bandeau), Wi-Fi invités, entretien. Plus d'alarme à code (décision du 13/10).
- Avec ton accord dédié : `ACTIONS_MAISON=1` (exception durable c), le fichier du Wi-Fi invités, le nom du flux go2rtc (seulement après avoir fermé go2rtc au réseau local ou activé son authentification, §2.5).

**Terminé quand :**
- la vue Alarme montre en moins de 3 s une ouverture faite pour de vrai, et la refermeture ;
- chaque touche des deux télécommandes est testée (POWER du TCL exclu du critère). Le résultat du Screenless service et de `wakeup` est noté ;
- un iPhone qui scanne le QR rejoint le réseau invité et **ne joint pas** `http://192.168.1.187:8123` (`net_only`) ;
- un vrai coup de sonnette affiche le bandeau en moins de 3 s.

### M6 : brief du matin (et boîte à demandes si Q17)
**14/10 : le brief est remplacé par la page Aujourd'hui** (décision en tête du document) ; ce qui suit est la conception d'origine, gardée pour mémoire.
- `/api/brief` avec un gabarit unique : date, températures du matin et de l'après-midi, pluie, gamelle du midi, plat du soir et son temps, encre et piles si alerte, air et pollens à partir du niveau moyen. Les rappels de /menu seulement si Q15.
- Si Q17 : `POST /api/demande`, puis `cadre.mjs etat` et sa lecture par les skills (ton accord).

**Terminé quand :**
- chaque chiffre du brief est identique à sa source (tests sur fixtures, plus un contrôle sur 3 matins) ;
- si Q17 : une demande saisie sur le cadre ressort au /menu suivant.

### M7 : sujets à étudier (une note de décision avant tout code)
Temps de trajet, capteur et vraie veille, Claude en temps réel, clés Wi-Fi temporaires, agenda.

---

## 6. Actions qui demandent ton accord explicite

### 6.0 L'exception durable, à valider une fois (en M3, puis en M5)
Pour que le cadre serve au quotidien, certaines écritures en prod doivent devenir permanentes, sans te redemander à chaque fois. C'est une dérogation à ta règle, pas un simple réglage technique.
- **(a) Publication du menu (M3).** /menu publie le JSON de la semaine dans `~/cadre/data/menus` du M900, et uniquement là : clé SSH bridée par rrsync, sans suppression. Cela passe par des règles d'autorisation ciblées dans `~/.claude/settings.json`, pour `node /home/thomas/Projets/cadre-cuisine/outils/cadre.mjs verifier *`, `publier *`, `liste` et `etat`. `cocher` reste en demande de confirmation.
- **(b) Courses depuis le cadre (M3).** Le BFF passe en écriture réelle (`ACTIONS_REELLES=1`) pour les 4 actions `courses_*` sur `todo.shopping_list`, et rien d'autre.
- **(c) Maison depuis le cadre (M5, accord séparé).** Télécommandes (Apple TV, télé TCL) et direct de la sonnette (`script.sonnette_direct`), utilisables par toute la famille, sous `ACTIONS_MAISON=1`. Plus d'alarme depuis le cadre (décision du 13/10).

Ce que l'exception n'ouvre pas : Wi-Fi, Freebox, Immich en écriture, notifications, scripts hors liste.

Pour la révoquer : retirer la ligne d'`authorized_keys` ou les règles d'autorisation, ou repasser `ACTIONS_REELLES=0`.

### 6.1 Avant et pendant le 13/10 (bloquants)
1. Télécharger les cmdline-tools Android, build-tools 34.0.0 et platform android-34 (dl.google.com) dans `~/Android/Sdk`. JDK, adb et règles udev sont déjà là [V L].
2. Lancer le point d'accès sans Internet sur le Clevo, si l'assistant de Frameo l'exige.
3. Inscrire le cadre au programme bêta Frameo et activer l'ADB (le cadre passe sur le canal bêta).
4. `adb install` de l'APK de test, puis `adb uninstall`.
5. Test du lanceur : `cmd package set-home-activity`, `adb reboot`, retour au lanceur Frameo.
6. Si besoin, test du plan B (récepteur BOOT_COMPLETED, `appops set ... SYSTEM_ALERT_WINDOW allow`).
7. La décision de retour Amazon.

### 6.2 M1 et M2
8. Activer la connexion de l'utilisateur HA « Mur » (tu choisis le mot de passe) et créer ses jetons longue durée : un pour le développement sur le Clevo (révocable), un « cadre-bff ».
9. Lecture de l'historique HA (Eufy) avec ce jeton, ou tu la lances toi-même.
10. Lecture SSH de `configuration.yaml`, `templates.yaml`, du compose HA, de `docker inspect`, `ss -ltn` et `id` sur le M900 (bloquée jusqu'ici par le classifieur).
11. Installer Docker sur le Clevo (`sudo apt`, paquets à confirmer pour 26.04 [S]), ou accepter la construction sur le M900.
12. Sur le cadre : régler le Wi-Fi Android, `set-home-activity`, `pm disable-user` de `net.frameo.frame` et des paquets de mise à jour, transmission de la clé (`am start --es cle`).
13. Sur la Freebox : bail DHCP fixe du cadre, puis coupure de son accès Internet (contrôle parental).
14. Sur le M900 : créer `~/cadre`, les secrets et le compose, ouvrir le port 8020, puis chaque `docker load` et `docker compose up -d`.
15. Ajouter `~/cadre` à `/usr/local/bin/sauvegarde.sh` (tu poses la modification).

### 6.3 M3
16. Créer `~/.ssh/cadre_menus` sur le Clevo.
17. Sur le M900 : créer `~/cadre/data/menus` et ajouter la ligne rrsync dans `~/.ssh/authorized_keys`.
18. Modifier `~/.claude/skills/menu/SKILL.md` et `~/.claude/skills/courses/SKILL.md` (diffs de R5, adaptés à cadre.mjs).
19. L'exception durable (a) et (b) du §6.0.
20. Chaque publication de menu tant que (a) n'est pas validée, et chaque `cadre.mjs cocher`.

### 6.4 M4
21. Créer l'utilisateur Immich « cadre », l'album « Cadre cuisine » et le partage.
22. Créer la clé API (`asset.read`, `asset.view`, plus `memory.read` si tu veux les souvenirs).
23. Lancer le premier `POST /api/search/random` de test, et mettre une photo à la corbeille pour le critère.
24. Épingler la version d'Immich ou la mettre à jour (`v3` vers 3.3.1).

### 6.5 M5
25. L'exception durable (c) du §6.0 (`ACTIONS_MAISON=1`).
26. Lancer un vrai direct de la sonnette, pour voir ce que donne le flux go2rtc (`GO2RTC_FLUX_SONNETTE`), et une vraie sonnerie pour mesurer le délai de la photo (suivi « du coup »).
27. Ouvrir et refermer une porte pour de vrai devant le cadre (vue Alarme, moins de 3 s).
28. Tester pour de vrai l'Apple TV et le TCL, et activer le Screenless service du TCL.
29. Créer à la main, dans Freebox OS, la clé invité fixe (`net_only`, sans expiration).
30. Créer les scripts « Bonne nuit » et « Je pars » (Q11), et un script de notification (Q22).
31. Sortir les photos de sonnette de `/config/www`.

### 6.6 M6 et M7
32. Modifier les skills pour la boîte à demandes (Q17).
33. Compte TomTom, intégration Waze, ou comptes Atmo AURA et Atmo Data.
34. Achat d'un capteur cuisine, puis ESPHome dans HA.
35. Enregistrer une appli Freebox `fr.arronis.cadre` (validation en façade, permission « settings ») pour les clés temporaires.
36. Installer Claude Code sur le M900 (utilisateur unix, timer systemd, `claude setup-token` lancé par toi), ou ouvrir un compte API Anthropic payant.
37. Ajouter l'intégration ADB (androidtv) dans HA, ou `adb tcpip 5555` sur le cadre.
38. Toute tentative de root, de Magisk ou de remplacement de la WebView. Déconseillé.

### 6.7 En permanence
39. Tout `git commit`, `git push` ou `git tag` du dépôt cadre-cuisine, et la création d'un dépôt GitHub : chaque commit séparément.

---

## 7. Questions ouvertes

### 7.1 À trancher avant le 13/10 (bloquantes)
1. Es-tu d'accord pour l'inscription à la bêta, l'ADB, l'installation de l'APK de test et le test réversible du lanceur, le jour même ?
2. Le Clevo est-il en Ethernet ou en Wi-Fi ? Lances-tu le point d'accès sans Internet si l'assistant de Frameo exige un réseau ?
3. La grille de décision te convient-elle ? En particulier, « aucun son » vaut-il un retour ?
4. Quelle est la date limite de retour exacte sur ta commande ?
5. Es-tu d'accord pour le téléchargement des build-tools et de la platform 34 ?

### 7.2 À trancher avant M2 (visuel)
6. **Menu** : le menu large et le menu discret sont choisis ensemble. Ma proposition : large partout, masqué en Photos et en Nuit, et un toucher le ramène. D'accord ?
7. **Verre dépoli** : tu l'as choisi sans « les photos Immich en fond ». Verre seulement sur le diaporama et le bandeau sonnette (proposition), ou photos en fond permanent sous l'interface (plus lourd pour le cadre) ?
8. **Palette Ardoise** réservée au soir et à la nuit ? La nuit va-t-elle de 23h à 5h, comme l'alarme ?
9. **Portraits** : sur un fond uni, ou par paires côte à côte ?

### 7.3 Fonctions non cochées ou incohérentes
10. **Agenda familial** : demandé au départ, non coché, et aucune entité `calendar.*` n'existe. On l'ajoute (iCloud ou Google) ? Doit-il entrer dans le brief ?
11. **« Bonne nuit » et « Je pars »** sont dans les gros boutons choisis, mais pas la fonction. Les garde-t-on, et que doivent-ils faire ? Par exemple, Bonne nuit = armer en nuit puis écran de nuit.
12. **Sonnette** : la notification en haut est choisie, mais pas « photo et direct ». Le bandeau montre-t-il la photo ? Faut-il un bouton direct (`script.sonnette_direct`) ?
13. **Qui est à la maison** n'est pas coché. Puis-je quand même lire `zone.home` (un simple compte, sans GPS) pour éteindre l'écran quand tout le monde est parti ?
14. **Portes et fenêtres** : une alerte si quelque chose est resté ouvert ? À décider une fois l'historique relu en M1.
15. **Rappels** n'est pas coché. Les rappels de préparation écrits par /menu (riz à cuire le matin, surgelé à sortir) peuvent-ils entrer dans le brief ?
16. **Brief « (Claude) »** : déterministe avec ce que /menu prépare chaque semaine (proposé), ou texte rédigé par Claude chaque matin sur le M900 (zone grise des conditions, risque de chiffres inventés) ?
17. **Messages** et « demander à Claude » : une boîte à demandes lue par /menu et /courses (P1) te convient-elle ?
18. **Actions sur les repas** (échanger deux repas, marquer pas fait ou reporté) : non cochées. Les veux-tu ?
19. **Suggestions de produits habituels** dans Courses (l'ajout rapide n'est pas coché) ?

### 7.4 Décisions techniques
20. **Wi-Fi invités** : clé fixe avec QR statique (conseillé), ou clés temporaires à la demande avec un app_token Freebox qui a la main sur toute la box (seule façon d'« allumer » le réseau invité) ? Combien d'appareils, `net_only` (conseillé), WPA2 ou WPA3 ?
21. **Photos** : album et utilisateur dédiés (conseillé), ou favoris ? Faut-il aussi les souvenirs « il y a N ans » ?
22. **« Prêt pour le drive »** : une notification par ntfy en local (as-tu l'appli sur l'iPhone ?), par un script HA dédié en liste blanche, ou aucune ?
23. **Courses** : la liste HA ne reçoit-elle que les besoins notés pendant la semaine (conseillé) ? Coche-t-on à la validation du drive ou au retrait ?
24. **Trajet** : quelles destinations ? Celle d'Agathe est-elle fixe ? Quels jours et quelles heures, avec le retour ou non ? Faut-il éviter les péages ? Waze sans compte, ou TomTom avec un compte gratuit ?
25. **Claude à l'écran** : on s'arrête au P1 ? Assist local ? Une clé API payante ?
26. **Veille** : l'écran au minimum la nuit te suffit-il ? Un capteur à environ 10 € est-il acceptable malgré le « zéro payant » ?
27. **Exception durable** (§6.0) : d'accord sur ce périmètre ?
28. **Construction** : Docker sur le Clevo (conseillé), ou construction sur le M900 ?
29. **Internet coupé au cadre** par défaut, une fois Frameo désactivé (conseillé) ?
30. **Dépôt** : privé ou public sur GitHub, et sous quelle licence ?
31. Faut-il épingler la version d'Immich plutôt que de suivre `v3` ?
32. **Installation** : quel emplacement exact, où est la prise, quelle distance aux plaques ?

### 7.5 Questions visuelles nées de la relecture de l'Accueil (11/10)
33. **Chiffres lus à 2 m** : en opsz 144 et graisse 400 (§1.2), la diagonale et la barre du « 4 » font 2,5 à 4 px sur l'horloge de 260 px, soit environ 0,8' d'angle à 2 m, sous la minute d'arc de l'acuité normale : « 16:24 » peut se lire « 16:21 », et la nuit (gris atténué, luminosité 0,05) c'est pire. En opsz 48 et graisse 500, tous les traits sont pleins (comparaison faite par la relecture). Proposition : essayer les deux sur le cadre lors de l'essai « Agathe lit à 2 m » (le 13/10 si la page y tourne déjà, sinon en M2), puis garder le meilleur. Le réglage tient en une règle (`.chiffres-affiche` dans `web/styles/base.css` : heure, température, horloge de nuit). En opsz 48 et graisse 500, les chiffres sont 10 à 30 % plus larges (« 00:00 » : 714 px au lieu de 629), ce qui pèse sur Q34.
34. **Place de « Ce soir »** (budget réel au §1.5 : 176 px libres, 130 dans le pire cas, pour 276 à 375 px nécessaires). Options mesurées :
    - **A (proposée)** : température et pictogramme à droite de l'heure (largeur 629 + 32 + 304 = 965 px sur 1024), ciel et pluie sur une seule ligne de 40 px sous la date ; plat en 90 px sur **une** ligne (ellipse, titre complet dans « La semaine » et l'écran Repas), temps en 32 px avec le bouton Recette à sa droite. Libre : 284 px (238 dans le pire cas) pour 234 nécessaires. Avec les chiffres de Q33 en opsz 48, « 08:00 » et « -12° » dépasseraient d'environ 30 px : il faudrait alors réduire l'écart.
    - **B** : on garde l'empilement actuel, et les cartes Courses et Air quittent l'Accueil quand un plat est publié (elles restent dans les écrans Courses et Météo ; « À faire » devient une ligne sous « Ce soir »). Libre : 424 px pour 375 (plat sur 2 lignes, bouton dessous).
    - Écartée : plat en 72 px sur 2 lignes (15,6' d'angle, sous les 16' conseillés au §1.2).

---

## 8. Points de relecture écartés ou adaptés
- **Ne garder que le documenté** : appliqué à la météo (`weather.get_forecasts`) et aux courses (`todo.get_items`). Mais `subscribeEntities` est gardé, car c'est l'API publique de la bibliothèque officielle, dont dépend le frontend HA lui-même.
- **Courses rafraîchies au seul changement d'état** : complété par une lecture toutes les 60 s, parce qu'un renommage ne change pas le nombre d'articles à faire, donc pas l'état [S].
- **Contrôle de contraste en M0** : déplacé en M2, puisque M0 ne contient plus aucune interface.
- **Faux verre et retrait du flou pendant le fondu** : gardés comme replis seulement. Le choix entre `teinte` et `flou` est tranché par la mesure du fondu sous flou le 13/10, sans code supplémentaire.
- **Plan B BOOT_COMPLETED et `appops SYSTEM_ALERT_WINDOW`** : retenus dans la grille, mais pas écrits à l'avance (zéro code mort). Ils ne sont codés que si le test du lanceur échoue.
- **Purge du cache photos** : rendue sans objet, puisque le cache disque est supprimé au profit d'un redimensionnement à la demande.
- **Installer Docker sur le Clevo** : proposé mais pas imposé (Q28). La construction sur le M900 reste possible avec ton accord.

---

**Fichiers lus ou vérifiés pour cette version :**
- `/tmp/claude-1000/-home-thomas/7c74965b-585f-4131-b74e-0e7ccc8517ab/scratchpad/ha_states.json` (`last_changed` des entités Eufy, `counter.alarme_codes_faux`, attribution météo)
- `/tmp/claude-1000/-home-thomas/7c74965b-585f-4131-b74e-0e7ccc8517ab/scratchpad/cadre-cuisine.html` (maquettes et liste des fonctions, lues pour la v1)
- `/tmp/claude-1000/-home-thomas/7c74965b-585f-4131-b74e-0e7ccc8517ab/scratchpad/immich/spec.json` (`isTrashed`, `withExif`, `ExifResponseDto`)
- `/tmp/claude-1000/-home-thomas/7c74965b-585f-4131-b74e-0e7ccc8517ab/scratchpad/revue/search.dto.ts`, `revue/network.py`, `revue/met_const.py`, `revue/om_min15.json`
- `/tmp/claude-1000/-home-thomas/7c74965b-585f-4131-b74e-0e7ccc8517ab/scratchpad/fbxdoc/index.html.txt` (WifiCustomKey : `remaining` à 0, la clé n'expire pas)
- `/home/thomas/.claude/projects/-home-thomas/memory/project_cadre_cuisine.md` et `project_serveur_maison_m900.md`
- Sur le Clevo : `dpkg-query` (openjdk-17-jdk 17.0.20.1, adb 34.0.5), `/lib/udev/rules.d/51-android.rules`, absence de Docker et de `~/Android/Sdk`
- GET publics : registre npm (versions du §3.1), nodejs.org/dist/index.json (22.23.3 du 23/09/2026), Docker Hub (`node:22.23.3-alpine`)
- Calculs : contrastes WCAG et angles de lecture à 2 m, par script Python local

Les autres sources (docs HA, Immich, Android, Vite, Open-Meteo, Freebox, Anthropic) sont celles des rapports R1 à R6.