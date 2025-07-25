// Real QR Code generator for cryptocurrency payments
// Uses proper cryptocurrency URI formats for wallet compatibility

function createQrCode(address) {
  console.log('createQrCode called with address:', address);

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

    // Create QR code with proper cryptocurrency URI format
    generateCryptoQR(address, container);

  } catch (error) {
    console.error('Error in createQrCode:', error);
    showQrCodeError(container, address);
  } finally {
    createQrCode.processing = false;
  }
}

function generateCryptoQR(address, container) {
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

  // Determine cryptocurrency type and format URI
  const cryptoUri = formatCryptocurrencyURI(address);
  console.log('Generated crypto URI:', cryptoUri);

  // Create loading placeholder
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
  `;

  loadingDiv.innerHTML = `
    <div style="width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top: 3px solid #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
    <div style="color: #6b7280; font-size: 14px; font-weight: 500;">Génération du QR code...</div>
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;

  // Add loading to container first
  wrapper.appendChild(loadingDiv);
  container.appendChild(wrapper);

  // Try multiple QR generation methods
  tryQRGeneration(cryptoUri, address, wrapper, loadingDiv);
}

function formatCryptocurrencyURI(address) {
  // Detect cryptocurrency type based on address format and create proper URI

  // Bitcoin (starts with 1, 3, or bc1)
  if (address.match(/^[13][a-km-zA-Z1-9]{25,34}$/) || address.match(/^bc1[a-z0-9]{39,59}$/)) {
    return `bitcoin:${address}`;
  }

  // Ethereum (starts with 0x, 42 characters)
  if (address.match(/^0x[a-fA-F0-9]{40}$/)) {
    return `ethereum:${address}`;
  }

  // Litecoin (starts with L or M, or ltc1)
  if (address.match(/^[LM][a-km-zA-Z1-9]{26,33}$/) || address.match(/^ltc1[a-z0-9]{39,59}$/)) {
    return `litecoin:${address}`;
  }

  // Bitcoin Cash (starts with q, p, or bitcoincash:)
  if (address.match(/^[qp][a-z0-9]{41}$/) || address.startsWith('bitcoincash:')) {
    return address.startsWith('bitcoincash:') ? address : `bitcoincash:${address}`;
  }

  // Dogecoin (starts with D)
  if (address.match(/^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/)) {
    return `dogecoin:${address}`;
  }

  // TRON (starts with T, 34 characters)
  if (address.match(/^T[a-zA-Z0-9]{33}$/)) {
    return `tron:${address}`;
  }

  // Ripple (starts with r)
  if (address.match(/^r[a-zA-Z0-9]{24,34}$/)) {
    return `ripple:${address}`;
  }

  // Monero (long address starting with 4 or 8)
  if (address.match(/^[48][a-zA-Z0-9]{94}$/)) {
    return `monero:${address}`;
  }

  // Default: assume Bitcoin for unknown formats (most common)
  return `bitcoin:${address}`;
}

function tryQRGeneration(cryptoUri, address, wrapper, loadingDiv) {
  // Try QR Server API (more reliable than Google Charts)
  const qrImg = document.createElement('img');

  // Style the QR code image
  qrImg.style.cssText = `
    width: 200px;
    height: 200px;
    border: 2px solid #e5e7eb;
    border-radius: 12px;
    background: white;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  `;

  // Use QR Server API (free and reliable)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(cryptoUri)}`;

  // Handle successful QR generation
  qrImg.onload = function () {
    console.log('QR code loaded successfully with URI:', cryptoUri);

    // Remove loading placeholder
    if (wrapper.contains(loadingDiv)) {
      wrapper.removeChild(loadingDiv);
    }

    // Add hover effects
    qrImg.addEventListener('mouseenter', function () {
      this.style.transform = 'scale(1.02)';
      this.style.boxShadow = '0 8px 25px rgba(99, 102, 241, 0.15)';
    });

    qrImg.addEventListener('mouseleave', function () {
      this.style.transform = 'scale(1)';
      this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
    });

    // Make QR code clickable (opens wallet app)
    qrImg.style.cursor = 'pointer';
    qrImg.addEventListener('click', function () {
      // Try to open the crypto URI directly
      try {
        const link = document.createElement('a');
        link.href = cryptoUri;
        link.target = '_blank';
        link.click();
      } catch (e) {
        console.log('Could not open crypto URI directly');
      }
    });

    // Add QR code to wrapper
    wrapper.appendChild(qrImg);

    // Add address info below QR code
    const addressInfo = document.createElement('div');
    addressInfo.style.cssText = `
      margin-top: 16px;
      text-align: center;
      max-width: 240px;
    `;

    const cryptoType = cryptoUri.split(':')[0].toUpperCase();

    addressInfo.innerHTML = `
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px; font-weight: 500;">
        📱 Scannez avec votre wallet ${cryptoType}
      </div>
      <div style="font-family: 'Courier New', monospace; font-size: 10px; color: #9ca3af; word-break: break-all; line-height: 1.4; background: #f8fafc; padding: 8px; border-radius: 6px; border: 1px solid #e5e7eb;">
        ${address}
      </div>
      <div style="font-size: 10px; color: #16a34a; margin-top: 6px; font-weight: 500;">
        ✅ Format URI: ${cryptoType}
      </div>
    `;

    wrapper.appendChild(addressInfo);
  };

  // Handle QR generation error - try alternative method
  qrImg.onerror = function () {
    console.log('QR Server API failed, trying alternative method');
    tryAlternativeQR(cryptoUri, address, wrapper, loadingDiv);
  };

  // Set the QR image source (this triggers the load)
  qrImg.src = qrUrl;
}

