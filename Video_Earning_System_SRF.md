# SYSTÈME DE GAINS VIDÉO - SBC MICROSERVICES
## Document des Exigences Système et Fonctionnalités (SRF)

---

### INFORMATIONS DU PROJET
- **Nom du Projet**: Système de Gains Vidéo SBC
- **Version**: 1.0
- **Date**: Décembre 2024
- **Client**: Sniper Business Center
- **Monnaie**: FCFA (Franc CFA)

---

## 1. RÉSUMÉ EXÉCUTIF

Le Système de Gains Vidéo est une fonctionnalité complète permettant aux utilisateurs de la plateforme SBC de gagner de l'argent en regardant des vidéos. Le système intègre un programme de parrainage à niveaux multiples avec des taux de gains progressifs basés sur le nombre de parrainages actifs.

### 1.1 OBJECTIFS PRINCIPAUX
- Augmenter l'engagement des utilisateurs sur la plateforme
- Créer une source de revenus passive pour les utilisateurs
- Développer un système de fidélisation basé sur le parrainage
- Générer des revenus publicitaires pour la plateforme

---

## 2. FONCTIONNALITÉS PRINCIPALES

### 2.1 SYSTÈME DE GAINS VIDÉO

#### 2.1.1 Structure de Gains
- **Taux de Base**: 25 FCFA par vidéo complètement regardée
- **Système de Niveaux**:
  - **Niveau Bronze**: 50 FCFA/vidéo (10 parrainages actifs)
  - **Niveau Argent**: 75 FCFA/vidéo (30 parrainages actifs)
  - **Niveau Or**: 150 FCFA/vidéo (130 parrainages actifs)

#### 2.1.2 Validation de Visionnage
- Vérification de visionnage complet (100% de la vidéo)
- Détection anti-fraude (vitesse de lecture, interactions)
- Limite de vidéos par jour par utilisateur
- Système de points de vérification pendant le visionnage

#### 2.1.3 Gestion des Soldes
- **Solde Vidéo Séparé**: Indépendant du solde principal
- **Minimum de Retrait**: 5,000 FCFA
- **Historique des Gains**: Tracking complet des gains vidéo
- **Transfert vers Solde Principal**: Option de transfert disponible

### 2.2 SYSTÈME DE NIVEAUX ET PARRAINAGES

#### 2.2.1 Critères de Niveaux
- **Maintenance Mensuelle**: Les niveaux doivent être maintenus chaque mois
- **Parrainages Actifs**: Seuls les parrains avec activité récente comptent
- **Dégradation Automatique**: Retour au niveau inférieur si critères non remplis

#### 2.2.2 Suivi des Parrainages
- Dashboard des parrainages en temps réel
- Notifications de progression de niveau
- Historique des gains par parrain
- Statistiques de performance mensuelle

### 2.3 PANEL D'ADMINISTRATION VIDÉO

#### 2.3.1 Gestion de Contenu
- Upload et gestion des vidéos
- Catégorisation du contenu
- Contrôle de la durée et qualité
- Programmation des diffusions

#### 2.3.2 Analytics et Contrôle
- Statistiques de visionnage détaillées
- Contrôle des coûts et budgets
- Détection de fraude et abus
- Rapports financiers automatisés

---

## 3. EXIGENCES TECHNIQUES

### 3.1 ARCHITECTURE SYSTÈME

#### 3.1.1 Microservices Requis
- **Video-Management-Service**: Gestion des liens YouTube et validation
- **Earning-Service**: Calculs de gains et niveaux
- **Video-Analytics-Service**: Tracking et analytics des visionnages
- **Video-Payment-Service**: Gestion des paiements vidéo

#### 3.1.2 Infrastructure Technique - **APPROCHE YOUTUBE**
- **YouTube Player API**: Intégration native dans l'application mobile
- **Tracking Custom**: Système de vérification de visionnage complet
- **Base de Données**: MongoDB pour les analytics et liens vidéo
- **Cache Redis**: Performance et sessions utilisateurs
- **Queue System**: Traitement asynchrone des gains
- **Anti-Navigation System**: Prévention de la navigation pendant visionnage

