# Frontend Integration Guide: Notification Preferences & OTP System

## 📋 Overview

This guide explains the frontend changes needed to integrate the new notification preference system that allows users to choose between **Email** and **WhatsApp** for receiving OTP notifications.

## 🔄 What Changed

### **Before**
- All OTPs were sent via email only
- Phone numbers could be changed freely without verification
- Fixed notification channel for all users

### **After**
- Users can choose their preferred notification method (Email or WhatsApp)
- Phone numbers require OTP verification to change (like email changes)
- Per-request channel overrides available
- Backward compatibility maintained

---

## 🎯 Required Frontend Changes

### **1. User Registration Page*

#### **Add Notification Preference Field**
```javascript
// Add to registration form
const [notificationPreference, setNotificationPreference] = useState('email'); // Default to email

// Form field
<select 
  value={notificationPreference} 
  onChange={(e) => setNotificationPreference(e.target.value)}
  name="notificationPreference"
>
  <option value="email">📧 Email</option>
  <option value="whatsapp">📱 WhatsApp</option>
</select>
```

#### **Updated Registration API Call**
```javascript
// Registration payload - ADD notificationPreference
const registrationData = {
  name,
  email,
  password,
  region,
  phoneNumber,
  sex,
  birthDate,
  country,
  referrerCode,
  notificationPreference, // 👈 NEW FIELD
  // ... other fields
};

const response = await fetch('/api/users/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(registrationData)
});
```

---

### **2. User Profile Display**

#### **Show Current Notification Preference**
```javascript
// Add to user profile display
const UserProfile = ({ user }) => {
  return (
    <div className="profile-section">
      <h3>Notification Preferences</h3>
      <div className="preference-display">
        <span>OTP Delivery Method: </span>
        <span className={`preference-badge ${user.notificationPreference}`}>
          {user.notificationPreference === 'whatsapp' ? '📱 WhatsApp' : '📧 Email'}
        </span>
      </div>
      {/* ... other profile fields */}
    </div>
  );
};
```

---

### **3. Profile Edit Page**

#### **Add Notification Preference Editor**
```javascript
const ProfileEditForm = ({ user, onUpdate }) => {
  const [formData, setFormData] = useState({
    name: user.name,
    region: user.region,
    // ... other fields
    notificationPreference: user.notificationPreference || 'email' // 👈 NEW FIELD
  });

  return (
    <form onSubmit={handleSubmit}>
      {/* ... other form fields */}
      
      {/* NEW: Notification Preference Section */}
      <div className="form-section">
        <h4>📬 Notification Preferences</h4>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="notificationPreference"
              value="email"
              checked={formData.notificationPreference === 'email'}
              onChange={(e) => setFormData({...formData, notificationPreference: e.target.value})}
            />
            📧 Email - Receive OTPs via email
          </label>
          <label>
            <input
              type="radio"
              name="notificationPreference"
              value="whatsapp"
              checked={formData.notificationPreference === 'whatsapp'}
              onChange={(e) => setFormData({...formData, notificationPreference: e.target.value})}
            />
            📱 WhatsApp - Receive OTPs via WhatsApp
          </label>
        </div>
      </div>
    </form>
  );
};
```

#### **Updated Profile Update API Call**
```javascript
// Profile update payload - INCLUDE notificationPreference
const updateData = {
  name: formData.name,
  region: formData.region,
  notificationPreference: formData.notificationPreference, // 👈 NEW FIELD
  // ... other fields
};

const response = await fetch('/api/users/me', {
  method: 'PUT',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(updateData)
});
```

---

### **4. Phone Number Change Flow**

#### **NEW: Phone Change Request Page**
```javascript
const ChangePhoneNumber = () => {
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  // Step 1: Request OTP for phone change
  const requestPhoneChange = async () => {
    try {
      const response = await fetch('/api/users/request-change-phone', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPhoneNumber })
      });
      
      if (response.ok) {
        setOtpSent(true);
        showSuccess('OTP sent to your new phone number via WhatsApp!');
      }
    } catch (error) {
      showError('Failed to send OTP');
    }
  };

  // Step 2: Confirm phone change with OTP
  const confirmPhoneChange = async () => {
    try {
      const response = await fetch('/api/users/confirm-change-phone', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPhoneNumber, otpCode })
      });
      
      if (response.ok) {
        showSuccess('Phone number updated successfully!');
        // Refresh user profile
      }
    } catch (error) {
      showError('Invalid OTP or phone number already in use');
    }
  };

  return (
    <div className="change-phone-form">
      {!otpSent ? (
        // Step 1: Enter new phone number
        <div>
          <h3>📱 Change Phone Number</h3>
          <input
            type="tel"
            placeholder="New phone number"
            value={newPhoneNumber}
            onChange={(e) => setNewPhoneNumber(e.target.value)}
          />
          <button onClick={requestPhoneChange}>
            Send OTP via WhatsApp
          </button>
        </div>
      ) : (
        // Step 2: Enter OTP
        <div>
          <h3>✅ Verify New Phone Number</h3>
          <p>Enter the OTP sent to {newPhoneNumber} via WhatsApp:</p>
          <input
            type="text"
            placeholder="Enter OTP"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
          />
          <button onClick={confirmPhoneChange}>
            Confirm Change
          </button>
        </div>
      )}
    </div>
  );
};
```

---

### **5. OTP Request Pages (Login, Password Reset, etc.)**

