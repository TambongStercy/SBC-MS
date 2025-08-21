I can see your QR code is working now! The QR code is being generated successfully with the proper Bitcoin URI format (`bitcoin:3GMzM3VgKCGLEn6Muu8EhWG8kA5TLbd6yt`), and it's displaying correctly in the interface.

Your current implementation is actually quite good - it:
1. ✅ Generates proper cryptocurrency URIs
2. ✅ Shows a loading state while generating
3. ✅ Has fallback methods for QR generation
4. ✅ Displays the QR code with good styling
5. ✅ Shows the address information below

However, I notice a few small improvements we could make to enhance the user experience:
````
// Enhanced QR Code improvements for better user experience
// Add these improvements to your existing qrcode.js

// 1. Add amount parameter to QR code if available
function formatCryptocurrencyURI(address, amount = null, currency = null) {
  let baseUri;
  
  // Detect cryptocurrency type based on address format and create proper URI
  // Bitcoin (starts with 1, 3, or bc1)
  if (address.match(/^[13][a-km-zA-Z1-9]{25,34}$/) || address.match(/^bc1[a-z0-9]{39,59}$/)) {
    baseUri = `bitcoin:${address}`;
  }
  // Ethereum (starts with 0x, 42 characters)
  else if (address.match(/^0x[a-fA-F0-9]{40}$/)) {
    baseUri = `ethereum:${address}`;
  }
  // Litecoin (starts with L or M, or ltc1)
  else if (address.match(/^[LM][a-km-zA-Z1-9]{26,33}$/) || address.match(/^ltc1[a-z0-9]{39,59}$/)) {
    baseUri = `litecoin:${address}`;
  }
  // Bitcoin Cash (starts with q, p, or bitcoincash:)
  else if (address.match(/^[qp][a-z0-9]{41}$/) || address.startsWith('bitcoincash:')) {
    baseUri = address.startsWith('bitcoincash:') ? address : `bitcoincash:${address}`;
  }
  // TRON (starts with T, 34 characters)
  else if (address.match(/^T[a-zA-Z0-9]{33}$/)) {
    baseUri = `tron:${address}`;
  }
  // USDT on TRON (same format as TRON)
  else if (address.match(/^T[a-zA-Z0-9]{33}$/) && currency && currency.toUpperCase() === 'USDT') {
    baseUri = `tron:${address}`;
  }
  // Default: assume Bitcoin for unknown formats
  else {
    baseUri = `bitcoin:${address}`;
  }

  // Add amount if provided (for better wallet compatibility)
  if (amount && amount > 0) {
    const separator = baseUri.includes('?') ? '&' : '?';
    baseUri += `${separator}amount=${amount}`;
  }

  return baseUri;
}

// 2. Enhanced QR generation with amount support
function generateCryptoQR(address, container, amount = null, currency = null) {
  console.log('Creating QR code with cryptocurrency URI format');

  // Create wrapper
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 20px;
  `;

  // Format URI with amount if available
  const cryptoUri = formatCryptocurrencyURI(address, amount, currency);
  console.log('Generated crypto URI:', cryptoUri);

  // Create animated loading placeholder
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = `
    width: 200px;
    height: 200px;
    border: 2px solid #e5e7eb;
    border-radius: 12px;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    position: relative;
    overflow: hidden;
  `;

  // Add shimmer effect to loading
  loadingDiv.innerHTML = `
    <div style="width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top: 3px solid #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
    <div style="color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 8px;">Génération du QR code...</div>
    <div style="color: #9ca3af; font-size: 12px;">Optimisé pour wallets mobiles</div>
    
    <!-- Shimmer effect -->
    <div style="position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.1), transparent); animation: shimmer 2s infinite;"></div>
    
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      @keyframes shimmer {
        0% { left: -100%; }
        100% { left: 100%; }
      }
    </style>
  `;

  wrapper.appendChild(loadingDiv);
  container.appendChild(wrapper);

  // Try QR generation with improved error handling
  tryQRGeneration(cryptoUri, address, wrapper, loadingDiv, amount, currency);
}

// 3. Enhanced address info display
function createAddressInfo(address, cryptoUri, amount = null, currency = null) {
  const addressInfo = document.createElement('div');
  addressInfo.style.cssText = `
    margin-top: 16px;
    text-align: center;
    max-width: 280px;
  `;

  const cryptoType = cryptoUri.split(':')[0].toUpperCase();
  const displayAmount = amount && currency ? `${amount} ${currency}` : '';

  // Enhanced info display with icons and better formatting
  addressInfo.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
    ">
      <div style="font-size: 13px; color: #16a34a; margin-bottom: 6px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px;">
        <span style="font-size: 16px;">📱</span>
        Scannez avec votre wallet ${cryptoType}
      </div>
      ${displayAmount ? `
        <div style="font-size: 12px; color: #059669; font-weight: 500; margin-bottom: 4px;">
          💰 Montant: ${displayAmount}
        </div>
      ` : ''}
      <div style="font-size: 11px; color: #10b981; opacity: 0.8;">
        ✅ Format URI compatible
      </div>
    </div>
    
    <div style="
      font-family: 'Courier New', monospace;
      font-size: 10px;
      color: #6b7280;
      word-break: break-all;
      line-height: 1.4;
      background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
      padding: 10px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      position: relative;
    ">
      <div style="font-size: 9px; color: #9ca3af; margin-bottom: 4px; text-transform: uppercase; font-weight: 500;">
        Adresse ${cryptoType}:
      </div>
      ${address}
      
      <!-- Copy icon -->
      <div onclick="copyToClipboard('${address}')" style="
        position: absolute;
        top: 8px;
        right: 8px;
        cursor: pointer;
        color: #6b7280;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s ease;
      " onmouseover="this.style.background='#f1f5f9'; this.style.color='#6366f1'" onmouseout="this.style.background='transparent'; this.style.color='#6b7280'">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
        </svg>
      </div>
    </div>
    
    <div style="font-size: 10px; color: #9ca3af; margin-top: 8px; line-height: 1.4;">
      💡 Tip: La plupart des wallets scannent automatiquement le montant
    </div>
  `;

  return addressInfo;
}

