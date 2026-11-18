/**
 * Starter help articles for the member « Aide » and the assistant (seeded by
 * scripts/seed-kb.ts). They describe the app as it is on 2026-11-18, screen
 * names included. Rules for this text, because the assistant answers from it:
 *  - no price, fee, amount, or delay about money (the assistant must never
 *    state one, and its safety check refuses an answer that does);
 *  - never ask for a password or a code;
 *  - point to the screen that shows the member's real situation (Mes retraits,
 *    Vérifier mon paiement) instead of describing a status.
 * SBC edits and republishes them from the agent app (Contenus); the seed never
 * overwrites an article that already exists.
 */
export interface StarterArticle {
    slug: string;
    category: 'compte_acces' | 'activation_paiement' | 'retrait' | 'commissions' | 'vues_whatsapp' | 'technique' | 'autre';
    tags: string[];
    title: string;
    summary: string;
    body: string;
}

export const KB_STARTER: StarterArticle[] = [
    // ---------- Activation / paiement ----------
    {
        slug: 'payer-son-pack',
        category: 'activation_paiement',
        tags: ['payer', 'pack', 'abonnement', 'activer', 'activation', 'classique', 'cible', 'mobile money', 'crypto'],
        title: 'Payer mon pack et activer mon compte',
        summary: 'Les étapes pour payer votre pack depuis l’application.',
        body: [
            'Votre compte s’active quand le paiement de votre pack est confirmé par l’opérateur de paiement.',
            '- Ouvrez Profil, puis Mon Abonnement.\n- Choisissez votre pack.\n- Choisissez votre moyen de paiement (Mobile Money ou crypto) et suivez la page de paiement.\n- Validez le paiement sur votre téléphone quand l’opérateur vous le demande.',
            'Le compte s’active tout seul dès que l’opérateur confirme le paiement. Vous n’avez rien à envoyer à SBC.',
            'Votre parrain peut aussi activer votre compte depuis son solde d’activation.',
            'Vous avez payé mais votre compte n’est toujours pas activé ? Ouvrez Aide, puis « Mon compte n’est pas activé », et touchez « Vérifier ce paiement ».',
        ].join('\n\n'),
    },
    {
        slug: 'compte-pas-active-apres-paiement',
        category: 'activation_paiement',
        tags: ['pas active', 'non active', 'activation', 'paye', 'payé', 'paiement', 'bloque', 'abonnement'],
        title: 'J’ai payé mais mon compte n’est pas activé',
        summary: 'Vérifiez votre paiement directement auprès de l’opérateur, depuis l’Aide.',
        body: [
            'Ouvrez Aide, puis « Mon compte n’est pas activé ». Vos paiements récents s’affichent.',
            '- Touchez « Vérifier ce paiement » : SBC redemande à l’opérateur s’il a reçu votre paiement. S’il est confirmé, le compte s’active tout de suite.\n- Si le paiement n’est pas dans la liste, saisissez la référence reçue par SMS de votre opérateur et touchez « Vérifier cette référence ».\n- « Paiement non terminé » veut dire que le paiement n’a jamais été validé chez l’opérateur : payez à nouveau votre pack. Si votre compte Mobile Money a quand même été débité, touchez « De l’argent a quand même été débité ».',
            'Si l’opérateur ne trouve pas le paiement, une demande est ouverte pour vous et un agent vérifie. Suivez sa réponse dans Aide, « Mes demandes ».',
        ].join('\n\n'),
    },
    {
        slug: 'solde-activation-filleul',
        category: 'activation_paiement',
        tags: ['solde activation', 'activer filleul', 'sponsoriser', 'parrain', 'filleul', 'activation'],
        title: 'Activer un filleul avec mon solde d’activation',
        summary: 'Le solde d’activation sert à payer le pack de vos filleuls.',
        body: [
            'Le solde d’activation est un solde à part, réservé à l’activation de vos filleuls.',
            '- Ouvrez Profil, puis « Solde d’activation » (ou Wallet, puis Solde d’Activation).\n- Choisissez le filleul à activer et le pack.\n- Confirmez : le compte du filleul s’active, et les commissions sont versées comme pour un paiement normal.',
            'Si l’activation échoue, le montant revient sur votre solde d’activation.',
        ].join('\n\n'),
    },

    // ---------- Retraits ----------
    {
        slug: 'faire-un-retrait',
        category: 'retrait',
        tags: ['faire un retrait', 'retirer', 'comment retirer', 'retrait', 'mobile money', 'crypto', 'wallet'],
        title: 'Faire un retrait',
        summary: 'Retirer votre solde vers Mobile Money ou vers un portefeuille crypto.',
        body: [
            '- Ouvrez Wallet, puis Retrait.\n- Choisissez Mobile Money ou crypto. La première fois, enregistrez votre numéro Mobile Money et votre opérateur (ou votre adresse crypto).\n- Saisissez le montant. Pour Mobile Money, il doit être un multiple de 5.\n- Un code de confirmation vous est envoyé par email : saisissez-le pour valider la demande.',
            'Ensuite, l’équipe SBC valide la demande et l’argent part vers votre compte. Suivez chaque étape dans Aide, « Mes retraits ».',
            'Tant qu’un retrait n’est pas terminé, vous ne pouvez pas en demander un autre. Le montant du retrait est mis de côté sur votre solde pendant ce temps.',
            'Ne communiquez jamais votre code de confirmation : aucun agent SBC ne vous le demandera.',
        ].join('\n\n'),
    },
    {
        slug: 'statut-de-mon-retrait',
        category: 'retrait',
        tags: ['statut', 'en cours', 'bloque', 'echoue', 'refuse', 'expire', 'pas recu', 'pas arrive', 'arrive', 'mes retraits'],
        title: 'Comprendre le statut de mon retrait',
        summary: 'Ce que veut dire chaque statut affiché dans « Mes retraits ».',
        body: [
            'Ouvrez Aide, puis « Mon retrait est bloqué » ou « Mes retraits » : chaque retrait affiche le statut donné par l’opérateur de paiement.',
            '- Code à confirmer : saisissez le code reçu par email, sinon rien ne part.\n- En validation : l’équipe SBC doit encore valider la demande.\n- Envoyé à l’opérateur, Chez l’opérateur : l’opérateur traite le retrait.\n- Effectué : l’opérateur a confirmé l’envoi.\n- Échoué : l’opérateur a refusé le retrait, votre solde n’a pas été débité.\n- Refusé ou Expiré : le retrait n’a pas été validé, le montant est de nouveau disponible.\n- En vérification : l’opérateur n’a pas encore donné de réponse définitive. Votre argent reste réservé et un agent vérifie.',
            'Un retrait « Effectué » que vous n’avez pas reçu : vérifiez le numéro de réception, puis touchez le retrait et « Écrire à un agent à propos de ce retrait ».',
        ].join('\n\n'),
    },
    {
        slug: 'retraits-bloques-changement-contact',
        category: 'retrait',
        tags: ['retrait bloque', 'changement email', 'changement numero', 'securite', 'retraits bloques'],
        title: 'Mes retraits sont bloqués après un changement d’email ou de numéro',
        summary: 'Un blocage de sécurité temporaire, qui se lève tout seul.',
        body: [
            'Par sécurité, les retraits sont bloqués pendant 48 heures après un changement de l’email ou du numéro de téléphone du compte. Une alerte est envoyée à l’ancienne adresse email.',
            'Ce blocage protège votre argent si quelqu’un a pris le contrôle de votre compte. Il se lève automatiquement, vous n’avez rien à faire.',
            'Vous n’êtes pas à l’origine du changement ? Écrivez tout de suite à un agent depuis Aide.',
        ].join('\n\n'),
    },

    // ---------- Compte & accès ----------
    {
        slug: 'code-de-connexion-non-recu',
        category: 'compte_acces',
        tags: ['code', 'code non recu', 'otp', 'connexion', 'email', 'spam', 'renvoyer', 'code verification'],
        title: 'Je ne reçois pas le code de connexion',
        summary: 'Où chercher le code, et quand le renvoyer.',
        body: [
            '- Regardez dans les dossiers Spam, Courrier indésirable et Promotions de votre boîte email.\n- Attendez la fin du compte à rebours avant de toucher « Renvoyer » : un nouveau code ne part qu’une fois par minute.\n- Vérifiez que vous avez saisi le bon email ou le bon numéro sur l’écran de connexion.\n- Les majuscules et les minuscules du code n’ont pas d’importance.',
            'Utilisez toujours le dernier code reçu. Un code ne sert qu’une fois.',
            'Toujours rien ? Écrivez à un agent depuis Aide, sans jamais indiquer de code ni de mot de passe dans votre message.',
        ].join('\n\n'),
    },
    {
        slug: 'mot-de-passe-oublie',
        category: 'compte_acces',
        tags: ['mot de passe', 'mot de passe oublie', 'oublie', 'reinitialiser', 'changer mot de passe', 'connexion', 'password'],
        title: 'J’ai oublié mon mot de passe, ou je veux le changer',
        summary: 'Réinitialiser ou modifier votre mot de passe vous-même.',
        body: [
            'Mot de passe oublié :\n- Sur l’écran de connexion, touchez « Mot de passe oublié ? ».\n- Saisissez votre email ou votre numéro de téléphone.\n- Saisissez le code reçu, puis choisissez un nouveau mot de passe.',
            'Vous êtes connecté et voulez changer de mot de passe : ouvrez Profil, puis « Modifier mon mot de passe ».',
            'SBC ne vous demandera jamais votre mot de passe, ni par message, ni par téléphone, ni dans une demande d’aide.',
        ].join('\n\n'),
    },
    {
        slug: 'changer-email-ou-numero',
        category: 'compte_acces',
        tags: ['changer email', 'modifier email', 'changer numero', 'modifier numero', 'telephone', 'contact', 'profil'],
        title: 'Changer mon email ou mon numéro de téléphone',
        summary: 'Le changement se fait vous-même, avec un code de confirmation.',
        body: [
            '- Ouvrez Profil, puis « Modifier mon email », ou « Modifier le profil » pour le numéro. Le raccourci Aide, « Changer mon email ou mon téléphone », mène aux deux.\n- Saisissez la nouvelle adresse ou le nouveau numéro (pour l’email, votre mot de passe vous est aussi demandé).\n- Saisissez le code de confirmation reçu.',
            'Après un changement, les retraits sont bloqués 48 heures par sécurité, et une alerte part vers l’ancienne adresse email.',
            'Vous n’avez plus accès à votre ancien email ni à votre ancien numéro ? Ouvrez Aide, « Changer mon email ou mon téléphone », puis « Je n’ai plus accès à mon email ou à mon numéro » : un agent vérifiera votre identité avant tout changement.',
        ].join('\n\n'),
    },
    {
        slug: 'proteger-mon-compte',
        category: 'compte_acces',
        tags: ['securite', 'pirate', 'piratage', 'arnaque', 'compte vole', 'proteger', 'hack'],
        title: 'Protéger mon compte',
        summary: 'Les bons réflexes contre les arnaques et le piratage.',
        body: [
            '- Ne donnez jamais votre mot de passe ni un code reçu par email ou par SMS, même à quelqu’un qui dit travailler pour SBC.\n- Un agent SBC ne vous demande jamais de code, de mot de passe ou de paiement pour « débloquer » votre compte.\n- Utilisez un mot de passe que vous n’utilisez nulle part ailleurs.',
            'Vous recevez une alerte de changement d’email ou de numéro que vous n’avez pas faite, ou vous pensez que votre compte est piraté ? Changez votre mot de passe tout de suite et écrivez à un agent depuis Aide.',
        ].join('\n\n'),
    },
    {
        slug: 'mes-donnees-personnelles',
        category: 'compte_acces',
        tags: ['donnees personnelles', 'supprimer compte', 'telecharger mes donnees', 'confidentialite', 'vie privee', 'contacts'],
        title: 'Mes données personnelles : télécharger, limiter, supprimer',
        summary: 'Vos droits sur vos données, depuis Profil.',
        body: [
            'Ouvrez Profil, puis « Mes données personnelles ».',
            '- « Télécharger mes données » : un fichier avec les informations de votre compte.\n- Vous pouvez choisir de ne plus figurer dans les fichiers de contacts partagés entre membres.\n- « Supprimer mon compte » : la suppression est définitive et demande votre mot de passe.',
            'La politique de confidentialité, accessible en bas des pages de l’application, explique comment SBC utilise vos données.',
        ].join('\n\n'),
    },

    // ---------- Parrainage / commissions ----------
    {
        slug: 'partager-mon-lien-de-parrainage',
        category: 'commissions',
        tags: ['parrainage', 'lien parrainage', 'code parrain', 'inviter', 'rejoindre', 'inscrire', 'partager', 'affiliation', 'filleul'],
        title: 'Partager mon lien de parrainage',
        summary: 'Inviter quelqu’un avec votre lien ou votre code parrain.',
        body: [
            '- Ouvrez Profil.\n- Touchez « Copier mon lien » pour copier votre lien d’inscription, ou « Copier mon code parrain ».\n- Envoyez-le à la personne que vous invitez.',
            'La personne qui s’inscrit avec votre lien devient votre filleul. Vous la retrouvez dans Profil, « Mes filleuls ».',
        ].join('\n\n'),
    },
    {
        slug: 'mes-filleuls',
        category: 'commissions',
        tags: ['filleuls', 'mes filleuls', 'parrainage', 'equipe', 'reseau', 'relance'],
        title: 'Voir et suivre mes filleuls',
        summary: 'La liste de vos filleuls et leur statut.',
        body: [
            'Ouvrez Profil, puis « Mes filleuls ». Vous voyez qui s’est inscrit avec votre lien, et qui a activé son compte.',
            'Pour encourager les filleuls qui n’ont pas encore activé leur compte, utilisez la Relance (Profil, puis Relance) : SBC leur envoie des messages à votre place.',
            'Vous pouvez activer vous-même un filleul avec votre solde d’activation.',
        ].join('\n\n'),
    },
    {
        slug: 'commission-non-recue',
        category: 'commissions',
        tags: ['commission', 'commission pas recue', 'gain', 'parrainage', 'solde'],
        title: 'Une commission n’est pas arrivée',
        summary: 'Ce qu’il faut vérifier avant d’écrire à un agent.',
        body: [
            'Une commission est versée quand le paiement du pack de votre filleul est confirmé par l’opérateur, pas au moment de son inscription.',
            '- Vérifiez dans Profil, « Mes filleuls », que le filleul a bien activé son compte.\n- Regardez l’historique de votre Wallet.',
            'Le filleul a activé son compte mais la commission n’apparaît pas ? Écrivez à un agent depuis Aide avec le nom du filleul.',
        ].join('\n\n'),
    },

    // ---------- Ads Network / vues WhatsApp ----------
    {
        slug: 'diffuseur-publier-une-campagne',
        category: 'vues_whatsapp',
        tags: ['diffuseur', 'campagne', 'statut', 'whatsapp', 'publier', 'ads network', 'accepter'],
        title: 'Diffuseur : accepter une campagne et publier le statut',
        summary: 'Les étapes pour publier une campagne Ads Network sur votre statut WhatsApp.',
        body: [
            'Les campagnes sont proposées à plusieurs diffuseurs : les premiers à accepter les obtiennent. Une campagne test, obligatoire, mesure d’abord votre audience réelle et débloque les campagnes rémunérées.',
            '- Ouvrez Ads Network, espace diffuseur, et acceptez une campagne.\n- Touchez « Publier sur votre statut » : l’image est téléchargée et le texte copié.\n- Publiez-les sur votre statut WhatsApp, avec le texte complet.\n- Publiez le jour 1 dans les 24 heures qui suivent l’acceptation, puis suivez les jours indiqués dans la campagne.',
            'Ne masquez pas le statut à vos contacts : les vues comptent pour la vérification.',
        ].join('\n\n'),
    },
    {
        slug: 'diffuseur-preuve-video',
        category: 'vues_whatsapp',
        tags: ['preuve', 'video', 'vues', 'filmer', 'statut', 'diffuseur', 'verification', 'taille', 'poids', 'maximum', 'trop lourde'],
        title: 'Diffuseur : envoyer la preuve vidéo de vos vues',
        summary: 'Comment filmer la preuve des vues de votre statut.',
        body: [
            '- Dans la campagne, générez le code affiché par l’application.\n- Filmez le code affiché, puis ouvrez WhatsApp et montrez les vues de votre statut.\n- Envoyez la vidéo depuis la campagne.',
            'La vidéo doit faire moins de 50 Mo : filmez court, le code puis les vues suffisent.',
            'Les preuves sont vérifiées par l’équipe SBC dans l’ordre d’arrivée. Une question sur une preuve ? Ouvrez Aide, « Ma preuve de vues WhatsApp ».',
        ].join('\n\n'),
    },
    {
        slug: 'annonceur-sans-pack',
        category: 'vues_whatsapp',
        tags: ['annonceur', 'publicite', 'campagne', 'ads network', 'sans pack', 'creer campagne'],
        title: 'Faire de la publicité avec Ads Network (annonceur)',
        summary: 'Un compte annonceur n’a pas besoin du pack SBC.',
        body: [
            'Pour faire diffuser votre publicité sur les statuts WhatsApp des diffuseurs SBC, vous n’avez pas besoin d’acheter un pack.',
            '- Sur l’écran de connexion, touchez « Créer un compte annonceur ».\n- Créez votre campagne : visuel, texte, public visé.\n- Payez la campagne : elle est ensuite proposée aux diffuseurs.',
            'Vous voulez changer le visuel d’une campagne déjà lancée ? Le nouveau visuel est d’abord vérifié par l’équipe SBC ; l’ancien continue de tourner en attendant.',
        ].join('\n\n'),
    },

    // ---------- Technique ----------
    {
        slug: 'activer-les-notifications',
        category: 'technique',
        tags: ['notifications', 'push', 'alertes', 'iphone', 'android', 'ecran accueil'],
        title: 'Recevoir les notifications sur mon téléphone',
        summary: 'Activer les notifications et choisir celles que vous recevez.',
        body: [
            'Ouvrez Profil, puis Notifications, puis les réglages : activez les notifications et choisissez les catégories que vous voulez recevoir.',
            '- Sur Android, les notifications fonctionnent directement dans le navigateur.\n- Sur iPhone, ajoutez d’abord SBC à l’écran d’accueil (bouton Partager, puis « Sur l’écran d’accueil »), ouvrez SBC depuis cette icône, puis activez les notifications.',
            'Vous ne recevez rien ? Vérifiez que les notifications du navigateur ne sont pas bloquées dans les réglages du téléphone.',
        ].join('\n\n'),
    },
    {
        slug: 'contacter-le-support',
        category: 'autre',
        tags: ['agent', 'support', 'contacter', 'aide', 'demande', 'ticket', 'humain'],
        title: 'Écrire à un agent SBC',
        summary: 'Ouvrir une demande et suivre la réponse.',
        body: [
            '- Ouvrez Aide, puis « Écrire à un agent ».\n- Choisissez le sujet, décrivez votre problème et ajoutez une capture d’écran ou un reçu si besoin (photo ou PDF).\n- Envoyez : vous recevez une notification à chaque réponse.',
            'Suivez vos échanges dans Aide, « Mes demandes ». Quand votre problème est réglé, vous pouvez fermer la demande.',
            'N’indiquez jamais de mot de passe ni de code reçu dans une demande.',
        ].join('\n\n'),
    },
];