function tryAlternativeQR(cryptoUri, address, wrapper, loadingDiv) {
  // Try QuickChart API as alternative
  const qrImg = document.createElement('img');

  qrImg.style.cssText = `
    width: 200px;
    height: 200px;
    border: 2px solid #e5e7eb;
    border-radius: 12px;
    background: white;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  `;

  // Use QuickChart API as backup
  const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(cryptoUri)}&size=200`;

  qrImg.onload = function () {
    console.log('QR code loaded with QuickChart API');

    if (wrapper.contains(loadingDiv)) {
      wrapper.removeChild(loadingDiv);
    }

    // Add click handler for wallet opening
    qrImg.style.cursor = 'pointer';
    qrImg.addEventListener('click', function () {
      try {
        window.open(cryptoUri, '_blank');
      } catch (e) {
        console.log('Could not open crypto URI');
      }
    });

    wrapper.appendChild(qrImg);

    // Add address info
    const addressInfo = document.createElement('div');
    addressInfo.style.cssText = `
      margin-top: 16px;
      text-align: center;
      max-width: 240px;
    `;

    const cryptoType = cryptoUri.split(':')[0].toUpperCase();

    addressInfo.innerHTML = `
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px; font-weight: 500;">
        📱 Scannez avec votre wallet ${cryptoType}
      </div>
      <div style="font-family: 'Courier New', monospace; font-size: 10px; color: #9ca3af; word-break: break-all; line-height: 1.4; background: #f8fafc; padding: 8px; border-radius: 6px; border: 1px solid #e5e7eb;">
        ${address}
      </div>
      <div style="font-size: 10px; color: #16a34a; margin-top: 6px; font-weight: 500;">
        ✅ Format URI compatible wallet
      </div>
    `;

    wrapper.appendChild(addressInfo);
  };

  qrImg.onerror = function () {
    console.log('All QR generation methods failed, showing fallback');
    if (wrapper.contains(loadingDiv)) {
      wrapper.removeChild(loadingDiv);
    }
    createQrCodeFallback(cryptoUri, address, wrapper);
  };

  qrImg.src = qrUrl;
}

function createQrCodeFallback(cryptoUri, address, wrapper) {
  console.log('Creating QR code fallback with URI support');

  const fallbackDiv = document.createElement('div');
  fallbackDiv.style.cssText = `
    width: 200px;
    height: 200px;
    border: 2px dashed #cbd5e1;
    border-radius: 16px;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    position: relative;
    cursor: pointer;
  `;

  fallbackDiv.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" style="margin-bottom: 12px;">
      <rect x="3" y="3" width="5" height="5"></rect>
      <rect x="3" y="16" width="5" height="5"></rect>
      <rect x="16" y="3" width="5" height="5"></rect>
      <path d="m5 5 13 13M13 13l3-3 3 3-3 3"></path>
    </svg>
    <div style="color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 4px;">Ouvrir Wallet</div>
    <div style="color: #9ca3af; font-size: 12px; text-align: center; line-height: 1.4;">
      Cliquez pour ouvrir<br>votre application wallet
    </div>
  `;

  // Make fallback clickable to open wallet
  fallbackDiv.addEventListener('click', function () {
    try {
      const link = document.createElement('a');
      link.href = cryptoUri;
      link.target = '_blank';
      link.click();
    } catch (e) {
      console.log('Could not open crypto URI from fallback');
    }
  });

  wrapper.appendChild(fallbackDiv);

  // Add address info
  const addressInfo = document.createElement('div');
  addressInfo.style.cssText = `
    text-align: center;
    max-width: 240px;
  `;

  const cryptoType = cryptoUri.split(':')[0].toUpperCase();

  addressInfo.innerHTML = `
    <div style="font-size: 12px; color: #f59e0b; margin-bottom: 8px; font-weight: 500;">
      ⚠️ QR code indisponible - Cliquez ci-dessus
    </div>
    <div style="font-family: 'Courier New', monospace; font-size: 10px; color: #6b7280; word-break: break-all; line-height: 1.4; background: #fef3c7; padding: 8px; border-radius: 6px; border: 1px solid #f59e0b;">
      ${address}
    </div>
    <div style="font-size: 11px; color: #9ca3af; margin-top: 6px;">
      Format: ${cryptoType} URI
    </div>
  `;

  wrapper.appendChild(addressInfo);
}

function showQrCodeError(container, address) {
  console.log('Showing QR code error fallback');

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px;">
      <div style="width: 200px; height: 200px; border: 2px dashed #ef4444; border-radius: 16px; background: #fef2f2; display: flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 16px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="margin-bottom: 12px;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <div style="color: #ef4444; font-size: 14px; font-weight: 500;">Erreur QR</div>
      </div>
      <div style="text-align: center; max-width: 240px;">
        <div style="font-size: 12px; color: #ef4444; margin-bottom: 8px; font-weight: 500;">
          ❌ Impossible de générer le QR code
        </div>
        <div style="font-family: 'Courier New', monospace; font-size: 10px; color: #6b7280; word-break: break-all; line-height: 1.4; background: #f8fafc; padding: 8px; border-radius: 6px; border: 1px solid #e5e7eb;">
          ${address}
        </div>
        <div style="font-size: 11px; color: #9ca3af; margin-top: 6px;">
          Veuillez copier l'adresse manuellement
        </div>
      </div>
    </div>
  `;
}

// Make function globally available
window.createQrCode = createQrCode;

console.log('Cryptocurrency URI QR Code library loaded successfully');