// 4. Enhanced QR image with better styling and interactions
function createEnhancedQRImage(qrUrl, cryptoUri, onLoad) {
  const qrImg = document.createElement('img');
  
  qrImg.style.cssText = `
    width: 200px;
    height: 200px;
    border: 3px solid #ffffff;
    border-radius: 16px;
    background: white;
    box-shadow: 
      0 4px 12px rgba(0, 0, 0, 0.1),
      0 1px 3px rgba(0, 0, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.5);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
    position: relative;
  `;

  // Enhanced hover effects
  qrImg.addEventListener('mouseenter', function() {
    this.style.transform = 'scale(1.05) translateY(-4px)';
    this.style.boxShadow = `
      0 20px 40px rgba(99, 102, 241, 0.2),
      0 8px 16px rgba(0, 0, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.5)
    `;
    this.style.borderColor = '#6366f1';
  });

  qrImg.addEventListener('mouseleave', function() {
    this.style.transform = 'scale(1) translateY(0)';
    this.style.boxShadow = `
      0 4px 12px rgba(0, 0, 0, 0.1),
      0 1px 3px rgba(0, 0, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.5)
    `;
    this.style.borderColor = '#ffffff';
  });

  // Click to open wallet with feedback
  qrImg.addEventListener('click', function() {
    // Visual feedback
    this.style.transform = 'scale(0.95)';
    setTimeout(() => {
      this.style.transform = 'scale(1.05) translateY(-4px)';
    }, 100);

    // Try to open wallet
    try {
      const link = document.createElement('a');
      link.href = cryptoUri;
      link.target = '_blank';
      link.click();
      
      // Show success feedback
      showToast('🚀 Ouverture du wallet...', 'success');
    } catch (e) {
      console.log('Could not open crypto URI directly');
      showToast('⚠️ Veuillez scanner manuellement', 'warning');
    }
  });

  qrImg.onload = onLoad;
  qrImg.src = qrUrl;
  
  return qrImg;
}

// 5. Toast notification system
function showToast(message, type = 'info') {
  // Remove existing toast
  const existing = document.querySelector('.crypto-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'crypto-toast';
  
  const colors = {
    success: { bg: '#10b981', border: '#059669' },
    warning: { bg: '#f59e0b', border: '#d97706' },
    error: { bg: '#ef4444', border: '#dc2626' },
    info: { bg: '#6366f1', border: '#4f46e5' }
  };

  const color = colors[type] || colors.info;

  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${color.bg};
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    border: 2px solid ${color.border};
    animation: slideInToast 0.3s ease-out;
  `;

  toast.innerHTML = message;

  // Add slide-in animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInToast {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(toast);

  // Auto remove after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideInToast 0.3s ease-out reverse';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }
  }, 3000);
}

// 6. Enhanced copy to clipboard function
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ Adresse copiée!', 'success');
    }).catch(err => {
      console.error('Failed to copy:', err);
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'absolute';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  
  try {
    document.execCommand('copy');
    showToast('✅ Adresse copiée!', 'success');
  } catch (err) {
    console.error('Failed to copy:', err);
    showToast('❌ Erreur de copie', 'error');
  }
  
  document.body.removeChild(textArea);
}

// Make functions globally available
window.copyToClipboard = copyToClipboard;
window.showToast = showToast;
````
Now, to integrate these improvements, you'll also want to update your main QR generation function to pass the amount and currency if available:
````
// Updated main QR generation function with amount support
// Replace your current createQrCode function with this enhanced version

function createQrCode(address, amount = null, currency = null) {
  console.log('createQrCode called with:', { address, amount, currency });

  if (createQrCode.processing) {
    console.log('QR code generation already in progress');
    return;
  }

  createQrCode.processing = true;

  try {
    const container = document.getElementById('qrcode-container');
    if (!container) {
      console.error('QR container not found');
      return;
    }

    // Clear container
    container.innerHTML = '';

    // Create QR code with enhanced features
    generateCryptoQR(address, container, amount, currency);

  } catch (error) {
    console.error('Error in createQrCode:', error);
    showQrCodeError(container, address);
  } finally {
    createQrCode.processing = false;
  }
}

// Updated tryQRGeneration with enhanced features
function tryQRGeneration(cryptoUri, address, wrapper, loadingDiv, amount = null, currency = null) {
  // Enhanced QR image creation
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(cryptoUri)}`;
  const qrImg = createEnhancedQRImage(qrUrl, cryptoUri, function() {
    console.log('QR code loaded successfully with URI:', cryptoUri);

    // Remove loading placeholder with fade effect
    if (wrapper.contains(loadingDiv)) {
      loadingDiv.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => {
        if (wrapper.contains(loadingDiv)) {
          wrapper.removeChild(loadingDiv);
        }
      }, 300);
    }

    // Add QR code to wrapper
    wrapper.appendChild(qrImg);

    // Add enhanced address info
    const addressInfo = createAddressInfo(address, cryptoUri, amount, currency);
    wrapper.appendChild(addressInfo);

    // Add fade-in animation
    qrImg.style.animation = 'fadeIn 0.5s ease-out';
    addressInfo.style.animation = 'fadeIn 0.5s ease-out 0.2s both';
  });

  // Handle QR generation error - try alternative method
  qrImg.onerror = function() {
    console.log('QR Server API failed, trying alternative method');
    tryAlternativeQR(cryptoUri, address, wrapper, loadingDiv, amount, currency);
  };
}