### 3.2 SÉCURITÉ ET ANTI-FRAUDE

#### 3.2.1 Mesures de Sécurité
- Détection de bots et scripts automatisés
- Limitation de taux par IP et utilisateur
- Validation cryptographique des sessions de visionnage
- Monitoring en temps réel des anomalies

#### 3.2.2 Conformité
- Respect du RGPD pour les données utilisateurs
- Compliance avec les régulations locales
- Audit trail complet des transactions

### 3.3 IMPLÉMENTATION YOUTUBE - DÉTAILS TECHNIQUES

#### 3.3.1 Intégration YouTube Player API
- **Mobile App Integration**: YouTube Player API pour Android/iOS
- **Web Integration**: YouTube IFrame Player API pour interface web
- **Contrôles Personnalisés**: Désactivation des contrôles utilisateur pendant le visionnage
- **Mode Immersif**: Affichage plein écran obligatoire pour validation

#### 3.3.2 Système de Tracking Avancé
- **Points de Contrôle**: Vérification toutes les 10 secondes du progrès
- **Détection de Focus**: Monitoring si l'app est au premier plan
- **Prévention Multi-fenêtres**: Blocage d'ouverture de nouvelles fenêtres
- **Validation Cryptographique**: Tokens de session sécurisés

#### 3.3.3 Gestion des Liens YouTube
- **Validation URL**: Vérification automatique des liens YouTube
- **Extraction Métadonnées**: Durée, titre, description automatiques
- **Catégorisation**: Classification automatique du contenu
- **Modération**: Système de validation avant publication

#### 3.3.4 Avantages de l'Approche YouTube
- **Infrastructure Zéro**: Pas de serveurs de streaming nécessaires
- **CDN Global**: YouTube gère la distribution mondiale
- **Qualité Adaptative**: Ajustement automatique selon la connexion
- **Compatibilité Universelle**: Fonctionne sur tous les appareils
- **Contenu Illimité**: Accès à la bibliothèque YouTube existante

---

## 4. ANALYSE FINANCIÈRE

### 4.1 COÛTS DE DÉVELOPPEMENT

| Composant | Durée | Coût FCFA |
|-----------|-------|-----------|
| **Développement Principal** | 10 semaines | **600,000** |
| Architecture des microservices | 2 semaines | Inclus |
| Interface utilisateur | 2 semaines | Inclus |
| Panel d'administration | 2 semaines | Inclus |
| Système anti-fraude | 2 semaines | Inclus |
| Tests et déploiement | 2 semaines | Inclus |

### 4.2 COÛTS D'INFRASTRUCTURE MENSUELLE - **APPROCHE YOUTUBE**

| Service | Coût Mensuel FCFA |
|---------|-------------------|
| **YouTube API Calls** | 30,000 - 90,000 |
| Serveurs et Cloud | 60,000 - 120,000 |
| Base de données | 30,000 - 60,000 |
| Monitoring et Analytics | 18,000 - 36,000 |
| **TOTAL INFRASTRUCTURE** | **138,000 - 306,000** |

#### 4.2.1 Économies Réalisées vs Approche Traditionnelle
- **CDN Éliminé**: -240,000 à -600,000 FCFA/mois
- **Stockage Vidéo Éliminé**: -120,000 à -300,000 FCFA/mois  
- **Bande Passante Réduite**: -60,000 à -180,000 FCFA/mois
- **ÉCONOMIES TOTALES**: **420,000 - 1,080,000 FCFA/mois**

### 4.3 COÛTS OPÉRATIONNELS MENSUELS

| Poste | Coût Mensuel FCFA |
|-------|-------------------|
| **Maintenance Technique** | 480,000 |
| Support et monitoring | 240,000 |
| Mises à jour de sécurité | 120,000 |
| Optimisations performance | 120,000 |

### 4.4 INVESTISSEMENT CONTENU CLIENT - **APPROCHE YOUTUBE**

