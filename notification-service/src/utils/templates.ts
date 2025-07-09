import { NotificationType } from '../database/models/notification.model';

// Interface for template definition
interface Template {
  subject?: string;
  body: string;
}

// Beautiful base template function for consistent styling
const createBeautifulTemplate = (title: string, content: string, footerText?: string): string => {
  return `
    <!DOCTYPE html>
    <html lang="fr" style="margin: 0; padding: 0;">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Inter', 'Segoe UI', 'Roboto', sans-serif; line-height: 1.6; color: #333; }
            .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; }
            .header { background: linear-gradient(135deg, #004d7a 0%, #006ba8 100%); padding: 30px 20px; text-align: center; }
            .header h1 { color: #ffffff; font-size: 28px; font-weight: 600; margin-bottom: 8px; }
            .header p { color: #e1f5fe; font-size: 16px; font-weight: 300; }
            .content { padding: 40px 30px; background: #ffffff; }
            .highlight-box { background: linear-gradient(135deg, #e8f5e8 0%, #f1f8e9 100%); border-left: 5px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 8px; }
            .warning-box { background: linear-gradient(135deg, #fff3cd 0%, #fdf6e3 100%); border-left: 5px solid #ffc107; padding: 20px; margin: 25px 0; border-radius: 8px; }
            .error-box { background: linear-gradient(135deg, #ffebee 0%, #fce4ec 100%); border-left: 5px solid #f44336; padding: 20px; margin: 25px 0; border-radius: 8px; }
            .code-box { background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%); border: 2px dashed #004d7a; padding: 30px; margin: 25px 0; border-radius: 12px; text-align: center; }
            .code { font-size: 36px; font-weight: 700; color: #004d7a; letter-spacing: 8px; font-family: 'Courier New', monospace; background: white; padding: 20px; border-radius: 8px; }
            .button { display: inline-block; background: linear-gradient(135deg, #004d7a 0%, #006ba8 100%); color: #ffffff !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 25px 20px; text-align: center; border-top: 1px solid #e9ecef; }
            .footer p { color: #6c757d; font-size: 14px; margin: 5px 0; }
            .success-icon { width: 60px; height: 60px; background: #4caf50; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; }
            .warning-icon { width: 60px; height: 60px; background: #ff9800; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; }
            .error-icon { width: 60px; height: 60px; background: #f44336; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; }
            .security-icon { width: 80px; height: 80px; background: linear-gradient(135deg, #004d7a 0%, #006ba8 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px; }
            @media (max-width: 600px) {
                .content { padding: 20px 15px; }
                .header { padding: 20px 15px; }
                .header h1 { font-size: 24px; }
                .code { font-size: 28px; letter-spacing: 4px; }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f7fa;">
        <div class="email-container">
            <div class="header">
                <h1>Sniper Business Center</h1>
                <p>Votre plateforme de confiance</p>
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                <p><strong>Sniper Business Center</strong></p>
                <p>Développé par Simbtech © ${new Date().getFullYear()}</p>
                <p>Cameroun - Yaoundé</p>
                ${footerText ? `<p style="margin-top: 15px; color: #495057;">${footerText}</p>` : ''}
            </div>
        </div>
    </body>
    </html>
  `;
};