// Add CSS animations
const animationStyles = document.createElement('style');
animationStyles.textContent = `
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  @keyframes fadeOut {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.9);
    }
  }
`;
document.head.appendChild(animationStyles);
````
Finally, update your EJS template to pass the payment amount to the QR generation:
````
// Updated main QR generation function with amount support
// Replace your current createQrCode function with this enhanced version

function createQrCode(address, amount = null, currency = null) {
  console.log('createQrCode called with:', { address, amount, currency });

  if (createQrCode.processing) {
    console.log('QR code generation already in progress');
    return;
  }

  createQrCode.processing = true;

  try {
    const container = document.getElementById('qrcode-container');
    if (!container) {
      console.error('QR container not found');
      return;
    }

    // Clear container
    container.innerHTML = '';

    // Create QR code with enhanced features
    generateCryptoQR(address, container, amount, currency);

  } catch (error) {
    console.error('Error in createQrCode:', error);
    showQrCodeError(container, address);
  } finally {
    createQrCode.processing = false;
  }
}

// Updated tryQRGeneration with enhanced features
function tryQRGeneration(cryptoUri, address, wrapper, loadingDiv, amount = null, currency = null) {
  // Enhanced QR image creation
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(cryptoUri)}`;
  const qrImg = createEnhancedQRImage(qrUrl, cryptoUri, function() {
    console.log('QR code loaded successfully with URI:', cryptoUri);

    // Remove loading placeholder with fade effect
    if (wrapper.contains(loadingDiv)) {
      loadingDiv.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => {
        if (wrapper.contains(loadingDiv)) {
          wrapper.removeChild(loadingDiv);
        }
      }, 300);
    }

    // Add QR code to wrapper
    wrapper.appendChild(qrImg);

    // Add enhanced address info
    const addressInfo = createAddressInfo(address, cryptoUri, amount, currency);
    wrapper.appendChild(addressInfo);

    // Add fade-in animation
    qrImg.style.animation = 'fadeIn 0.5s ease-out';
    addressInfo.style.animation = 'fadeIn 0.5s ease-out 0.2s both';
  });

  // Handle QR generation error - try alternative method
  qrImg.onerror = function() {
    console.log('QR Server API failed, trying alternative method');
    tryAlternativeQR(cryptoUri, address, wrapper, loadingDiv, amount, currency);
  };
}

// Add CSS animations
const animationStyles = document.createElement('style');
animationStyles.textContent = `
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  @keyframes fadeOut {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.9);
    }
  }
`;
document.head.appendChild(animationStyles);
````
## Summary of Improvements

Your QR code is already working well! The improvements above will add:

1. **✨ Enhanced Visual Effects**: Better animations, hover effects, and loading states
2. **💰 Amount Integration**: QR codes will include the exact payment amount for better wallet compatibility
3. **📱 Better Mobile Experience**: Enhanced URI formats and wallet opening functionality
4. **🎯 User Feedback**: Toast notifications for copy actions and wallet opening
5. **🔄 Better Error Handling**: More graceful fallbacks and retry mechanisms
6. **📋 Easy Copy**: One-click address copying with visual feedback

The current QR code you showed is perfectly functional - these improvements will just make it more polished and user-friendly. Your implementation is already generating proper Bitcoin URIs and working with external QR services correctly!

Would you like me to help you implement any specific part of these improvements, or do you have any other aspects of the payment flow you'd like to enhance?