| Type de Contenu | Coût Mensuel FCFA |
|------------------|-------------------|
| **Curation de Contenu YouTube** | 120,000 - 300,000 |
| Modération et sélection | 60,000 - 150,000 |
| Validation qualité | 30,000 - 90,000 |
| Catégorisation avancée | 30,000 - 60,000 |

#### 4.4.1 Avantages Financiers vs Production Traditionnelle
- **Production Éliminée**: -600,000 à -1,500,000 FCFA/mois
- **Licences Évitées**: -300,000 à -900,000 FCFA/mois  
- **Équipement Non-Requis**: -300,000 à -600,000 FCFA/mois
- **ÉCONOMIES CONTENU**: **1,200,000 - 3,000,000 FCFA/mois**

#### 4.4.2 Sources de Contenu YouTube
- **Contenu Éducatif**: Cours, tutoriels, formations
- **Divertissement**: Comédies, sketches, émissions
- **Actualités**: News, documentaires, reportages  
- **Sponsorisé**: Contenu partenaire spécifique SBC

### 4.5 ESTIMATION DES PAIEMENTS UTILISATEURS

#### 4.5.1 Scénario de Base (1,000 Utilisateurs Actifs)
| Niveau | Utilisateurs | Vidéos/Jour | Gain/Vidéo | Coût Journalier | Coût Mensuel |
|--------|-------------|-------------|------------|----------------|--------------|
| Bronze (Base) | 700 | 5 | 25 FCFA | 87,500 | 2,625,000 |
| Argent | 200 | 5 | 50 FCFA | 50,000 | 1,500,000 |
| Or | 80 | 5 | 75 FCFA | 30,000 | 900,000 |
| Platine | 20 | 5 | 150 FCFA | 15,000 | 450,000 |
| **TOTAL PAIEMENTS** | - | - | - | **182,500** | **5,475,000** |

#### 4.5.2 Scénario de Croissance (5,000 Utilisateurs Actifs)
- **Paiements Mensuels Estimés**: 27,375,000 FCFA
- **Croissance Progressive**: +20% par trimestre

---

## 5. MODÈLE DE REVENUS

### 5.1 SOURCES DE REVENUS

| Source | Revenu Mensuel Estimé FCFA |
|--------|----------------------------|
| **Publicités Vidéo** | 8,000,000 - 15,000,000 |
| Sponsoring de contenu | 3,000,000 - 6,000,000 |
| Partenariats marques | 2,000,000 - 4,000,000 |
| Commission sur retraits | 200,000 - 500,000 |

### 5.2 RENTABILITÉ PROJETÉE

#### 5.2.1 Analyse de Seuil de Rentabilité
- **Point Mort**: 2,500 utilisateurs actifs
- **ROI Positif**: À partir du 6ème mois
- **Rentabilité Optimale**: 5,000+ utilisateurs actifs

---

## 6. PLAN DE DÉPLOIEMENT

### 6.1 PHASES DE DÉVELOPPEMENT

#### Phase 1: MVP (4 semaines) - 240,000 FCFA
- Fonctionnalités de base de visionnage
- Système de gains simple
- Interface utilisateur basique

#### Phase 2: Système Complet (6 semaines) - 360,000 FCFA
- Système de niveaux complet
- Panel d'administration
- Anti-fraude avancé

### 6.2 TIMELINE DE DÉPLOIEMENT

| Semaine | Activité | Livrable |
|---------|----------|----------|
| 1-2 | Architecture et Setup | Infrastructure de base |
| 3-4 | Développement MVP | Version beta testable |
| 5-6 | Système de niveaux | Fonctionnalités avancées |
| 7-8 | Panel admin et anti-fraude | Système complet |
| 9-10 | Tests et optimisation | Version production |

---

## 7. RISQUES ET MITIGATION

### 7.1 RISQUES TECHNIQUES

| Risque | Impact | Probabilité | Mitigation |
|--------|--------|-------------|------------|
| **Fraude Massive** | Élevé | Moyen | Système anti-fraude robuste |
| **Politiques YouTube** | Moyen | Faible | Conformité stricte aux ToS |
| **API YouTube Limitations** | Moyen | Faible | Monitoring et quotas |
| Bugs de Paiement | Très Élevé | Faible | Tests exhaustifs |