#### **Enhanced OTP Request with Channel Override**
```javascript
const OTPRequestForm = ({ purpose }) => {
  const [identifier, setIdentifier] = useState(''); // Email or phone
  const [channelOverride, setChannelOverride] = useState(''); // Optional override
  const [showChannelOptions, setShowChannelOptions] = useState(false);

  const requestOTP = async () => {
    const payload = {
      identifier, // Can be email or phone number
      purpose,
      ...(channelOverride && { channel: channelOverride }) // Only include if override selected
    };

    try {
      const response = await fetch('/api/users/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        const channelText = channelOverride || 'your preferred method';
        showSuccess(`OTP sent via ${channelText}!`);
      }
    } catch (error) {
      showError('Failed to send OTP');
    }
  };

  return (
    <div className="otp-request-form">
      <h3>Request OTP</h3>
      
      {/* Identifier input */}
      <input
        type="text"
        placeholder="Email or phone number"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
      />

      {/* Optional: Channel override */}
      <div className="channel-options">
        <button 
          type="button"
          onClick={() => setShowChannelOptions(!showChannelOptions)}
          className="link-button"
        >
          ⚙️ Advanced options
        </button>
        
        {showChannelOptions && (
          <div className="channel-override">
            <label>Override delivery method for this request:</label>
            <select 
              value={channelOverride} 
              onChange={(e) => setChannelOverride(e.target.value)}
            >
              <option value="">Use my preference</option>
              <option value="email">📧 Email</option>
              <option value="whatsapp">📱 WhatsApp</option>
            </select>
          </div>
        )}
      </div>

      <button onClick={requestOTP}>
        Send OTP
      </button>
    </div>
  );
};
```

---

### **6. Password Reset Flow**

#### **Updated Password Reset Request**
```javascript
const PasswordResetRequest = () => {
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState(''); // Optional override

  const requestPasswordReset = async () => {
    try {
      const response = await fetch('/api/users/request-password-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          identifier,
          ...(channel && { channel })
        })
      });
      
      if (response.ok) {
        const method = channel || 'your preferred notification method';
        showSuccess(`Password reset OTP sent via ${method}!`);
      }
    } catch (error) {
      showError('Failed to send password reset OTP');
    }
  };

  return (
    <div className="password-reset-form">
      <h3>🔐 Reset Password</h3>
      <input
        type="text"
        placeholder="Email or phone number"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
      />
      
      {/* Optional channel override */}
      <select value={channel} onChange={(e) => setChannel(e.target.value)}>
        <option value="">Use my preference</option>
        <option value="email">📧 Send via Email</option>
        <option value="whatsapp">📱 Send via WhatsApp</option>
      </select>
      
      <button onClick={requestPasswordReset}>
        Send Reset OTP
      </button>
    </div>
  );
};
```

---

## 🔄 Backward Compatibility

### **Legacy API Support**
The system maintains backward compatibility. Existing code will continue to work:

```javascript
// ✅ This still works (legacy email field)
const response = await fetch('/api/users/resend-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    email: 'user@example.com',  // Legacy field
    purpose: 'login'
  })
});

// ✅ This also works (new identifier field)
const response = await fetch('/api/users/resend-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    identifier: 'user@example.com',  // New field
    purpose: 'login'
  })
});
```

---

## 🎨 UI/UX Recommendations

### **Visual Indicators**
```css
.preference-badge.email {
  background: #e3f2fd;
  color: #1976d2;
}

.preference-badge.whatsapp {
  background: #e8f5e8;
  color: #2e7d32;
}

.channel-override {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 8px;
  margin-top: 8px;
}
```

### **User-Friendly Messages**
```javascript
const getOTPMessage = (channel, userPreference) => {
  if (channel) {
    return `OTP sent via ${channel === 'whatsapp' ? 'WhatsApp' : 'Email'}`;
  }
  return `OTP sent via your preferred method (${userPreference === 'whatsapp' ? 'WhatsApp' : 'Email'})`;
};
```

### **Help Text**
```javascript
const NotificationPreferenceHelp = () => (
  <div className="help-text">
    <h4>📬 About Notification Preferences</h4>
    <ul>
      <li><strong>Email:</strong> Receive OTPs in your email inbox</li>
      <li><strong>WhatsApp:</strong> Receive OTPs as WhatsApp messages</li>
      <li>You can override this setting for individual requests</li>
      <li>Phone number changes require WhatsApp verification</li>
    </ul>
  </div>
);
```

---

## ✅ Testing Checklist

### **Registration Flow**
- [ ] User can select notification preference during registration
- [ ] Default preference is set to "email" if not specified
- [ ] OTP is sent via selected preference method

### **Profile Management**
- [ ] Current notification preference is displayed
- [ ] User can change notification preference
- [ ] Changes are saved and reflected immediately

### **Phone Number Changes**
- [ ] Phone change request sends OTP via WhatsApp
- [ ] OTP verification works correctly
- [ ] Phone number is updated after successful verification

### **OTP Requests**
- [ ] OTPs are sent via user's preferred method by default
- [ ] Channel override works for individual requests
- [ ] Both email and phone number can be used as identifiers
- [ ] Legacy API calls still work

### **Error Handling**
- [ ] Invalid notification preferences are rejected
- [ ] Invalid channel overrides show appropriate errors
- [ ] Phone numbers already in use show conflict errors

---

## 🚨 Important Notes

1. **Phone Number Validation**: Ensure phone numbers are properly formatted before sending to the API
2. **WhatsApp Availability**: WhatsApp OTPs depend on the notification service configuration
3. **User Education**: Consider showing tooltips or help text to explain the new features
4. **Progressive Enhancement**: Roll out the feature gradually, allowing users to discover it naturally
5. **Fallback Handling**: Always have fallback UI for when preferences can't be loaded

---

## 📞 Support

If you encounter any issues during implementation:
1. Check the API responses for detailed error messages
2. Verify that notification preferences are being sent correctly
3. Test with both email and WhatsApp preferences
4. Ensure backward compatibility with existing flows

The notification preference system is designed to be flexible and user-friendly while maintaining full backward compatibility with existing implementations.