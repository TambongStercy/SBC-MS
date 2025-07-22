/**
 * WhatsApp Cloud API Types and Interfaces
 * Based on WhatsApp Business API documentation
 */

// Configuration interfaces
export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  apiVersion: string;
  apiBaseUrl: string;
}

// Message interfaces
export interface WhatsAppMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'text' | 'template' | 'image' | 'document' | 'audio' | 'video';
  text?: {
    body: string;
    preview_url?: boolean;
  };
  template?: {
    name: string;
    language: {
      code: string;
    };
    components?: WhatsAppTemplateComponent[];
  };
  image?: {
    link?: string;
    id?: string;
    caption?: string;
  };
  document?: {
    link?: string;
    id?: string;
    filename?: string;
    caption?: string;
  };
  audio?: {
    link?: string;
    id?: string;
  };
  video?: {
    link?: string;
    id?: string;
    caption?: string;
  };
}

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  parameters?: WhatsAppTemplateParameter[];
  sub_type?: string;
  index?: number;
  format?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  text?: string;
  example?: any;
  buttons?: WhatsAppTemplateButton[];
}

export interface WhatsAppTemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  text?: string;
  currency?: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  date_time?: {
    fallback_value: string;
  };
  image?: {
    link: string;
  };
  document?: {
    link: string;
    filename?: string;
  };
  video?: {
    link: string;
  };
}

// Response interfaces
export interface WhatsAppResponse {
  messaging_product: string;
  contacts: WhatsAppContact[];
  messages: WhatsAppMessageResponse[];
}

export interface WhatsAppContact {
  input: string;
  wa_id: string;
}

export interface WhatsAppMessageResponse {
  id: string;
  message_status?: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
}

// Error interfaces
export interface WhatsAppError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id: string;
  };
}

export interface WhatsAppErrorDetails {
  code: number;
  title: string;
  message: string;
  href?: string;
}

// Webhook interfaces
export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookChange {
  value: WhatsAppWebhookValue;
  field: string;
}

export interface WhatsAppWebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  statuses?: WhatsAppMessageStatus[];
  messages?: WhatsAppIncomingMessage[];
  errors?: WhatsAppErrorDetails[];
}

export interface WhatsAppMessageStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    expiration_timestamp?: string;
    origin: {
      type: string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
  errors?: WhatsAppErrorDetails[];
}

// WhatsApp Message Template Component (merged above)

// WhatsApp Message Template Button
export interface WhatsAppTemplateButton {
  type: 'QUICK_REPLY' | 'URL';
  text: string;
  url?: string;
  example?: any;
}

// WhatsApp Message Template
export interface WhatsAppMessageTemplate {
  name: string;
  components: WhatsAppTemplateComponent[];
  language: string;
  status: MessageTemplateStatus;
  category: string;
  id: string;
}

// Message Template Status
export type MessageTemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED';


// Incoming message from a user
export interface WhatsAppIncomingMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  context?: {
    from: string;
    id: string;
  };
  text?: {
    body: string;
  };
  image?: {
    caption?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  document?: {
    caption?: string;
    filename?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  audio?: {
    mime_type: string;
    sha256: string;
    id: string;
    voice?: boolean;
  };
  video?: {
    caption?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
}

// Rate limiting and retry interfaces
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

// Media upload interfaces
export interface MediaUploadResponse {
  id: string;
}

export interface MediaUploadRequest {
  file: Buffer | string;
  type: string;
  messaging_product: 'whatsapp';
}

// Phone number validation
export interface PhoneNumberInfo {
  verified_name: string;
  code_verification_status: string;
  display_phone_number: string;
  quality_rating: string;
  platform_type: string;
  throughput: {
    level: string;
  };
}

// Business profile interfaces
export interface BusinessProfile {
  messaging_product: 'whatsapp';
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}

// Template management interfaces
export interface MessageTemplate {
  name: string;
  language: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  category: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
  components: WhatsAppTemplateComponent[];
}

// Health check and status interfaces
export interface WhatsAppHealthStatus {
  isConnected: boolean;
  phoneNumberId: string;
  businessAccountId: string;
  lastChecked: Date;
  error?: string;
}

// Configuration validation result
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}