### 7.2 RISQUES FINANCIERS

| Risque | Impact | Mitigation |
|--------|--------|------------|
| **Coûts Infrastructure** | Faible | YouTube gère l'infrastructure |
| Paiements Abusifs | Élevé | Limites strictes et validation |
| Revenus Insuffisants | Moyen | Modèle de revenus diversifié |

### 7.3 RISQUES SPÉCIFIQUES YOUTUBE

| Risque | Impact | Probabilité | Mitigation |
|--------|--------|-------------|------------|
| **Vidéos Supprimées** | Moyen | Moyen | Sauvegarde multi-sources |
| **Changements API** | Faible | Faible | Veille technologique |
| **Restriction Géographique** | Moyen | Faible | Validation par pays |

---

## 8. RECOMMANDATIONS

### 8.1 APPROCHE RECOMMANDÉE
1. **Démarrage MVP**: Commencer avec un système simplifié
2. **Test Utilisateurs**: Groupe de beta-testeurs limité
3. **Échelle Progressive**: Augmentation graduelle du nombre d'utilisateurs
4. **Monitoring Continu**: Surveillance des métriques clés

### 8.2 FACTEURS DE SUCCÈS CRITIQUES
- **Contenu de Qualité**: Investissement dans du contenu engageant
- **Expérience Utilisateur**: Interface intuitive et rapide
- **Sécurité Robuste**: Protection contre la fraude
- **Support Client**: Assistance réactive aux utilisateurs

---

## 9. CONCLUSION

Le Système de Gains Vidéo utilisant l'**approche YouTube** représente une opportunité stratégique exceptionnelle pour SBC. Cette approche révolutionnaire élimine les coûts d'infrastructure vidéo traditionnels tout en offrant une expérience utilisateur premium basée sur l'écosystème YouTube.

### 9.1 AVANTAGES ÉCONOMIQUES MAJEURS
- **Investissement Initial**: 600,000 FCFA (inchangé)
- **Économies Infrastructure**: 420,000 - 1,080,000 FCFA/mois
- **Économies Contenu**: 1,200,000 - 3,000,000 FCFA/mois
- **ÉCONOMIES TOTALES**: **1,620,000 - 4,080,000 FCFA/mois**

### 9.2 RETOUR SUR INVESTISSEMENT PROJETÉ - **APPROCHE YOUTUBE**
- **Investissement Initial**: 600,000 FCFA
- **Break-even**: 3 mois (vs 6 mois traditionnel)
- **ROI Année 1**: +300% à +500% (vs +150% à +300%)
- **Revenus Nets Mensuels (An 1)**: 5,000,000 - 12,000,000 FCFA

### 9.3 FACTEURS DE SUCCÈS YOUTUBE
- **Contenu Illimité**: Accès à millions de vidéos YouTube
- **Infrastructure Robuste**: Fiabilité mondiale de YouTube
- **Coûts Maîtrisés**: Pas d'investissement infrastructure vidéo
- **Évolutivité Infinie**: Croissance sans contraintes techniques

---

**Document préparé par**: Équipe Technique SBC  
**Date de révision**: Décembre 2024  
**Statut**: Version Finale pour Approbation

---

### ANNEXES

#### A. Spécifications Techniques Détaillées - **IMPLÉMENTATION YOUTUBE**

##### A.1 YouTube Player API Integration
```javascript
// Exemple d'intégration mobile (React Native)
import YouTubePlayer from 'react-native-youtube-iframe';

const VideoEarningScreen = () => {
  const [watchProgress, setWatchProgress] = useState(0);
  const [sessionToken, setSessionToken] = useState(null);
  
  const handleProgress = (progress) => {
    // Tracking toutes les 10 secondes
    if (progress % 10 === 0) {
      validateWatchProgress(sessionToken, progress);
    }
  };
  
  return (
    <YouTubePlayer
      videoId={currentVideo.youtubeId}
      play={true}
      onChangeState={handleStateChange}
      onProgress={handleProgress}
      webViewStyle={{ opacity: 0.99 }} // Prévention screenshot
      initialPlayerParams={{
        controls: false, // Désactivation contrôles
        modestbranding: 1,
        rel: 0
      }}
    />
  );
};
```