// Map of templates by type and template ID
const TEMPLATES: Record<NotificationType, Record<string, Template & { plainText?: string }>> = {
  // OTP Templates
  [NotificationType.OTP]: {
    'withdrawal-verification': {
      subject: '🔐 Code de vérification de retrait - SBC',
      body: createBeautifulTemplate(
        'Code de Vérification de Retrait',
        `
          <div style="text-align: center;">
              <div class="security-icon">🔐</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Vérification de Retrait
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #004d7a;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Voici votre code de vérification pour finaliser votre retrait :
          </p>
          
          <div class="code-box">
              <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 20px;">
                  🔑 Code de Vérification
              </h3>
              <div class="code">{{code}}</div>
              <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">
                  Ce code expire dans <strong>{{expireMinutes}} minutes</strong>
              </p>
          </div>
          
          <div class="warning-box">
              <p style="margin: 0; color: #856404; font-size: 15px;">
                  <strong>⚠️ Important :</strong> Ne partagez jamais ce code avec qui que ce soit. Notre équipe ne vous demandera jamais votre code de vérification.
              </p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              Si vous n'avez pas demandé ce retrait, veuillez contacter notre support immédiatement.
          </p>
        `,
        'Votre sécurité financière est notre priorité.'
      ),
      plainText: `Bonjour {{name}},\nVotre code de vérification de retrait est : {{code}}\nVeuillez le saisir pour finaliser votre retrait.\nCe code expire dans {{expireMinutes}} minutes.\nSi vous n'avez pas demandé ce retrait, contactez notre support.\nÉquipe SBC`
    },
    'verify-login': {
      subject: '🔐 Code de connexion SBC : {{code}}',
      body: createBeautifulTemplate(
        'Code de Connexion',
        `
          <div style="text-align: center;">
              <div class="security-icon">🔐</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Code de Connexion
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Voici votre code de vérification pour vous connecter à Sniper Business Center :
          </p>
          
          <div class="code-box">
              <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 20px;">
                  🔑 Code de Connexion
              </h3>
              <div class="code">{{code}}</div>
              <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">
                  Ce code expire dans <strong>{{expireMinutes}} minutes</strong>
              </p>
          </div>
          
          <div class="warning-box">
              <p style="margin: 0; color: #856404; font-size: 15px;">
                  <strong>⚠️ Sécurité :</strong> Ne partagez jamais ce code. L'équipe SBC ne vous demandera jamais votre code OTP.
              </p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              Si vous n'avez pas tenté de vous connecter, ignorez cet email ou contactez notre support.
          </p>
        `,
        'Votre sécurité est notre priorité absolue.'
      ),
      plainText: `Votre code de connexion SBC est : {{code}}\nExpire dans {{expireMinutes}} minutes.\nSi vous n'avez pas tenté de vous connecter, ignorez ce message.\nÉquipe SBC`
    },
    'verify-registration': {
      subject: '🎉 Finalisez votre inscription SBC',
      body: createBeautifulTemplate(
        'Finalisation de votre Inscription',
        `
          <div style="text-align: center;">
              <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px;">🎉</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Bienvenue chez SBC !
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #004d7a;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Merci de vous être inscrit chez Sniper Business Center ! Pour finaliser votre inscription, utilisez ce code de vérification :
          </p>
          
          <div class="code-box">
              <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 20px;">
                  🔑 Code de Vérification
              </h3>
              <div class="code">{{code}}</div>
              <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">
                  Ce code expire dans <strong>{{expireMinutes}} minutes</strong>
              </p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              Une fois votre compte vérifié, vous pourrez commencer à explorer toutes nos fonctionnalités !
          </p>
          
          <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
              Bienvenue dans la famille SBC ! 🚀
          </p>
        `,
        'Ensemble, construisons votre succès entrepreneurial !'
      ),
      plainText: `Bonjour {{name}},\nMerci de vous être inscrit chez SBC ! Votre code de vérification est : {{code}}\nCe code expire dans {{expireMinutes}} minutes.\nSi vous ne vous êtes pas inscrit, ignorez ce message.\nÉquipe SBC`
    },
  },

  // Transaction Templates
  [NotificationType.TRANSACTION]: {
    'transaction-completed': {
      subject: '🎉 Transaction Réussie - SBC',
      body: createBeautifulTemplate(
        'Transaction Réussie',
        `
          <div style="text-align: center;">
              <div class="success-icon">🎉</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Transaction Réussie
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #004d7a;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Votre transaction de <strong style="color: #004d7a;">{{amount}} {{currency}}</strong> a été réussie avec succès !
          </p>
          
          <div class="highlight-box">
              <p style="margin: 0; color: #28a745; font-size: 15px;">
                  <strong>👏 Félicitations !</strong> Votre transaction a été validée.
              </p>
              <p style="margin: 10px 0 0 0; color: #555; font-size: 14px;">
                  Transaction ID : <strong>{{transactionId}}</strong>
              </p>
              <p style="margin: 0 0 10px 0; color: #555; font-size: 14px;">
                  Date : <strong>{{date}}</strong>
              </p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              N'hésitez pas à explorer d'autres fonctionnalités de notre plateforme !
          </p>
          
          <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
              Profitez de votre expérience SBC ! 🚀
          </p>
        `,
        'Votre satisfaction est notre priorité.'
      ),
      plainText: `Bonjour {{name}},\nVotre transaction de {{amount}} {{currency}} a été réussie avec succès !\nTransaction ID : {{transactionId}}\nDate : {{date}}\nN'hésitez pas à explorer d'autres fonctionnalités de notre plateforme !\nÉquipe SBC`
    },
    'transaction-failed': {
      subject: '❌ Transaction Échouée - SBC',
      body: createBeautifulTemplate(
        'Transaction Échouée',
        `
          <div style="text-align: center;">
              <div class="error-icon">❌</div>
          </div>
          
          <h2 style="color: #ff3333; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Transaction Échouée
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #ff3333;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Nous regrettons de vous informer que votre transaction de <strong style="color: #ff3333;">{{amount}} {{currency}}</strong> a échoué.
          </p>
          
          <div class="error-box">
              <p style="margin: 0; color: #dc3545; font-size: 15px;">
                  <strong>⚠️ Désolé :</strong> Votre transaction a été rejetée pour la raison suivante :
              </p>
              <p style="margin: 10px 0 0 0; color: #555; font-size: 14px;">
                  Raison : <strong>{{reason}}</strong>
              </p>
              <p style="margin: 0 0 10px 0; color: #555; font-size: 14px;">
                  Date : <strong>{{date}}</strong>
              </p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              Si vous avez des questions, n'hésitez pas à contacter notre équipe de support.
          </p>
          
          <p style="font-size: 16px; color: #ff3333; text-align: center; font-weight: 500;">
              Votre expérience SBC ! 🚀
          </p>
        `,
        'Votre sécurité est notre priorité absolue.'
      ),
      plainText: `Bonjour {{name}},\nNous regrettons de vous informer que votre transaction de {{amount}} {{currency}} a échoué.\nRaison : {{reason}}\nDate : {{date}}\nSi vous avez des questions, n'hésitez pas à contacter notre équipe de support.\nÉquipe SBC`
    },
  },

  // Referral Templates
  [NotificationType.REFERRAL]: {
    'referral-signup': {
      subject: '🎉 Nouveau Parrainage - SBC',
      body: createBeautifulTemplate(
        'Nouveau Parrainage',
        `
          <div style="text-align: center;">
              <div class="success-icon">🎉</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Nouveau Parrainage !
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #004d7a;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Excellente nouvelle ! Quelqu'un s'est inscrit en utilisant votre code de parrainage.
          </p>
          
          <div class="highlight-box">
              <h3 style="color: #2e7d32; margin-bottom: 15px; font-size: 20px; text-align: center;">
                  👥 Détails du Parrainage
              </h3>
              <p style="margin: 8px 0; font-size: 16px; text-align: center;"><strong>Niveau:</strong> {{level}}</p>
              <p style="margin: 8px 0; font-size: 16px; text-align: center;"><strong>Date:</strong> {{date}}</p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              Continuez à partager votre code de parrainage pour gagner plus de récompenses !
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
              <a href="https://sniperbuisnesscenter.com/dashboard" class="button">
                  Voir mes parrainages
              </a>
          </div>
          
          <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
              Bravo pour votre réseau grandissant ! 🚀
          </p>
        `,
        'Ensemble, construisons un réseau solide !'
      ),
      plainText: `Bonjour {{name}},\nExcellente nouvelle ! Quelqu'un s'est inscrit en utilisant votre code de parrainage.\nNiveau: {{level}}\nDate: {{date}}\nContinuez à partager votre code pour gagner plus de récompenses !\nÉquipe SBC`
    },
  },

  // Account Templates
  [NotificationType.ACCOUNT]: {
    'account-created': {
      subject: '🎉 Bienvenue chez Sniper Business Center !',
      body: createBeautifulTemplate(
        'Bienvenue chez SBC',
        `
          <div style="text-align: center;">
              <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px;">🎉</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 32px; font-weight: 700;">
              Bienvenue dans la famille SBC !
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #004d7a;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Félicitations ! Votre compte a été créé avec succès. Vous faites maintenant partie d'une communauté dynamique d'entrepreneurs.
          </p>
          
          <div style="background: #f8f9fa; border-radius: 12px; padding: 25px; margin: 30px 0;">
              <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 22px; text-align: center;">
                  🚀 Prochaines Étapes
              </h3>
              <div style="text-align: left;">
                  <p style="margin: 10px 0; font-size: 16px;">✅ <strong>Complétez votre profil</strong> pour une meilleure expérience</p>
                  <p style="margin: 10px 0; font-size: 16px;">🛍️ <strong>Explorez nos services</strong> exclusifs</p>
                  <p style="margin: 10px 0; font-size: 16px;">👥 <strong>Partagez votre code:</strong> <span style="background: #e3f2fd; padding: 5px 10px; border-radius: 4px; font-family: monospace;">{{referralCode}}</span></p>
                  <p style="margin: 10px 0; font-size: 16px;">💰 <strong>Commencez à gagner</strong> dès aujourd'hui</p>
              </div>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
              <a href="https://sniperbuisnesscenter.com/dashboard" class="button">
                  Accéder à mon tableau de bord
              </a>
          </div>
          
          <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
              Prêt à commencer votre aventure entrepreneuriale ? 🌟
          </p>
        `,
        'Ensemble, construisons votre succès entrepreneurial !'
      ),
      plainText: `Bonjour {{name}},\nFélicitations ! Votre compte SBC a été créé avec succès.\nProchaines étapes:\n- Complétez votre profil\n- Explorez nos services\n- Partagez votre code: {{referralCode}}\n- Commencez à gagner\nÉquipe SBC`
    },
    'password-reset': {
      subject: '🔐 Réinitialisation de mot de passe - SBC',
      body: createBeautifulTemplate(
        'Réinitialisation de mot de passe',
        `
          <div style="text-align: center;">
              <div class="security-icon">🔐</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Réinitialisation de Mot de Passe
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Nous avons reçu une demande de réinitialisation de votre mot de passe. Utilisez ce code pour le réinitialiser :
          </p>
          
          <div class="code-box">
              <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 20px;">
                  🔑 Code de Réinitialisation
              </h3>
              <div class="code">{{code}}</div>
              <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">
                  Ce code expire dans <strong>{{expireMinutes}} minutes</strong>
              </p>
          </div>
          
          <div class="warning-box">
              <p style="margin: 0; color: #856404; font-size: 15px;">
                  <strong>⚠️ Important :</strong> Si vous n'avez pas demandé cette réinitialisation, ignorez cet email et contactez notre support.
              </p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              Après avoir saisi ce code, vous pourrez créer un nouveau mot de passe sécurisé.
          </p>
        `,
        'Votre sécurité est notre priorité absolue.'
      ),
      plainText: `Nous avons reçu une demande de réinitialisation de votre mot de passe.\nVotre code de réinitialisation est : {{code}}\nCe code expire dans {{expireMinutes}} minutes.\nSi vous n'avez pas demandé cette réinitialisation, ignorez ce message.\nÉquipe SBC`
    },
  },

  // System Templates
  [NotificationType.SYSTEM]: {
    'maintenance-alert': {
      subject: '🔧 Maintenance Programmée - SBC',
      body: createBeautifulTemplate(
        'Maintenance Programmée',
        `
          <div style="text-align: center;">
              <div class="warning-icon">🔧</div>
          </div>
          
          <h2 style="color: #ff9800; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Maintenance Programmée
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #004d7a;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Nous souhaitons vous informer d'une maintenance programmée de notre système.
          </p>
          
          <div class="warning-box">
              <h3 style="color: #e65100; margin-bottom: 15px; font-size: 20px; text-align: center;">
                  📅 Détails de la Maintenance
              </h3>
              <p style="margin: 8px 0; font-size: 16px; text-align: center;"><strong>Date:</strong> {{date}}</p>
              <p style="margin: 8px 0; font-size: 16px; text-align: center;"><strong>Heure:</strong> {{startTime}} à {{endTime}} (UTC)</p>
              <p style="margin: 15px 0 0 0; color: #666; font-size: 14px; text-align: center;">
                  Pendant cette période, nos services pourraient être temporairement indisponibles.
              </p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin: 25px 0;">
              Nous nous excusons pour tout désagrément causé et vous remercions de votre compréhension.
          </p>
          
          <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
              Merci pour votre patience ! 🙏
          </p>
        `,
        'Nous travaillons pour vous offrir le meilleur service.'
      ),
      plainText: `Bonjour {{name}},\nNous souhaitons vous informer d'une maintenance programmée de notre système.\nDate: {{date}}\nHeure: {{startTime}} à {{endTime}} (UTC)\nPendant cette période, nos services pourraient être temporairement indisponibles.\nNous nous excusons pour tout désagrément.\nÉquipe SBC`
    },
  },

  // Marketing Templates
  [NotificationType.MARKETING]: {
    'new-feature': {
      subject: '🚀 Nouvelles Fonctionnalités SBC !',
      body: createBeautifulTemplate(
        'Nouvelles Fonctionnalités',
        `
          <div style="text-align: center;">
              <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #2196f3 0%, #42a5f5 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px;">🚀</div>
          </div>
          
          <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
              Nouvelles Fonctionnalités !
          </h2>
          
          <p style="font-size: 18px; margin-bottom: 15px;">
              Bonjour <strong style="color: #004d7a;">{{name}}</strong>,
          </p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
              Nous sommes ravis de vous annoncer l'ajout de nouvelles fonctionnalités pour améliorer votre expérience :
          </p>
          
          <div style="background: #f8f9fa; border-radius: 12px; padding: 25px; margin: 30px 0;">
              <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 22px; text-align: center;">
                  ✨ Nouveautés
              </h3>
              <div style="text-align: left;">
                  <p style="margin: 15px 0; font-size: 16px;">🎯 <strong>{{feature1}}</strong></p>
                  <p style="margin: 15px 0; font-size: 16px;">💼 <strong>{{feature2}}</strong></p>
                  <p style="margin: 15px 0; font-size: 16px;">📈 <strong>{{feature3}}</strong></p>
              </div>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
              <a href="https://sniperbuisnesscenter.com/dashboard" class="button">
                  Découvrir les nouveautés
              </a>
          </div>
          
          <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
              Explorez ces nouvelles fonctionnalités dès maintenant ! 🌟
          </p>
        `,
        'Innovation et excellence pour votre succès !'
      ),
      plainText: `Bonjour {{name}},\nNous sommes ravis de vous annoncer l'ajout de nouvelles fonctionnalités :\n- {{feature1}}\n- {{feature2}}\n- {{feature3}}\nConnectez-vous pour les découvrir !\nÉquipe SBC`
    },
  },
};

