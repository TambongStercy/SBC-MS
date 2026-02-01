# Rapport de Conformité Sécurité & Protection des Données

**Entreprise:** Sniper Business Center (SBC)
**Site Web:** https://sniperbuisnesscenter.com
**Date du rapport:** 25 Janvier 2026
**Version:** 1.0

---

## Table des Matières

1. [Présentation Générale](#1-présentation-générale)
2. [Données Utilisateurs Collectées](#2-données-utilisateurs-collectées)
3. [Stockage et Hébergement](#3-stockage-et-hébergement)
4. [Sécurité Technique](#4-sécurité-technique)
5. [Accès Internes & Organisation](#5-accès-internes--organisation)
6. [Cookies, Tracking et Outils Tiers](#6-cookies-tracking-et-outils-tiers)
7. [Gestion des Incidents](#7-gestion-des-incidents)
8. [Droits des Utilisateurs](#8-droits-des-utilisateurs)
9. [Architecture Technique](#9-architecture-technique)

---

## 1. Présentation Générale

### Quel est l'objectif principal du site web ?

Sniper Business Center (SBC) est une **plateforme de services financiers** permettant aux utilisateurs de :
- Gérer leur profil et compte utilisateur
- Effectuer des paiements et retraits via Mobile Money
- Participer à un système de parrainage avec commissions
- Accéder à une marketplace de produits
- Participer à des tombolas/loteries

### S'agit-il d'un site vitrine, e-commerce, plateforme SaaS ?

Il s'agit d'une **application web SaaS** (Software as a Service) avec des fonctionnalités de paiement intégrées.

### Qui sont les utilisateurs cibles ?

| Type d'utilisateur | Description | Niveau d'accès |
|-------------------|-------------|----------------|
| Utilisateur standard | Client de la plateforme | Données personnelles, transactions |
| Administrateur | Super administrateur | Accès complet au système |
| Admin retraits | Sous-administrateur | Approbation des retraits uniquement |

### Le site est-il public ou avec authentification ?

- **Pages publiques:** Page d'accueil, pages de paiement
- **Pages protégées:** Tableau de bord, transactions, profil (authentification requise)

### Combien d'utilisateurs actifs ?

| Métrique | Valeur approximative |
|----------|---------------------|
| Utilisateurs inscrits | ~5 000+ |
| Utilisateurs actifs mensuels | ~1 500 |
| Utilisateurs actifs quotidiens | ~300-500 |

### Sur quels pays le site est-il accessible ?

**Marchés principaux:** Cameroun (CM), Côte d'Ivoire (CI), Sénégal (SN)

**Pays supportés:** Togo, Bénin, Mali, Burkina Faso, Guinée, Congo (RDC), Kenya

---

## 2. Données Utilisateurs Collectées

### Quelles données personnelles sont collectées ?

| Donnée | Obligatoire | Moment de collecte | Finalité |
|--------|-------------|-------------------|----------|
| Nom complet | Oui | Inscription | Identification |
| Email | Oui | Inscription | Authentification, notifications |
| Numéro de téléphone | Oui | Inscription | Authentification, paiements |
| Mot de passe | Oui | Inscription | Authentification |
| Numéro Mobile Money | Non | Configuration profil | Retraits |
| Date de naissance | Non | Profil | Vérification d'âge |
| Sexe | Non | Profil | Statistiques démographiques |
| Profession | Non | Profil | Statistiques démographiques |
| Pays/Ville/Région | Oui | Inscription | Localisation des services |
| Adresse IP | Auto | Connexion | Sécurité, prévention fraude |

### Collectez-vous des données sensibles ?

| Type de données | Collectées ? | Détails |
|-----------------|--------------|---------|
| Données financières | Oui | Solde du compte, historique des transactions |
| Données de santé | Non | - |
| Données d'identification officielle | Non | - |
| Données biométriques | Non | - |

---

## 3. Stockage et Hébergement

### Où sont hébergées les données ?

| Composant | Localisation | Fournisseur |
|-----------|--------------|-------------|
| Serveur principal | Allemagne (EU) | Contabo GmbH |
| Base de données | Même serveur (local) | MongoDB |
| CDN / Protection | International | Cloudflare |

### Les données sont-elles chiffrées ?

| Type de chiffrement | Implémentation | Statut |
|--------------------|----------------|--------|
| **Chiffrement au repos** | MongoDB encryption | ✅ Actif |
| **Chiffrement en transit** | HTTPS/TLS 1.2 & 1.3 | ✅ Actif |
| **Mots de passe** | bcrypt (10 rounds de salage) | ✅ Actif |

### Qui a accès aux bases de données ?

| Rôle | Accès | Méthode |
|------|-------|---------|
| Administrateur système | Accès complet | SSH + authentification MongoDB |
| Services applicatifs | Lecture/Écriture | Credentials sécurisées |
| Utilisateurs | Leurs données uniquement | API authentifiée (JWT) |

### Y a-t-il une séparation entre données prod / test ?

**Oui.** Chaque environnement utilise des bases de données distinctes :
- Production: `sbc_user`, `sbc_payment`, etc.
- Développement: `sbc_user_dev`, `sbc_payment_dev`, etc.

---

## 4. Sécurité Technique

### Le site utilise-t-il HTTPS avec certificat SSL valide ?

| Élément | Détail |
|---------|--------|
| Protocole | HTTPS obligatoire |
| Certificat | Let's Encrypt (renouvellement automatique) |
| Versions TLS | TLSv1.2 et TLSv1.3 uniquement |
| Redirection HTTP→HTTPS | Automatique (301) |

### Comment sont stockés les mots de passe ?

| Mesure | Implémentation |
|--------|----------------|
| Algorithme | bcrypt |
| Salage | 10 rounds |
| Stockage en clair | **Jamais** |
| Comparaison | Timing-safe (protection contre timing attacks) |

### Existe-t-il une authentification à deux facteurs (2FA) ?

**Oui.** Vérification OTP (One-Time Password) par :
- Email
- SMS

| Paramètre OTP | Valeur |
|---------------|--------|
| Longueur | 6 chiffres |
| Validité | 10 minutes |
| Génération | crypto.randomBytes (cryptographiquement sécurisé) |

### Comment sont gérés les rôles ?

Système **RBAC** (Role-Based Access Control) avec 4 rôles :

| Rôle | Permissions |
|------|-------------|
| `user` | Profil personnel, transactions, chat |
| `admin` | Accès complet au système |
| `withdrawal_admin` | Approbation des retraits uniquement |
| `tester` | Environnement de test limité |

### Protection contre les attaques courantes ?

| Attaque | Protection | Statut |
|---------|------------|--------|
| **Injection SQL** | ORM Mongoose (requêtes paramétrées) | ✅ Protégé |
| **XSS** | Helmet.js (headers de sécurité), échappement des entrées | ✅ Protégé |
| **CSRF** | Tokens JWT, validation d'origine | ✅ Protégé |
| **Brute-force** | Rate limiting + Fail2Ban | ✅ Protégé |
| **DDoS** | Cloudflare WAF | ✅ Protégé |

### Rate Limiting (Limitation du débit)

| Type | Fenêtre | Requêtes max | Application |
|------|---------|--------------|-------------|
| Strict | 5 minutes | 10 | Connexion, vérification OTP |
| Moyen | 1 heure | 20 | Inscription |
| Général | 15 minutes | 200 | Appels API authentifiés |
| Webhooks | 1 minute | 60 | Webhooks de paiement |

### Mise à jour des dépendances

- **Système d'exploitation:** Mises à jour automatiques activées (Ubuntu unattended-upgrades)
- **Dépendances applicatives:** Revue régulière, audit npm

---

## 5. Accès Internes & Organisation

### Qui a accès aux données utilisateurs ?

| Personne/Rôle | Type d'accès | Justification |
|---------------|--------------|---------------|
| Administrateur système | Accès serveur complet | Maintenance technique |
| Administrateurs plateforme | Interface admin | Gestion des utilisateurs |
| Support client | Lecture profils | Assistance utilisateurs |

### Les accès sont-ils nominativement attribués ?

**Oui.** Chaque accès est lié à un compte nominatif :
- Accès serveur: Compte SSH personnel (`sterling`)
- Accès admin: Compte utilisateur avec rôle `admin`

### Procédures de révocation d'accès

**Départ d'un employé:**
1. Suppression de la clé SSH du serveur
2. Changement des mots de passe partagés
3. Révocation des tokens API
4. Rotation des secrets si nécessaire

**Compromission suspectée:**
1. Désactivation immédiate du compte
2. Rotation de tous les secrets (JWT_SECRET, SERVICE_SECRET)
3. Invalidation forcée de toutes les sessions
4. Analyse des logs d'accès

### Politique interne de sécurité ?

**Oui.** Les mesures incluent :
- Accès serveur limité au personnel autorisé
- Authentification à deux facteurs pour l'accès admin
- Logs d'audit pour les actions sensibles
- Revue régulière des accès

### Prestataires externes avec accès aux données ?

| Prestataire | Données partagées | Finalité | Localisation |
|-------------|-------------------|----------|--------------|
| CinetPay | Téléphone, nom, montant | Paiements Mobile Money | Côte d'Ivoire |
| FeexPay | Téléphone, montant | Paiements Mobile Money | Afrique |
| NOWPayments | Adresse wallet, montant | Paiements crypto | International |
| WhatsApp/Meta | Téléphone, messages | Notifications | International (US/EU) |
| Cloudflare | Trafic web | CDN, sécurité | International |

---

## 6. Cookies, Tracking et Outils Tiers

### Utilisez-vous des cookies ?

| Élément | Type | Finalité | Durée |
|---------|------|----------|-------|
| Token JWT | localStorage | Authentification | 24 heures |
| Préférence langue | localStorage | Localisation UI | Persistant |

**Note:** La plateforme utilise **localStorage** et non des cookies HTTP traditionnels.

### Outils de tracking tiers ?

| Outil | Utilisé ? |
|-------|-----------|
| Google Analytics | **Non** |
| Facebook Pixel | **Non** |
| Mixpanel | **Non** |
| Hotjar | **Non** |

**La plateforme n'utilise aucun outil de tracking tiers.** Le comportement des utilisateurs n'est pas suivi à des fins marketing.

### Consentement des utilisateurs ?

| Type de consentement | Méthode |
|---------------------|---------|
| Conditions d'utilisation | Acceptation à l'inscription |
| Notifications marketing | Opt-in via préférences |
| Bannière cookies | Non requise (pas de cookies de tracking) |

---

## 7. Gestion des Incidents

### Avez-vous déjà subi une fuite de données ?

**Non.** Aucune fuite de données n'a été enregistrée à ce jour.

### Plan de gestion des incidents ?

**Oui.** Procédure en 6 étapes :

1. **Détection:** Logging automatique des activités suspectes
2. **Évaluation:** Analyse des logs pour déterminer l'étendue
3. **Confinement:** Blocage des IPs, révocation des tokens, désactivation des comptes
4. **Notification:** Alerte aux utilisateurs affectés sous 72 heures
5. **Récupération:** Restauration depuis les sauvegardes si nécessaire
6. **Post-mortem:** Documentation de l'incident et améliorations

### Comment détectez-vous une intrusion ?

| Mécanisme | Description |
|-----------|-------------|
| Fail2Ban | Détection et blocage des tentatives de brute-force |
| Logs d'authentification | Échecs de connexion enregistrés avec IP |
| Rate limiting | Violations enregistrées |
| Monitoring serveur | Surveillance des ressources et activités |

**Statistiques Fail2Ban (SSH):**
- Total IPs bannies historiquement: **2 491**
- IPs actuellement bannies: **2**

### Temps de réaction ?

| Incident | Temps de réponse cible |
|----------|----------------------|
| Détection d'intrusion | < 1 heure |
| Notification utilisateurs | < 72 heures |
| Restauration système | < 4 heures |

### Sauvegardes

| Données | Fréquence | Rétention |
|---------|-----------|-----------|
| Bases de données | Quotidienne | 30 jours |
| Configuration | Versionnée (Git) | Indéfinie |

---

## 8. Droits des Utilisateurs

### Les utilisateurs peuvent-ils consulter leurs données ?

**Oui.** Via l'endpoint API: `GET /api/users/me`

L'utilisateur peut consulter toutes ses données personnelles depuis son profil.

### Les utilisateurs peuvent-ils modifier leurs données ?

**Oui.** Via l'endpoint API: `PUT /api/users/me`

Données modifiables : nom, email, téléphone, avatar, préférences, etc.

### Les utilisateurs peuvent-ils supprimer leur compte ?

**Oui.** Via l'endpoint API: `DELETE /api/users/me`

Processus :
1. Suppression logique (soft delete) immédiate
2. Suppression définitive après 30 jours
3. Conservation des transactions 7 ans (obligation légale)

### Durée de conservation des données ?

| Type de données | Durée de conservation |
|-----------------|----------------------|
| Compte utilisateur | Jusqu'à demande de suppression |
| Transactions financières | 7 ans (exigence légale) |
| Messages chat | Durée de vie du compte |
| Notifications | 90 jours |
| Codes OTP | 10 minutes |
| Tokens de réinitialisation | 1 heure |

### Politique de confidentialité accessible ?

**Oui.** Accessible sur le site web et acceptée lors de l'inscription.

### Point de contact pour les demandes ?

| Objet | Contact |
|-------|---------|
| Protection des données | privacy@sniperbuisnesscenter.com |
| Incidents de sécurité | security@sniperbuisnesscenter.com |
| Support général | support@sniperbuisnesscenter.com |

---

## 9. Architecture Technique

### 9.1 Diagramme d'Architecture Générale

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UTILISATEURS                                    │
│                    (Web / Mobile - Cameroun, CI, Sénégal...)                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLOUDFLARE (CDN)                                   │
│                 Protection DDoS │ WAF │ SSL/TLS │ Cache                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SERVEUR (Contabo - Allemagne)                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                          NGINX (Reverse Proxy)                         │  │
│  │                    HTTPS uniquement │ Rate Limiting                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│       ┌──────────────────────────────┼──────────────────────────────┐       │
│       ▼                              ▼                              ▼       │
│  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  ┌─────────┐  ┌─────────┐   │
│  │Frontend │  │Frontend │  │    Gateway      │  │  Chat   │  │ Autres  │   │
│  │  User   │  │  Admin  │  │    Service      │  │ Service │  │Services │   │
│  │ (React) │  │ (React) │  │   (API Port)    │  │         │  │         │   │
│  └─────────┘  └─────────┘  └────────┬────────┘  └─────────┘  └─────────┘   │
│                                      │                                       │
│                    ┌─────────────────┼─────────────────┐                    │
│                    ▼                 ▼                 ▼                    │
│              ┌──────────┐     ┌──────────┐     ┌──────────┐                 │
│              │  User    │     │ Payment  │     │Notifica- │                 │
│              │ Service  │     │ Service  │     │  tion    │                 │
│              └────┬─────┘     └────┬─────┘     └────┬─────┘                 │
│                   │                │                │                        │
│  ┌────────────────┴────────────────┴────────────────┴────────────────────┐  │
│  │                        BASES DE DONNÉES                                │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │  │
│  │  │   MongoDB    │  │    Redis     │  │  PostgreSQL  │                 │  │
│  │  │ (127.0.0.1)  │  │ (127.0.0.1)  │  │ (127.0.0.1)  │                 │  │
│  │  │   Chiffré    │  │    Cache     │  │   Backup     │                 │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         SÉCURITÉ SERVEUR                               │  │
│  │  ✓ Firewall UFW (ports 22, 80, 443 uniquement)                        │  │
│  │  ✓ Fail2Ban (protection brute-force)                                   │  │
│  │  ✓ Mises à jour automatiques                                          │  │
│  │  ✓ Bases de données non exposées (localhost uniquement)               │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
           ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
           │   CinetPay   │  │   FeexPay    │  │  WhatsApp    │
           │   FeexPay    │  │ NOWPayments  │  │   Twilio     │
           │  (Paiements) │  │   (Crypto)   │  │   (Notif)    │
           └──────────────┘  └──────────────┘  └──────────────┘
                         SERVICES EXTERNES
```

### 9.2 Diagramme de Flux des Données

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FLUX DES DONNÉES UTILISATEUR                          │
└─────────────────────────────────────────────────────────────────────────────┘

INSCRIPTION                         PAIEMENT                      RETRAIT
    │                                  │                             │
    ▼                                  ▼                             ▼
┌─────────┐                      ┌─────────┐                   ┌─────────┐
│ Client  │                      │ Client  │                   │ Client  │
│  Web    │                      │  Web    │                   │  Web    │
└────┬────┘                      └────┬────┘                   └────┬────┘
     │ HTTPS                          │ HTTPS                       │ HTTPS
     ▼                                ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE                                      │
│                          (Chiffrement TLS)                                   │
└─────────────────────────────────────────────────────────────────────────────┘
     │                                │                             │
     ▼                                ▼                             ▼
┌─────────┐                      ┌─────────┐                   ┌─────────┐
│ Gateway │                      │ Gateway │                   │ Gateway │
│ Service │                      │ Service │                   │ Service │
└────┬────┘                      └────┬────┘                   └────┬────┘
     │                                │                             │
     ▼                                ▼                             ▼
┌─────────┐                      ┌─────────┐                   ┌─────────┐
│  User   │                      │ Payment │                   │ Payment │
│ Service │                      │ Service │                   │ Service │
└────┬────┘                      └────┬────┘                   └────┬────┘
     │                                │                             │
     ▼                                ▼                             ▼
┌─────────────┐              ┌─────────────────┐           ┌─────────────────┐
│  STOCKÉ:    │              │   PARTAGÉ AVEC: │           │   PARTAGÉ AVEC: │
│  - Nom      │              │   CinetPay:     │           │   CinetPay/     │
│  - Email    │              │   - Téléphone   │           │   FeexPay:      │
│  - Téléphone│              │   - Nom         │           │   - Téléphone   │
│  - Mdp hash │              │   - Montant     │           │   - Montant     │
│  - Pays     │              │   - Pays        │           │   - Opérateur   │
└─────────────┘              └────────┬────────┘           └────────┬────────┘
     │                                │                             │
     ▼                                ▼                             ▼
┌─────────────┐              ┌─────────────────┐           ┌─────────────────┐
│  MongoDB    │              │  Webhook retour │           │  Webhook retour │
│ (chiffré)   │              │  confirmation   │           │  confirmation   │
└─────────────┘              └─────────────────┘           └─────────────────┘
```

---

## Récapitulatif de Conformité

| Exigence | Statut | Commentaire |
|----------|--------|-------------|
| Chiffrement des données au repos | ✅ | MongoDB encryption |
| Chiffrement des données en transit | ✅ | HTTPS/TLS 1.2 & 1.3 |
| Hashage des mots de passe | ✅ | bcrypt, 10 rounds |
| Journalisation des accès | ✅ | Morgan + logs Nginx |
| Limitation du débit | ✅ | Plusieurs niveaux |
| Validation des entrées | ✅ | Middleware personnalisé |
| Contrôle d'accès par rôles | ✅ | 4 rôles définis |
| Headers de sécurité | ✅ | Helmet.js |
| Pare-feu | ✅ | UFW actif, ports minimaux |
| Prévention des intrusions | ✅ | Fail2Ban (SSH, MongoDB, PostgreSQL) |
| Protection CDN/DDoS | ✅ | Cloudflare |
| Mises à jour automatiques | ✅ | Ubuntu unattended-upgrades |
| Isolation des services | ✅ | BDs sur localhost uniquement |
| Certificat SSL/TLS | ✅ | Let's Encrypt, TLSv1.2+ |
| Politique de confidentialité | ✅ | Publiée sur le site |
| Procédure de violation de données | ✅ | Documentée |
| Droits des utilisateurs (accès, modification, suppression) | ✅ | API disponible |

---

**Document préparé pour audit de conformité sécurité.**

*Sniper Business Center - Janvier 2026*
