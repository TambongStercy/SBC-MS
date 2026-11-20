# Brouillon pour la politique de confidentialité — signaux d'utilisation (Phase 1)

À valider par Rufus (et le juriste) avant publication. Une fois publié, monter
`PRIVACY_POLICY_VERSION` à `2026-12` dans user-service (`config/privacy.ts`) et
dans l'app (`POLICY_VERSION`) : chaque membre devra accepter à nouveau, et la
collecte ne démarre pour lui qu'après son accord.

---

## Sécurité de votre compte : pays, réseau et appareil

Pour protéger votre compte et votre argent contre le piratage et la fraude, nous
enregistrons, à chaque utilisation de SBC (site, application ou autre) :

- le **pays** depuis lequel vous vous connectez (déduit de votre adresse IP par
  notre hébergeur Cloudflare) ;
- votre **réseau** : l'opérateur internet et une plage d'adresses IP
  (jamais votre adresse IP complète) ;
- un **identifiant d'appareil** : un numéro au hasard créé par le site dans votre
  navigateur (il ne contient aucune information sur vous et est renouvelé tous les
  60 jours) ;
- les **jours où vous utilisez SBC** et le nombre de vos actions ce jour-là, ainsi
  que vos connexions.

**Pourquoi :** repérer une connexion inhabituelle (un autre pays, un nouvel
appareil) avant un retrait ou un changement de vos coordonnées de paiement, et
savoir quels comptes sont actifs.

**Combien de temps :** ces informations sont effacées automatiquement après
**180 jours**. Votre pays habituel et la date de votre dernière activité sont
gardés sur votre compte tant qu'il existe.

**Vos droits :** elles figurent dans le fichier « Télécharger mes données »
(page Mes données) et sont effacées si vous supprimez votre compte.
