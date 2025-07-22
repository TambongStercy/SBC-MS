# Language Conversion for WhatsApp OTP Templates

This feature automatically converts simple language codes (like `en`, `fr`, `es`) to supported WhatsApp template language codes.

## How It Works

When you send a language code with an OTP notification, the system will:

1. **Check if it's already supported** - If you send `en_US` or `fr`, it uses those directly
2. **Convert simple codes** - If you send `en`, it converts to `en_US`
3. **Handle variations** - Codes like `en_GB`, `english`, `EN` all convert to `en_US`
4. **Fallback safely** - Unknown languages like `es`, `de`, `zh` fallback to `en_US`

## Supported Templates

Currently available WhatsApp OTP templates:

- **English**: `en_US` → Uses `connexion` template
- **French**: `fr` → Uses `connexionfr` template

## Usage Examples

### API Request Examples

```javascript
// Simple language codes
POST /api/notifications/otp
{
  "userId": "507f1f77bcf86cd799439011",
  "recipient": "+237675080477",
  "channel": "whatsapp",
  "code": "123456",
  "expireMinutes": 10,
  "language": "en"  // ✅ Converts to en_US → connexion template
}

POST /api/notifications/otp
{
  "userId": "507f1f77bcf86cd799439011", 
  "recipient": "+237675080477",
  "channel": "whatsapp",
  "code": "654321",
  "expireMinutes": 10,
  "language": "fr"  // ✅ Uses fr → connexionfr template
}

POST /api/notifications/otp
{
  "userId": "507f1f77bcf86cd799439011",
  "recipient": "+237675080477", 
  "channel": "whatsapp",
  "code": "789012",
  "expireMinutes": 10,
  "language": "es"  // ✅ Converts to en_US (fallback) → connexion template
}
```

### Programmatic Usage

```typescript
import { convertLanguageCode, getOtpTemplateConfig } from './utils/otp-template.config';

// Convert any language code to supported template language
const supportedLang = convertLanguageCode('en');        // Returns: 'en_US'
const supportedLang = convertLanguageCode('spanish');   // Returns: 'en_US' (fallback)
const supportedLang = convertLanguageCode('fr_CA');     // Returns: 'fr'

// Get template configuration
const config = getOtpTemplateConfig('en');
// Returns: { templateName: 'connexion', languageCode: 'en_US' }

const config = getOtpTemplateConfig('fr');
// Returns: { templateName: 'connexionfr', languageCode: 'fr' }
```

## Conversion Map

The system recognizes these language variations:

### English → `en_US` (connexion template)
- `en`, `eng`, `english`
- `en_GB`, `en_CA`, `en_AU`
- `EN`, `English` (case insensitive)

### French → `fr` (connexionfr template)  
- `fr`, `fra`, `french`
- `fr_FR`, `fr_CA`, `fr_BE`, `fr_CH`
- `FR`, `French` (case insensitive)

### Other Languages → `en_US` (fallback)
- `es`, `spanish`, `es_ES`, `es_MX`
- `de`, `german`, `de_DE`
- `it`, `italian`, `it_IT`
- `pt`, `portuguese`, `pt_BR`
- `ar`, `arabic`, `ar_SA`
- Any unknown language code

## Testing

Run the test script to verify language conversion:

```bash
cd notification-service
node test-language-conversion.js
```

## Adding New Languages

To add support for a new language:

1. **Add template to WhatsApp Business Manager**
2. **Update `OTP_TEMPLATE_CONFIG`**:
   ```typescript
   export const OTP_TEMPLATE_CONFIG = {
     en_US: { templateName: 'connexion', languageCode: 'en_US' },
     fr: { templateName: 'connexionfr', languageCode: 'fr' },
     es: { templateName: 'conexion_es', languageCode: 'es' }, // New
   } as const;
   ```

3. **Update `LANGUAGE_CONVERSION_MAP`**:
   ```typescript
   // Spanish (now supported)
   'es': 'es',
   'esp': 'es', 
   'spanish': 'es',
   'es_ES': 'es',
   'es_MX': 'es',
   ```

4. **Test the new language** with the test script

## Benefits

- **Flexibility**: Accept any language format from different services
- **Fallback Safety**: Unknown languages don't break the system
- **User Experience**: Messages sent in user's preferred language when available
- **Future-Proof**: Easy to add new languages without breaking existing code 