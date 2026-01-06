/**
 * Payment form submission handler
 */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('payment-form');
    const errorMessage = document.getElementById('error-message');
    const submitButton = document.getElementById('submit-button');
    const buttonText = document.getElementById('button-text');
    const buttonSpinner = document.getElementById('button-loading-spinner');
    const countrySelect = document.getElementById('country');
    const phoneInputGroup = document.getElementById('phone-input-group');
    const phoneInput = document.getElementById('phone');
    const operatorSelectGroup = document.getElementById('operator-select-group');
    const operatorSelect = document.getElementById('operator');
    const retryContainer = document.getElementById('retry-container');
    const otpInputGroup = document.getElementById('otp-input-group');
    const otpInput = document.getElementById('otp');

    // New crypto payment elements
    const paymentMethodRadios = document.querySelectorAll('input[name="paymentMethod"]');
    const mobileMoneyFields = document.getElementById('mobile-money-fields');
    const cryptoFields = document.getElementById('crypto-fields');
    const cryptoCurrencySelect = document.getElementById('crypto-currency');
    const cryptoEstimate = document.getElementById('crypto-estimate');
    const cryptoAmount = document.getElementById('crypto-amount');
    const cryptoRate = document.getElementById('crypto-rate');

    const formPresent = !!form; // Check if the form element itself exists on the page

    // Only run full form setup if the form is actually rendered by EJS
    if (formPresent) {
        if (!countrySelect || !phoneInputGroup || !phoneInput || !submitButton || !operatorSelectGroup || !operatorSelect || !otpInputGroup || !otpInput) {
            console.error('Essential form elements not found, though payment form is present!');
            // No return here if some elements are missing but form is there, page might be partially usable or in a specific state.
        }

        // Define countries for each gateway based on the new rule
        // Countries that use CinetPay
        const cinetpayCountries = [
            'BF', // Burkina Faso
            'ML', // Mali
            'NE', // Niger
            // 'BJ', // Bénin - Now using FeexPay for both payments and withdrawals
            'CI', // Côte d\'Ivoire
            'CM', // Cameroun
            'SN', // Sénégal
            // 'TG'  // Togo - Now using FeexPay for payments, CinetPay for withdrawals
        ];

        // Countries that use FeexPay
        const feexpayCountries = ['CG', 'GN', 'GA', 'CD', 'KE', 'BJ', 'TG']; // Added Benin and Togo to FeexPay

        // Only include FeexPay operators for countries that still use FeexPay
        const feexpayOperators = {
            'CG': ['mtn_cg'], // Congo Brazzaville
            'GN': [], // Guinea (operators TBD)
            'GA': [], // Gabon (operators TBD)
            'CD': [], // Democratic Republic of Congo (operators TBD)
            'KE': [], // Kenya (operators TBD)
            'BJ': ['mtn', 'moov', 'celtiis_bj'], // Benin mobile money operators
            'TG': ['togocom_tg', 'moov_tg'], // Togo operators for FeexPay payments
            // Add operators for GN, GA, CD, KE if needed
        };
        // NOTE: Payments for Togo are handled by FeexPay, withdrawals by CinetPay in the backend.

        const getCurrencyForCountry = (countryCode) => {
            const countryCurrencyMap = {
                // CinetPay countries
                'BJ': 'XOF', 'CI': 'XOF', 'SN': 'XOF', 'ML': 'XOF', 'NE': 'XOF', 'BF': 'XOF', 'CM': 'XAF',
                // FeexPay countries
                'TG': 'XOF', 'CG': 'XAF', 'GA': 'XAF', 'CD': 'CDF', 'KE': 'KES', 'GN': 'GNF',
            };
            return countryCurrencyMap[countryCode] || 'XAF';
        };

        const handlePaymentMethodChange = () => {
            const selectedMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;

            // Update visual selection state
            const allMethodCards = document.querySelectorAll('.method-card');
            allMethodCards.forEach(card => {
                card.classList.remove('selected');
            });

            // Add selected class to the currently selected method
            if (selectedMethod) {
                const selectedMethodCard = document.querySelector(`.method-card[data-method="${selectedMethod}"]`);
                if (selectedMethodCard) {
                    selectedMethodCard.classList.add('selected');
                }
            }

            // Update amount display based on payment method
            const amountDisplay = document.getElementById('amount-display');
            if (amountDisplay) {
                console.log('Updating amount display - selectedMethod:', selectedMethod, 'window.usdAmount:', window.usdAmount, 'typeof window.usdAmount:', typeof window.usdAmount);
                if (selectedMethod === 'cryptocurrency' && window.usdAmount && typeof window.usdAmount === 'number') {
                    // Show USD amount for crypto payments
                    console.log('Setting crypto amount display to USD:', window.usdAmount);
                    amountDisplay.textContent = `Montant dû: ${window.usdAmount.toFixed(2)} USD`;
                    // Update global payment amount for crypto estimates
                    window.paymentAmount = window.usdAmount.toString();
                    window.paymentCurrency = 'USD';
                } else {
                    // Show original XAF amount for mobile money or fallback
                    console.log('Setting amount display to original currency:', window.originalAmount, window.originalCurrency);
                    const displayAmount = (typeof window.originalAmount === 'number') ? window.originalAmount.toFixed(2) : window.originalAmount;
                    amountDisplay.textContent = `Montant dû: ${displayAmount} ${window.originalCurrency}`;
                    // Reset to original amounts
                    window.paymentAmount = window.originalAmount.toString();
                    window.paymentCurrency = window.originalCurrency;
                }
            }

            if (selectedMethod === 'mobile_money') {
                mobileMoneyFields?.classList.remove('hidden');
                cryptoFields?.classList.add('hidden');

                // Reset crypto fields
                if (cryptoCurrencySelect) cryptoCurrencySelect.value = '';
                if (cryptoEstimate) cryptoEstimate.classList.add('hidden');

                // Update form for current country
                updateFormForCountry();
            } else if (selectedMethod === 'cryptocurrency') {
                // Check if beta/crypto features are enabled
                if (!window.isBeta) {
                    console.log('Crypto payments are disabled (beta flag is false)');
                    // Force back to mobile money
                    const mobileMoneyRadio = document.querySelector('input[name="paymentMethod"][value="mobile_money"]');
                    if (mobileMoneyRadio) {
                        mobileMoneyRadio.checked = true;
                        // Recursively call to handle mobile money selection
                        handlePaymentMethodChange();
                        return;
                    }
                }
                
                mobileMoneyFields?.classList.add('hidden');
                cryptoFields?.classList.remove('hidden');

                // Reset mobile money fields
                if (countrySelect) countrySelect.value = '';
                if (phoneInput) phoneInput.value = '';
                if (operatorSelect) operatorSelect.value = '';
                if (operatorSelectGroup) operatorSelectGroup.classList.add('hidden');
                if (phoneInputGroup) phoneInputGroup.classList.add('hidden');
                if (otpInputGroup) otpInputGroup.classList.add('hidden');
                
                // Refresh crypto estimate if cryptocurrency is already selected
                if (cryptoCurrencySelect?.value) {
                    handleCryptoCurrencyChange();
                }
            }
        };

        const handleCryptoCurrencyChange = async () => {
            const selectedCrypto = cryptoCurrencySelect?.value;
            if (!selectedCrypto || !window.paymentAmount || !window.paymentCurrency) {
                if (cryptoEstimate) cryptoEstimate.classList.add('hidden');
                return;
            }

            try {
                // Get crypto estimate
                const response = await fetch(`/api/payments/crypto/estimate?amount=${window.paymentAmount}&fromCurrency=${window.paymentCurrency}&toCurrency=${selectedCrypto}`);
                const result = await response.json();

                if (response.ok && result.success) {
                    const estimate = result.data;
                    if (cryptoAmount) cryptoAmount.textContent = `${estimate.estimatedAmount} ${selectedCrypto}`;
                    if (cryptoEstimate) cryptoEstimate.classList.remove('hidden');
                }
                else {
                    console.error('Failed to get crypto estimate:', result.message);
                    if (cryptoEstimate) cryptoEstimate.classList.add('hidden');
                }
            }
            catch (error) {
                console.error('Error getting crypto estimate:', error);
                if (cryptoEstimate) cryptoEstimate.classList.add('hidden');
            }
        };

        const updateFormForCountry = () => {
            if (!countrySelect || !operatorSelect || !phoneInputGroup || !phoneInput || !operatorSelectGroup || !otpInputGroup || !otpInput) return; // Guard if elements are missing

            const selectedCountry = countrySelect.value;
            const countryOperators = feexpayOperators[selectedCountry] || [];
            const selectedOperator = operatorSelect.value; // Get value after potential prefill

            operatorSelect.innerHTML = '<option value="" disabled selected>-- Sélectionner l\'opérateur de paiement --</option>';
            operatorSelect.required = false;
            operatorSelectGroup.classList.add('hidden');
            otpInputGroup.classList.add('hidden'); // Hide OTP by default
            otpInput.required = false;

            if (feexpayCountries.includes(selectedCountry)) {
                phoneInputGroup.classList.remove('hidden');
                phoneInput.required = true;

                if (countryOperators.length > 0) {
                    countryOperators.forEach(op => {
                        const option = document.createElement('option');
                        option.value = op;
                        option.textContent = op.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        operatorSelect.appendChild(option);
                    });
                    operatorSelectGroup.classList.remove('hidden');
                    operatorSelect.required = true;

                    if (typeof window.prefillOperator !== 'undefined' && window.prefillOperator && countryOperators.includes(window.prefillOperator)) {
                        operatorSelect.value = window.prefillOperator;
                    }
                }
                else {
                    // Hide OTP field if no operator selection or not applicable
                    otpInputGroup.classList.add('hidden');
                    otpInput.required = false;
                    otpInput.value = '';
                }
            }
            else {
                // CinetPay countries don't require phone number or operator selection
                phoneInputGroup.classList.add('hidden');
                phoneInput.required = false;
                phoneInput.value = '';
                // Hide OTP field for CinetPay countries
                otpInputGroup.classList.add('hidden');
                otpInput.required = false;
                otpInput.value = '';
            }
        };

        // Payment method switching logic
        if (paymentMethodRadios.length > 0) {
            paymentMethodRadios.forEach(radio => {
                radio.addEventListener('change', handlePaymentMethodChange);
            });
            handlePaymentMethodChange(); // Initial call
        }

        // Add click handlers to method cards for better UX
        const methodCards = document.querySelectorAll('.method-card');
        methodCards.forEach(card => {
            card.addEventListener('click', function(e) {
                // Prevent double handling if radio button was clicked directly
                if (e.target.type === 'radio') return;
                
                const radio = this.querySelector('input[type="radio"]');
                if (radio && !radio.checked) {
                    radio.checked = true;
                    handlePaymentMethodChange();
                }
            });
        });

        if (countrySelect) { // Ensure countrySelect exists before adding listener or calling update
            countrySelect.addEventListener('change', () => {
                updateFormForCountry(); // Call on country change
                // Removed Orange Senegal OTP logic since SN now uses CinetPay
                // Additional logic to specifically update OTP field visibility based on operator for the new country
                // This is because operator selection might not trigger a change event itself if it's auto-selected or has only one option.
                // const currentSelectedOperator = operatorSelect.value;
                // if (countrySelect.value === 'SN' && currentSelectedOperator === 'orange_sn') {
                //     otpInputGroup.classList.remove('hidden');
                //     otpInput.required = true;
                // } else {
                //     otpInputGroup.classList.add('hidden');
                //     otpInput.required = false;
                //     otpInput.value = '';
                // }
            });
            updateFormForCountry(); // Initial call to set up form based on pre-selected country/operator
        }

        // Crypto currency change handler
        if (cryptoCurrencySelect) {
            cryptoCurrencySelect.addEventListener('change', handleCryptoCurrencyChange);
        }


        // Handle page load based on paymentStatus if the form is meant to be interactive
        if (window.paymentStatus === 'PENDING_USER_INPUT') {
            console.log('Status is PENDING_USER_INPUT. Initializing form for user input.');
            if (window.prefillCountryCode && countrySelect) {
                countrySelect.value = window.prefillCountryCode;
                // updateFormForCountry(); // This will be called after operator prefill to ensure correct state
            }
            if (window.prefillPhoneNumber && phoneInput) {
                phoneInput.value = window.prefillPhoneNumber;
            }
            // Operator prefill is handled by updateFormForCountry, now ensure updateFormForCountry is called *after* operator might be prefilled.
            // If prefillOperator is present, updateFormForCountry inside countrySelect change listener might not have run yet with the prefilled operator.
            // So, manually call it again if prefillOperator is set to ensure OTP field logic runs based on the prefilled operator.
            if (window.prefillOperator && operatorSelect) {
                // The operator select options are populated within updateFormForCountry, so we need to ensure it runs once to populate,
                // then potentially again if prefillOperator is set to correctly show/hide OTP based on the prefilled operator.
                // We need a slight adjustment here: updateFormForCountry already handles operator pre-selection if prefillOperator is set.
                // The key is that updateFormForCountry must run to set the operator value and then decide OTP visibility.
            }
            updateFormForCountry(); // This call will handle prefill of operator and OTP field visibility

            if (submitButton) submitButton.disabled = false; // Ensure button is enabled

        }
        else if (window.paymentStatus === 'PENDING_PROVIDER') {
            // This case is special: EJS might render a simplified view.
            // JS here will primarily manage the button state if the button is part of that simplified view.
            // The EJS for PENDING_PROVIDER now includes the button structure.
            console.log('Status is PENDING_PROVIDER. Setting up UI (button state).');

            if (submitButton && buttonText && buttonSpinner) {
                buttonText.textContent = 'Confirmer sur le téléphone';
                buttonSpinner.classList.remove('hidden');
                submitButton.disabled = true;
            }
            // The message "Please check your phone..." is already handled by EJS in its own div.
            // If form elements were on the page for PENDING_PROVIDER (they are not currently as per EJS),
            // this is where you'd prefill and disable them.
            // e.g. if (countrySelect) countrySelect.value = prefillCountryCode; countrySelect.disabled = true; etc.
        }


        const handleSubmission = async (e) => {
            if (e) e.preventDefault();
            if (!form || !countrySelect || !phoneInput || !submitButton || !operatorSelect || !errorMessage) return; // Guard critical elements
            console.log('Gestionnaire de soumission de paiement déclenché');

            errorMessage.textContent = '';
            if (buttonText) buttonText.textContent = 'Traitement...';
            if (buttonSpinner) buttonSpinner.classList.remove('hidden');
            if (submitButton) submitButton.disabled = true;
            if (retryContainer) retryContainer.classList.add('hidden');

            const selectedPaymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;

            let formData = {};

            if (selectedPaymentMethod === 'cryptocurrency') {
                // Check if beta/crypto features are enabled
                if (!window.isBeta) {
                    console.log('Crypto payments are disabled (beta flag is false)');
                    errorMessage.textContent = 'Les paiements en cryptomonnaie ne sont pas disponibles actuellement.';
                    if (buttonSpinner) buttonSpinner.classList.add('hidden');
                    if (buttonText) buttonText.textContent = 'Procéder au paiement';
                    if (submitButton) submitButton.disabled = false;
                    return;
                }
                
                // Handle crypto payment
                const selectedCrypto = cryptoCurrencySelect?.value;

                if (!selectedCrypto) {
                    errorMessage.textContent = 'Veuillez sélectionner une cryptomonnaie.';
                    if (buttonSpinner) buttonSpinner.classList.add('hidden');
                    if (buttonText) buttonText.textContent = 'Procéder au paiement';
                    if (submitButton) submitButton.disabled = false;
                    return;
                }

                formData = {
                    paymentCurrency: selectedCrypto,
                    // No countryCode needed for crypto payments
                };

                console.log(`Crypto payment selected: ${selectedCrypto}`);
            }
            else {
                // Handle mobile money payment (existing logic)
                const selectedCountry = countrySelect.value;
                const requiresPhone = feexpayCountries.includes(selectedCountry);
                const requiresOperator = !operatorSelectGroup.classList.contains('hidden');
                const determinedCurrency = getCurrencyForCountry(selectedCountry);
                const selectedOperatorValue = operatorSelect.value; // Get current operator value

                if (!selectedCountry) {
                    errorMessage.textContent = 'Veuillez sélectionner votre pays.';
                    if (buttonSpinner) buttonSpinner.classList.add('hidden');
                    if (buttonText) buttonText.textContent = 'Procéder au paiement';
                    if (submitButton) submitButton.disabled = false;
                    return;
                }
                if (requiresOperator && !selectedOperatorValue) {
                    errorMessage.textContent = 'Veuillez sélectionner un opérateur de paiement.';
                    if (buttonSpinner) buttonSpinner.classList.add('hidden');
                    if (buttonText) buttonText.textContent = 'Procéder au paiement';
                    if (submitButton) submitButton.disabled = false;
                    return;
                }
                if (requiresPhone && !phoneInput.value) {
                    errorMessage.textContent = 'Veuillez entrer votre numéro de téléphone pour le paiement.';
                    if (buttonSpinner) buttonSpinner.classList.add('hidden');
                    if (buttonText) buttonText.textContent = 'Procéder au paiement';
                    if (submitButton) submitButton.disabled = false;
                    return;
                }

                console.log(`Devise déterminée pour ${selectedCountry}: ${determinedCurrency}`);

                formData = {
                    paymentCurrency: determinedCurrency,
                    countryCode: selectedCountry,
                    operator: requiresOperator ? selectedOperatorValue : undefined,
                    phoneNumber: requiresPhone ? phoneInput.value : undefined,
                };
            }
            // Removed Orange Senegal OTP logic since SN now uses CinetPay
            // if (selectedCountry === 'SN' && selectedOperatorValue === 'orange_sn' && otpInput.value) {
            //     formData.otp = otpInput.value;
            // }
            Object.keys(formData).forEach(key => formData[key] === undefined && delete formData[key]);

            console.log('Soumission des données de paiement:', formData);

            try {
                const response = await fetch(`/api/payments/intents/${window.sessionId}/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify(formData),
                });
                const result = await response.json();
                console.log('Réponse de soumission du paiement:', result);

                if (!response.ok || !result.success) {
                    throw new Error(result.message || 'Échec de l\'initiation du paiement. Veuillez vérifier les détails et réessayer.');
                }

                if (result.data && result.data.gatewayCheckoutUrl) {
                    console.log('Redirection vers la passerelle de paiement:', result.data.gatewayCheckoutUrl);
                    window.location.href = result.data.gatewayCheckoutUrl;
                    if (buttonText) buttonText.textContent = 'Redirection...';
                }
                else {
                    // Handle different payment flows based on method
                    if (selectedPaymentMethod === 'cryptocurrency') {
                        // Crypto payment flow
                        if (buttonText) buttonText.textContent = 'Paiement crypto initié';
                        errorMessage.textContent = 'Votre paiement crypto a été initié. Veuillez suivre les instructions pour envoyer votre paiement.';
                        errorMessage.className = 'text-center mt-4 p-3 bg-orange-100 text-orange-800 border border-orange-300 rounded-md text-base min-h-[2.5rem] font-medium';

                        // Update global status and start polling for crypto payments
                        if (result.data && result.data.status === 'WAITING_FOR_CRYPTO_DEPOSIT') {
                            window.paymentStatus = 'WAITING_FOR_CRYPTO_DEPOSIT';
                            console.log('Paiement crypto initié, nouveau statut WAITING_FOR_CRYPTO_DEPOSIT. Rechargement de la page pour afficher les instructions.');
                            // Refresh the page to show crypto deposit instructions
                            setTimeout(() => {
                                window.location.reload();
                            }, 1000); // Small delay to let user see the success message
                        }
                        else if (result.data && result.data.status === 'PROCESSING') {
                            window.paymentStatus = 'PROCESSING';
                            errorMessage.textContent = 'Votre paiement crypto est en cours de traitement. Vérification des mises à jour...';
                            errorMessage.className = 'text-center mt-4 p-3 bg-blue-100 text-blue-800 border border-blue-300 rounded-md text-base min-h-[2.5rem] font-medium';
                            console.log('Paiement crypto initié, nouveau statut PROCESSING. Démarrage du sondage.');
                            startPolling();
                        }
                        else {
                            // For any other status, also refresh to show the updated state
                            console.log('Paiement crypto initié avec statut:', result.data?.status || 'unknown');
                            setTimeout(() => {
                                window.location.reload();
                            }, 1500);
                        }
                    }
                    else {
                        // This is likely a request-to-pay flow (e.g., FeexPay USSD)
                        const requiresPhone = selectedPaymentMethod === 'mobile_money' && feexpayCountries.includes(countrySelect.value);
                        if (requiresPhone) { // Check if it was a flow that involves a phone (most request-to-pay)
                            if (buttonText) buttonText.textContent = 'Confirmer sur le téléphone';
                            errorMessage.textContent = 'Veuillez vérifier votre téléphone pour approuver la demande de paiement.';
                            // Apply yellow styling for this specific message
                            errorMessage.className = 'text-center mt-4 p-3 bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-md text-base min-h-[2.5rem] font-medium';

                            // Update global status and start polling if now PENDING_PROVIDER
                            if (result.data && result.data.status === 'PENDING_PROVIDER') {
                                window.paymentStatus = 'PENDING_PROVIDER'; // Update global JS status variable
                                console.log('Demande de paiement réussie, nouveau statut PENDING_PROVIDER. Démarrage du sondage.');
                                startPolling();
                            }
                            else if (result.data && result.data.status === 'PROCESSING') {
                                window.paymentStatus = 'PROCESSING';
                                errorMessage.textContent = 'Votre paiement est en cours de traitement. Vérification des mises à jour...';
                                // Apply yellow styling for this specific message as well (or a slightly different one for processing)
                                errorMessage.className = 'text-center mt-4 p-3 bg-blue-100 text-blue-800 border border-blue-300 rounded-md text-base min-h-[2.5rem] font-medium';
                                console.log('Demande de paiement réussie, nouveau statut PROCESSING. Démarrage du sondage.');
                                startPolling();
                            }
                        }
                        else {
                            // Should not happen if no redirect and not a phone-based payment
                            throw new Error('Paiement initié, mais aucune URL de redirection reçue et non un paiement par téléphone.');
                        }
                    }
                }
            }
            catch (error) {
                console.error('Erreur lors de la soumission du paiement:', error);
                errorMessage.textContent = error.message || 'Une erreur inattendue est survenue. Veuillez réessayer.';
                // Reset to default red error styling if an actual error occurs during submission
                errorMessage.className = 'text-red-600 text-sm text-center mt-3 min-h-[1.25rem]';
                if (buttonText) buttonText.textContent = 'Procéder au paiement';
                if (buttonSpinner) buttonSpinner.classList.add('hidden');
                if (submitButton) submitButton.disabled = false;
                if (retryContainer) retryContainer.classList.remove('hidden');
            }
            return false;
        };

        // Attach listeners only if the form is present and submit button exists
        if (form) { // The form element itself
            form.addEventListener('submit', handleSubmission);
        }
        if (submitButton && window.paymentStatus === 'PENDING_USER_INPUT') { // Only allow click submission if form is active
            submitButton.addEventListener('click', function (e) {
                e.preventDefault(); // Prevent default form submission via button click
                handleSubmission(e);
            });
        }
    }
    else {
        // Logic for when the payment form is NOT rendered by EJS (e.g. status is SUCCEEDED, FAILED, etc.)
        // This block can be used to initialize any JS behavior for those non-form pages if needed.
        // For PENDING_PROVIDER, EJS now includes the button, so JS needs to set its state.
        if (window.paymentStatus === 'PENDING_PROVIDER') {
            console.log('Le statut est PENDING_PROVIDER (pas de formulaire). Réglage de l\'état du bouton si le bouton existe.');
            // The submitButton, buttonText, buttonSpinner are already potentially grabbed at the top.
            // EJS for PENDING_PROVIDER should be rendering these button elements.
            if (submitButton && buttonText && buttonSpinner) {
                buttonText.textContent = 'Confirmer sur le téléphone';
                buttonSpinner.classList.remove('hidden');
                submitButton.disabled = true;
            }
            if (errorMessage) { // The div with id 'error-message' is also rendered in this EJS state.
                errorMessage.textContent = 'Veuillez vérifier votre téléphone pour approuver la demande de paiement.';
            }
        }
        console.log(`Page de paiement chargée avec le statut : ${window.paymentStatus}. Le formulaire n'est pas actif ou entièrement rendu.`);
    }

    // --- NEW: J'ai payé button logic ---
    const checkFeexpayStatusButton = document.getElementById('check-feexpay-status-button');
    const checkFeexpayButtonText = document.getElementById('check-feexpay-button-text');
    const checkFeexpayLoadingSpinner = document.getElementById('check-feexpay-loading-spinner');
    const checkFeexpayStatusMessage = document.getElementById('check-feexpay-status-message');

    if (checkFeexpayStatusButton) {
        checkFeexpayStatusButton.addEventListener('click', async () => {
            if (!window.sessionId) {
                console.error('ID de session non disponible pour la vérification du statut FeexPay.');
                if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = 'Erreur : ID de session manquant.';
                return;
            }

            if (checkFeexpayButtonText) checkFeexpayButtonText.textContent = 'Vérification du statut...';
            if (checkFeexpayLoadingSpinner) checkFeexpayLoadingSpinner.classList.remove('hidden');
            checkFeexpayStatusButton.disabled = true;
            if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = ''; // Clear previous messages

            try {
                console.log(`Vérification manuelle du statut FeexPay pour la session : ${window.sessionId}`);
                const response = await fetch(`/api/payments/intents/${window.sessionId}/feexpay-status`);
                const result = await response.json();

                if (response.ok && result.success) {
                    console.log('Vérification du statut FeexPay réussie :', result.data);
                    if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = 'Statut vérifié avec succès. Mise à jour...';
                    // Reload the page to reflect the new status
                    window.location.reload();
                }
                else {
                    console.error('Échec de la vérification du statut FeexPay :', result.message);
                    if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = result.message || 'Échec de la vérification du statut. Veuillez réessayer.';
                }
            }
            catch (error) {
                console.error('Erreur lors de la vérification du statut FeexPay :', error);
                if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = 'Une erreur est survenue. Veuillez réessayer.';
            }
            finally {
                if (checkFeexpayButtonText) checkFeexpayButtonText.textContent = 'J\'ai payé - Vérifier le statut';
                if (checkFeexpayLoadingSpinner) checkFeexpayLoadingSpinner.classList.add('hidden');
                checkFeexpayStatusButton.disabled = false;
            }
        });
    }

    // --- Status Polling Logic ---
    let pollingIntervalId = null;
    let pollCount = 0;
    const maxPolls = 24; // Poll for 2 minutes (24 polls * 5 seconds = 120 seconds)
    const pollInterval = 5000; // 5 seconds

    const startPolling = () => {
        if (!window.sessionId) {
            console.error('ID de session non disponible, impossible de démarrer le sondage.');
            return;
        }
        // Clear any existing interval to avoid multiple pollers
        if (pollingIntervalId) clearInterval(pollingIntervalId);

        console.log(`Démarrage du sondage du statut pour la session : ${window.sessionId}`);
        pollCount = 0; // Reset poll count
        pollingIntervalId = setInterval(checkPaymentStatus, pollInterval);
        // Optionally, call it once immediately
        // checkPaymentStatus();
    };

    const checkPaymentStatus = async () => {
        if (!window.sessionId) {
            console.error('ID de session non disponible pour le sondage.');
            if (pollingIntervalId) clearInterval(pollingIntervalId);
            return;
        }

        pollCount++;
        console.log(`Sondage du statut de paiement (Tentative ${pollCount}/${maxPolls}) : ${window.sessionId}`);

        try {
            const response = await fetch(`/api/payments/intents/${window.sessionId}/status`);
            if (!response.ok) {
                console.error('Erreur lors de la récupération du statut de paiement :', response.statusText);
                // Optionally stop polling on network errors or specific HTTP error codes
                if (pollCount >= maxPolls) {
                    console.log('Nombre maximal de tentatives de sondage atteint. Arrêt du sondage.');
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    // Update UI to inform user polling has stopped, if desired
                    if (errorMessage && (window.paymentStatus === 'PENDING_PROVIDER' || window.paymentStatus === 'PROCESSING')) {
                        errorMessage.textContent = 'Le délai de vérification du statut a expiré. Veuillez rafraîchir la page pour voir le dernier statut.';
                    }
                }
                return;
            }

            const result = await response.json();
            if (result.success && result.data) {
                const newStatus = result.data;
                console.log('Statut sondé :', newStatus);

                // Update global paymentStatus if it's different, for other UI elements that might depend on it
                // Note: This client-side update of `paymentStatus` is for immediate UI reaction. Page reload is the source of truth.
                // window.paymentStatus = newStatus; // Or however you want to manage this global if needed elsewhere

                if (newStatus === 'SUCCEEDED' || newStatus === 'FAILED' || newStatus === 'CANCELED' || newStatus === 'CONFIRMED') {
                    console.log(`Le statut de paiement est final : ${newStatus}. Rechargement de la page.`);
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    window.location.reload();
                }
                else if (newStatus === 'PENDING_PROVIDER' || newStatus === 'PROCESSING' || newStatus === 'WAITING_FOR_CRYPTO_DEPOSIT' || newStatus === 'PARTIALLY_PAID') {
                    // Continue polling
                    if (window.paymentStatus !== newStatus && errorMessage) { // If status changed but still pending, update message
                        window.paymentStatus = newStatus; // Update local JS variable for consistency
                        if (newStatus === 'PROCESSING') {
                            errorMessage.textContent = 'Le paiement est maintenant en cours de traitement avec le fournisseur...';
                        }
                        else if (newStatus === 'WAITING_FOR_CRYPTO_DEPOSIT') {
                            errorMessage.textContent = 'En attente de votre dépôt crypto. Veuillez envoyer le montant exact à l\'adresse fournie.';
                        }
                        else if (newStatus === 'PARTIALLY_PAID') {
                            // Enhanced partial payment message with specific amounts
                            if (window.paidAmount && window.cryptoPayAmount && window.cryptoPayCurrency) {
                                errorMessage.textContent = `Paiement partiel reçu: ${window.paidAmount} ${window.cryptoPayCurrency}. Restant à envoyer: ${window.cryptoPayAmount} ${window.cryptoPayCurrency}.`;
                            } else {
                                errorMessage.textContent = 'Paiement partiel reçu. Veuillez envoyer le montant restant indiqué ci-dessous.';
                            }
                        }
                        else {
                            errorMessage.textContent = 'Toujours en attente de confirmation sur votre téléphone...';
                        }
                    }
                    if (pollCount >= maxPolls) {
                        console.log('Nombre maximal de tentatives de sondage atteint. Arrêt du sondage.');
                        if (pollingIntervalId) clearInterval(pollingIntervalId);
                        if (errorMessage) {
                            errorMessage.textContent = 'Toujours en attente de confirmation de paiement. Vous pouvez rafraîchir la page pour vérifier ou continuer d\'attendre.';
                        }
                    }
                }
                else {
                    // Unexpected status or PENDING_USER_INPUT (should not happen if polling started correctly)
                    console.log(`Statut inattendu du sondage : ${newStatus}. Arrêt du sondage.`);
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                }
            }
            else {
                console.error('Échec de la récupération du statut de paiement depuis le sondage :', result.message);
            }
        }
        catch (error) {
            console.error('Erreur lors du sondage du statut de paiement :', error);
            if (pollCount >= maxPolls) {
                console.log('Nombre maximal de tentatives de sondage atteint en raison d\'une erreur. Arrêt du sondage.');
                if (pollingIntervalId) clearInterval(pollingIntervalId);
            }
        }
    };

    if (window.paymentStatus === 'PENDING_PROVIDER' || window.paymentStatus === 'PROCESSING' || window.paymentStatus === 'WAITING_FOR_CRYPTO_DEPOSIT' || window.paymentStatus === 'PARTIALLY_PAID') {
        console.log(`Le statut initial est ${window.paymentStatus}. Démarrage du sondage du statut pour la session : ${window.sessionId}`);
        console.log('JS Initial Load - cryptoQrCodeBase64 length:', window.cryptoQrCodeBase64 ? window.cryptoQrCodeBase64.length : 'empty');
        console.log('JS Initial Load - cryptoAddress:', window.cryptoAddress);
        // Initial message update for different statuses if not already set by other logic
        if (window.paymentStatus === 'PROCESSING' && errorMessage) {
            errorMessage.textContent = 'Votre paiement est en cours de traitement. Vérification des mises à jour...';
        }
        else if (window.paymentStatus === 'WAITING_FOR_CRYPTO_DEPOSIT') {
            if (errorMessage) { // Keep errorMessage logic separate
                errorMessage.textContent = 'En attente de votre dépôt crypto. Veuillez envoyer le montant exact à l\'adresse fournie.';
            }
            // NEW: Display QR code if available from backend
            if (window.cryptoQrCodeBase64 && window.cryptoQrCodeBase64.trim() !== '') {
                const qrContainer = document.getElementById('qrcode-container');
                if (qrContainer) {
                    console.log('JS: Rendering QR code from base64 data.');
                    qrContainer.innerHTML = `<img src="data:image/png;base64,${window.cryptoQrCodeBase64}" alt="QR Code" style="width:200px;height:200px;border-radius:12px;border:2px solid #f1f5f9;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-bottom:16px;" />`;
                }
            }
            else if (window.cryptoAddress && window.cryptoAddress.trim() !== '') { // Fallback to JS generation if no base64 but address exists
                // Only call JS QR code generation if the container is empty (i.e., no base64 QR from backend)
                const qrContainer = document.getElementById('qrcode-container');
                if (qrContainer && !qrContainer.querySelector('img')) {
                    console.log('JS: No base64 QR code found, generating QR code for address:', window.cryptoAddress);
                    // Delay to allow DOM to settle and avoid conflicts
                    setTimeout(function () {
                        if (typeof window.createQrCode === 'function') {
                            // Parse amount as number if available
                            const amount = window.cryptoPayAmount && window.cryptoPayAmount !== '' ? parseFloat(window.cryptoPayAmount) : null;
                            const currency = window.cryptoPayCurrency && window.cryptoPayCurrency !== '' ? window.cryptoPayCurrency : null;
                            
                            console.log('JS: Creating QR code with amount:', amount, 'currency:', currency);
                            window.createQrCode(window.cryptoAddress, amount, currency);
                        }
                        else {
                            console.error('JS: QR Code library (qrcode.js) not loaded properly for fallback.');
                            // Potentially show a fallback message here or rely on the qrcode.js error handling
                        }
                    }, 200);
                }
            }
        }
        else if (window.paymentStatus === 'PARTIALLY_PAID') {
            if (errorMessage) {
                // Enhanced partial payment message with specific amounts
                if (window.paidAmount && window.cryptoPayAmount && window.cryptoPayCurrency) {
                    errorMessage.textContent = `Paiement partiel reçu: ${window.paidAmount} ${window.cryptoPayCurrency}. Restant à envoyer: ${window.cryptoPayAmount} ${window.cryptoPayCurrency}.`;
                } else {
                    errorMessage.textContent = 'Paiement partiel reçu. Veuillez envoyer le montant restant indiqué ci-dessous.';
                }
            }

            // Handle QR code for partial payments (remaining amount)
            if (window.cryptoQrCodeBase64 && window.cryptoQrCodeBase64.trim() !== '') {
                const qrContainer = document.getElementById('qrcode-container');
                if (qrContainer) {
                    console.log('JS: Rendering remaining amount QR code from base64 data for partial payment.');
                    qrContainer.innerHTML = `<img src="data:image/png;base64,${window.cryptoQrCodeBase64}" alt="Remaining Amount QR Code" style="width:200px;height:200px;border-radius:12px;border:2px solid #e5e7eb;box-shadow:0 4px 12px rgba(99,102,241,0.15);margin-bottom:16px;" />`;
                }
            } else if (window.cryptoAddress) {
                // Generate QR code for remaining amount
                const qrContainer = document.getElementById('qrcode-container');
                if (qrContainer && !qrContainer.querySelector('img')) {
                    console.log('JS: Generating QR code for remaining amount:', window.cryptoPayAmount, window.cryptoPayCurrency);
                    setTimeout(function () {
                        if (typeof window.createQrCode === 'function') {
                            const remainingAmount = window.cryptoPayAmount && window.cryptoPayAmount !== '' ? parseFloat(window.cryptoPayAmount) : null;
                            const currency = window.cryptoPayCurrency && window.cryptoPayCurrency !== '' ? window.cryptoPayCurrency : null;
                            
                            console.log('JS: Creating QR code for partial payment remaining amount:', remainingAmount, 'currency:', currency);
                            window.createQrCode(window.cryptoAddress, remainingAmount, currency);
                        }
                    }, 200);
                }
            }
        }
        startPolling(); // Call the new function
    }

});