##### A.2 Système de Validation Anti-Fraude
```javascript
// Service de validation de visionnage
class VideoWatchValidator {
  constructor() {
    this.checkpoints = [];
    this.startTime = Date.now();
    this.focusLost = false;
  }
  
  validateCheckpoint(progress, token) {
    const checkpoint = {
      progress,
      timestamp: Date.now(),
      token: this.generateSecureToken(progress),
      deviceFingerprint: this.getDeviceFingerprint(),
      appInForeground: this.isAppInForeground()
    };
    
    // Validation côté serveur
    return this.sendCheckpointToServer(checkpoint);
  }
  
  calculateEarnings(videoCompleted, userTier) {
    if (!this.isValidWatch()) return 0;
    
    const baseRate = 25; // FCFA
    const tierMultiplier = this.getTierMultiplier(userTier);
    
    return baseRate * tierMultiplier;
  }
}
```

##### A.3 Panel d'Administration YouTube
```javascript
// Interface de gestion des vidéos YouTube
const AdminVideoManager = () => {
  const addYouTubeVideo = async (youtubeUrl) => {
    // Validation et extraction métadonnées
    const videoData = await extractYouTubeMetadata(youtubeUrl);
    
    // Validation contenu (durée, langue, approprié)
    const contentValid = await validateContent(videoData);
    
    if (contentValid) {
      await saveVideoToDatabase({
        youtubeId: videoData.id,
        title: videoData.title,
        duration: videoData.duration,
        category: videoData.category,
        earnings: calculateVideoEarnings(videoData.duration),
        status: 'pending_review'
      });
    }
  };
  
  return (
    <div>
      <VideoUrlInput onSubmit={addYouTubeVideo} />
      <VideoModerationQueue />
      <EarningsCalculator />
    </div>
  );
};
```

#### B. Maquettes Interface Utilisateur - **VERSION YOUTUBE**
- Interface de visionnage YouTube immersive
- Tracking de progression en temps réel
- Tableau de bord des gains par vidéo
- Système de niveaux et parrainages

#### C. Architecture de Base de Données - **SCHEMA YOUTUBE**
```javascript
// Collection: youtube_videos
{
  _id: ObjectId,
  youtubeId: String, // ID YouTube unique
  title: String,
  description: String,
  duration: Number, // en secondes
  category: String,
  language: String,
  earningsRate: Number, // FCFA par visionnage complet
  status: String, // active, inactive, reviewing
  addedBy: ObjectId, // Admin qui a ajouté
  createdAt: Date,
  updatedAt: Date,
  analytics: {
    totalViews: Number,
    completionRate: Number,
    averageWatchTime: Number,
    fraudAttempts: Number
  }
}

// Collection: video_sessions
{
  _id: ObjectId,
  userId: ObjectId,
  videoId: ObjectId,
  youtubeId: String,
  sessionToken: String,
  startTime: Date,
  endTime: Date,
  watchProgress: Number, // 0-100%
  checkpoints: [
    {
      progress: Number,
      timestamp: Date,
      validated: Boolean,
      deviceFingerprint: String
    }
  ],
  earningsAwarded: Number,
  status: String, // watching, completed, abandoned, fraud
  fraudScore: Number
}
```

#### D. Plan de Test et Validation - **YOUTUBE INTEGRATION**
1. **Tests YouTube API**: Validation intégration player
2. **Tests Anti-Fraude**: Simulation tentatives de fraude
3. **Tests Performance**: Charge utilisateur simultanée
4. **Tests Gains**: Validation calculs et paiements
5. **Tests Conformité**: Respect politiques YouTube

#### E. Procédures de Déploiement - **APPROCHE YOUTUBE**
1. **Configuration YouTube API**: Clés et quotas
2. **Déploiement Backend**: Services de tracking
3. **Déploiement Mobile**: Intégration player natif
4. **Formation Admin**: Gestion contenu YouTube
5. **Monitoring**: Surveillance performance et fraude 