/**
 * Get a template and apply variable substitution
 * @param type The notification type
 * @param templateId The specific template ID
 * @param variables Variables to substitute in the template
 * @returns The processed template
 */
export const getProcessedTemplate = (
  type: NotificationType,
  templateId: string,
  variables: Record<string, any> = {}
): { subject?: string; body: string; plainText: string } => {
  // Get the template
  const template = TEMPLATES[type]?.[templateId];

  if (!template) {
    throw new Error(`Template not found: ${type}/${templateId}`);
  }

  // Process the template - replace {{variable}} with actual values
  let processedBody = template.body;
  let processedSubject = template.subject || '';
  let processedPlainText = template.plainText || '';

  // Replace variables in both body and subject
  Object.keys(variables).forEach(key => {
    const value = variables[key];
    const regex = new RegExp(`{{${key}}}`, 'g');
    processedBody = processedBody.replace(regex, value);
    if (processedSubject) {
      processedSubject = processedSubject.replace(regex, value);
    }
    if (processedPlainText) {
      processedPlainText = processedPlainText.replace(regex, value);
    }
  });

  // Fallback: If no plainText, strip HTML from body
  if (!processedPlainText) {
    processedPlainText = processedBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  return {
    subject: processedSubject,
    body: processedBody.trim(),
    plainText: processedPlainText.trim(),
  };
};

/**
 * Get a list of available templates
 */
export const getAvailableTemplates = (): { type: string; id: string; subject?: string }[] => {
  const templates: { type: string; id: string; subject?: string }[] = [];

  Object.keys(TEMPLATES).forEach(type => {
    const typeTemplates = TEMPLATES[type as NotificationType];
    Object.keys(typeTemplates).forEach(id => {
      templates.push({
        type,
        id,
        subject: typeTemplates[id].subject,
      });
    });
  });

  return templates;
};

/**
 * Check if a template exists
 */
export const templateExists = (type: NotificationType, templateId: string): boolean => {
  return !!TEMPLATES[type]?.[templateId];
}; 