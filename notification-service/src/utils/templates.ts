import { NotificationType } from '../database/models/notification.model';

// Interface for template definition
interface Template {
  subject?: string;
  body: string;
}

// Map of templates by type and template ID
const TEMPLATES: Record<NotificationType, Record<string, Template & { plainText?: string }>> = {
  // OTP Templates
  [NotificationType.OTP]: {
    'withdrawal-verification': {
      subject: 'Withdrawal Verification',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Withdrawal Verification</h2>
          <p>Hello {{name}},</p>
          <p>Your withdrawal verification code is:</p>
          <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 15px 0;">
            {{code}}
          </div>
          <p>Please enter it to complete your withdrawal.</p>
          <p>This code will expire in {{expireMinutes}} minutes.</p>
          <p>If you didn't request this code, please ignore this message.</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nYour withdrawal verification code is: {{code}}\nPlease enter it to complete your withdrawal.\nThis code will expire in {{expireMinutes}} minutes.\nIf you didn't request this code, please ignore this message.\nSniper Business Center Team`
    },
    'verify-login': {
      subject: 'Your Login Verification Code',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Verification Code</h2>
          <p>Hello,</p>
          <p>Your verification code for logging into Sniper Business Center is:</p>
          <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 15px 0;">
            {{code}}
          </div>
          <p>This code will expire in {{expireMinutes}} minutes.</p>
          <p>If you didn't request this code, please ignore this message.</p>
          <p>Thanks,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Your SBC verification code is: {{code}}\nExpires in {{expireMinutes}} minutes.\nIf you didn't request this code, please ignore this message.\nSniper Business Center Team`
    },
    'verify-registration': {
      subject: 'Complete Your Registration',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Registration Verification</h2>
          <p>Hello {{name}},</p>
          <p>Thank you for registering with Sniper Business Center. To complete your registration, please use the following verification code:</p>
          <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 15px 0;">
            {{code}}
          </div>
          <p>This code will expire in {{expireMinutes}} minutes.</p>
          <p>If you didn't register for an account, please ignore this message.</p>
          <p>Thanks,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nThank you for registering with Sniper Business Center. Your verification code is: {{code}}\nThis code will expire in {{expireMinutes}} minutes.\nIf you didn't register, please ignore this message.\nSniper Business Center Team`
    },
  },

  // Transaction Templates
  [NotificationType.TRANSACTION]: {
    'transaction-completed': {
      subject: 'Transaction Completed',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Transaction Completed</h2>
          <p>Hello {{name}},</p>
          <p>Your transaction of <strong>{{amount}} {{currency}}</strong> has been completed successfully.</p>
          <p>Transaction ID: <strong>{{transactionId}}</strong></p>
          <p>Date: {{date}}</p>
          <p>Thanks for using our service!</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nYour transaction of {{amount}} {{currency}} has been completed successfully.\nTransaction ID: {{transactionId}}\nDate: {{date}}\nThanks for using our service!\nSniper Business Center Team`
    },
    'transaction-failed': {
      subject: 'Transaction Failed',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #ff3333;">Transaction Failed</h2>
          <p>Hello {{name}},</p>
          <p>We regret to inform you that your transaction of <strong>{{amount}} {{currency}}</strong> has failed.</p>
          <p>Transaction ID: <strong>{{transactionId}}</strong></p>
          <p>Reason: {{reason}}</p>
          <p>Date: {{date}}</p>
          <p>If you have any questions, please contact our support team.</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nWe regret to inform you that your transaction of {{amount}} {{currency}} has failed.\nTransaction ID: {{transactionId}}\nReason: {{reason}}\nDate: {{date}}\nIf you have any questions, please contact our support team.\nSniper Business Center Team`
    },
  },

  // Referral Templates
  [NotificationType.REFERRAL]: {
    'referral-signup': {
      subject: 'New Referral Signup',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">New Referral</h2>
          <p>Hello {{name}},</p>
          <p>Good news! Someone has signed up using your referral code.</p>
          <p>Referral level: {{level}}</p>
          <p>Date: {{date}}</p>
          <p>Continue sharing your referral code to earn more rewards!</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nGood news! Someone has signed up using your referral code.\nReferral level: {{level}}\nDate: {{date}}\nContinue sharing your referral code to earn more rewards!\nSniper Business Center Team`
    },
  },

  // Account Templates
  [NotificationType.ACCOUNT]: {
    'account-created': {
      subject: 'Welcome to Sniper Business Center',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Welcome!</h2>
          <p>Hello {{name}},</p>
          <p>Your account has been successfully created. Welcome to Sniper Business Center!</p>
          <p>Here's what you can do next:</p>
          <ul>
            <li>Complete your profile</li>
            <li>Explore our features</li>
            <li>Share your referral code: <strong>{{referralCode}}</strong></li>
          </ul>
          <p>If you have any questions, feel free to contact our support team.</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nYour account has been successfully created. Welcome to Sniper Business Center!\nNext steps:\n- Complete your profile\n- Explore our features\n- Share your referral code: {{referralCode}}\nIf you have any questions, feel free to contact our support team.\nSniper Business Center Team`
    },
    'password-reset': {
      subject: 'Password Reset Request',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Password Reset</h2>
          <p>Hello,</p>
          <p>We received a request to reset your password. Use the following code to reset your password:</p>
          <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 15px 0;">
            {{code}}
          </div>
          <p>This code will expire in {{expireMinutes}} minutes.</p>
          <p>If you didn't request a password reset, please ignore this message.</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `We received a request to reset your password.\nYour reset code is: {{code}}\nThis code will expire in {{expireMinutes}} minutes.\nIf you didn't request a password reset, please ignore this message.\nSniper Business Center Team`
    },
  },

  // System Templates
  [NotificationType.SYSTEM]: {
    'maintenance-alert': {
      subject: 'Scheduled Maintenance Alert',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Scheduled Maintenance</h2>
          <p>Hello {{name}},</p>
          <p>We want to inform you that our system will be undergoing scheduled maintenance on {{date}} from {{startTime}} to {{endTime}} (UTC).</p>
          <p>During this time, the service might be temporarily unavailable.</p>
          <p>We apologize for any inconvenience and appreciate your understanding.</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nWe want to inform you that our system will be undergoing scheduled maintenance on {{date}} from {{startTime}} to {{endTime}} (UTC).\nDuring this time, the service might be temporarily unavailable.\nWe apologize for any inconvenience and appreciate your understanding.\nSniper Business Center Team`
    },
  },

  // Marketing Templates
  [NotificationType.MARKETING]: {
    'new-feature': {
      subject: 'Exciting New Features',
      body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">New Features Added</h2>
          <p>Hello {{name}},</p>
          <p>We're excited to announce that we've added some great new features to enhance your experience:</p>
          <ul>
            <li>{{feature1}}</li>
            <li>{{feature2}}</li>
            <li>{{feature3}}</li>
          </ul>
          <p>Log in to your account to try them out!</p>
          <p>Regards,<br>Sniper Business Center Team</p>
        </div>
      `,
      plainText: `Hello {{name}},\nWe're excited to announce that we've added some great new features to enhance your experience:\n- {{feature1}}\n- {{feature2}}\n- {{feature3}}\nLog in to your account to try them out!\nSniper Business Center Team`
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