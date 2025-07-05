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

    // sessionId, paymentStatus, prefillPhoneNumber, prefillCountryCode, prefillOperator are defined globally by EJS
    // NEW: Pass gateway and gatewayPaymentId from EJS to JS
    var gateway = "<%= gateway %>";
    var gatewayPaymentId = "<%= gatewayPaymentId %>";

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
            'TG', // Togo
            'ML', // Mali
            'NE', // Niger
            'BJ', // Bénin
            'CI', // Côte d'Ivoire
            'CM', // Cameroun
            'SN'  // Sénégal
        ];

        // Countries that use FeexPay
        const feexpayCountries = ['CG', 'GN', 'GA', 'CD', 'KE']; // Remaining countries

        // Only include FeexPay operators for countries that still use FeexPay
        const feexpayOperators = {
            'CG': ['mtn_cg'], // Congo Brazzaville
            'GN': [], // Guinea (operators TBD)
            'GA': [], // Gabon (operators TBD)
            'CD': [], // Democratic Republic of Congo (operators TBD)
            'KE': [], // Kenya (operators TBD)
            // Removed operators for countries that now use CinetPay:
            // 'BJ': ['mtn', 'moov', 'celtiis_bj'], // Benin - now uses CinetPay
            // 'CI': ['mtn_ci', 'moov_ci', 'wave_ci', 'orange_ci'], // Côte d'Ivoire - now uses CinetPay
            // 'SN': ['orange_sn', 'free_sn'], // Senegal - now uses CinetPay
            // 'TG': ['togocom_tg', 'moov_tg'], // Togo - now uses CinetPay
            // 'BF': ['moov_bf', 'orange_bf'], // Burkina Faso - now uses CinetPay
            // TODO: Add operators for GN, GA, CD, KE if they use FeexPay and require operator selection
            // Check FeexPay documentation for exact slugs for these countries.
        };

        const getCurrencyForCountry = (countryCode) => {
            const countryCurrencyMap = {
                'BJ': 'XOF', 'CI': 'XOF', 'SN': 'XOF', 'TG': 'XOF', 'ML': 'XOF',
                'NE': 'XOF', 'BF': 'XOF', 'CG': 'XAF', 'CM': 'XAF', 'GA': 'XAF',
                'CD': 'CDF', 'KE': 'KES', 'GN': 'GNF',
            };
            return countryCurrencyMap[countryCode] || 'XAF';
        };

        const updateFormForCountry = () => {
            if (!countrySelect || !operatorSelect || !phoneInputGroup || !phoneInput || !operatorSelectGroup || !otpInputGroup || !otpInput) return; // Guard if elements are missing

            const selectedCountry = countrySelect.value;
            const countryOperators = feexpayOperators[selectedCountry] || [];
            const selectedOperator = operatorSelect.value; // Get value after potential prefill

            operatorSelect.innerHTML = '<option value="" disabled selected>-- Sélectionnez l\'opérateur de paiement --</option>';
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

                    if (typeof prefillOperator !== 'undefined' && prefillOperator && countryOperators.includes(prefillOperator)) {
                        operatorSelect.value = prefillOperator;
                    }
                    // Removed Orange Senegal OTP logic since SN now uses CinetPay
                    // Show/hide OTP field based on selected country and newly set operator value
                    // if (selectedCountry === 'SN' && operatorSelect.value === 'orange_sn') {
                    //     otpInputGroup.classList.remove('hidden');
                    //     otpInput.required = true;
                    // } else {
                    //     otpInputGroup.classList.add('hidden');
                    //     otpInput.required = false;
                    //     otpInput.value = ''; // Clear OTP if not applicable
                    // }
                } else {
                    // Hide OTP field if no operator selection or not applicable
                    otpInputGroup.classList.add('hidden');
                    otpInput.required = false;
                    otpInput.value = '';
                }
            } else {
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


        // Handle page load based on paymentStatus if the form is meant to be interactive
        if (paymentStatus === 'PENDING_USER_INPUT') {
            console.log('Status is PENDING_USER_INPUT. Initializing form for user input.');
            if (prefillCountryCode && countrySelect) {
                countrySelect.value = prefillCountryCode;
                // updateFormForCountry(); // This will be called after operator prefill to ensure correct state
            }
            if (prefillPhoneNumber && phoneInput) {
                phoneInput.value = prefillPhoneNumber;
            }
            // Operator prefill is handled by updateFormForCountry, now ensure updateFormForCountry is called *after* operator might be prefilled.
            // If prefillOperator is present, updateFormForCountry inside countrySelect change listener might not have run yet with the prefilled operator.
            // So, manually call it again if prefillOperator is set to ensure OTP field logic runs based on the prefilled operator.
            if (prefillOperator && operatorSelect) {
                // The operator select options are populated within updateFormForCountry, so we need to ensure it runs once to populate,
                // then potentially again if prefillOperator is set to correctly show/hide OTP based on the prefilled operator.
                // The initial call to updateFormForCountry() below the event listener handles the initial population.
                // If prefillOperator is set, the operatorSelect.value will be set within updateFormForCountry if the option exists.
                // We need a slight adjustment here: updateFormForCountry already handles operator pre-selection if prefillOperator is set.
                // The key is that updateFormForCountry must run to set the operator value and then decide OTP visibility.
            }
            updateFormForCountry(); // This call will handle prefill of operator and OTP field visibility

            if (submitButton) submitButton.disabled = false; // Ensure button is enabled

        } else if (paymentStatus === 'PENDING_PROVIDER') {
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

            const formData = {
                paymentCurrency: determinedCurrency,
                countryCode: selectedCountry,
                operator: requiresOperator ? selectedOperatorValue : undefined,
                phoneNumber: requiresPhone ? phoneInput.value : undefined,
            };
            // Removed Orange Senegal OTP logic since SN now uses CinetPay
            // if (selectedCountry === 'SN' && selectedOperatorValue === 'orange_sn' && otpInput.value) {
            //     formData.otp = otpInput.value;
            // }
            Object.keys(formData).forEach(key => formData[key] === undefined && delete formData[key]);

            console.log('Soumission des données de paiement:', formData);

            try {
                const response = await fetch(`/api/payments/intents/${sessionId}/submit`, {
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
                } else {
                    // This is likely a request-to-pay flow (e.g., FeexPay USSD)
                    if (requiresPhone) { // Check if it was a flow that involves a phone (most request-to-pay)
                        if (buttonText) buttonText.textContent = 'Confirmer sur le téléphone';
                        errorMessage.textContent = 'Veuillez vérifier votre téléphone pour approuver la demande de paiement.';
                        // Apply yellow styling for this specific message
                        errorMessage.className = 'text-center mt-4 p-3 bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-md text-base min-h-[2.5rem] font-medium';

                        // Update global status and start polling if now PENDING_PROVIDER
                        if (result.data && result.data.status === 'PENDING_PROVIDER') {
                            paymentStatus = 'PENDING_PROVIDER'; // Update global JS status variable
                            console.log('Demande de paiement réussie, nouveau statut PENDING_PROVIDER. Démarrage du sondage.');
                            startPolling();
                        } else if (result.data && result.data.status === 'PROCESSING') {
                            paymentStatus = 'PROCESSING';
                            errorMessage.textContent = 'Votre paiement est en cours de traitement. Vérification des mises à jour...';
                            // Apply yellow styling for this specific message as well (or a slightly different one for processing)
                            errorMessage.className = 'text-center mt-4 p-3 bg-blue-100 text-blue-800 border border-blue-300 rounded-md text-base min-h-[2.5rem] font-medium';
                            console.log('Demande de paiement réussie, nouveau statut PROCESSING. Démarrage du sondage.');
                            startPolling();
                        }
                    } else {
                        // Should not happen if no redirect and not a phone-based payment
                        throw new Error('Paiement initié, mais aucune URL de redirection reçue et non un paiement par téléphone.');
                    }
                }
            } catch (error) {
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
        if (submitButton && paymentStatus === 'PENDING_USER_INPUT') { // Only allow click submission if form is active
            submitButton.addEventListener('click', function (e) {
                e.preventDefault(); // Prevent default form submission via button click
                handleSubmission(e);
            });
        }
    } else {
        // Logic for when the payment form is NOT rendered by EJS (e.g. status is SUCCEEDED, FAILED, etc.)
        // This block can be used to initialize any JS behavior for those non-form pages if needed.
        // For PENDING_PROVIDER, EJS now includes the button, so JS needs to set its state.
        if (paymentStatus === 'PENDING_PROVIDER') {
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
        console.log(`Page de paiement chargée avec le statut : ${paymentStatus}. Le formulaire n'est pas actif ou entièrement rendu.`);
    }

    // --- NEW: J'ai payé button logic ---
    const checkFeexpayStatusButton = document.getElementById('check-feexpay-status-button');
    const checkFeexpayButtonText = document.getElementById('check-feexpay-button-text');
    const checkFeexpayLoadingSpinner = document.getElementById('check-feexpay-loading-spinner');
    const checkFeexpayStatusMessage = document.getElementById('check-feexpay-status-message');

    if (checkFeexpayStatusButton) {
        checkFeexpayStatusButton.addEventListener('click', async () => {
            if (!sessionId) {
                console.error('ID de session non disponible pour la vérification du statut FeexPay.');
                if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = 'Erreur : ID de session manquant.';
                return;
            }

            if (checkFeexpayButtonText) checkFeexpayButtonText.textContent = 'Vérification du statut...';
            if (checkFeexpayLoadingSpinner) checkFeexpayLoadingSpinner.classList.remove('hidden');
            checkFeexpayStatusButton.disabled = true;
            if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = ''; // Clear previous messages

            try {
                console.log(`Vérification manuelle du statut FeexPay pour la session : ${sessionId}`);
                const response = await fetch(`/api/payments/intents/${sessionId}/feexpay-status`);
                const result = await response.json();

                if (response.ok && result.success) {
                    console.log('Vérification du statut FeexPay réussie :', result.data);
                    if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = 'Statut vérifié avec succès. Mise à jour...';
                    // Reload the page to reflect the new status
                    window.location.reload();
                } else {
                    console.error('Échec de la vérification du statut FeexPay :', result.message);
                    if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = result.message || 'Échec de la vérification du statut. Veuillez réessayer.';
                }
            } catch (error) {
                console.error('Erreur lors de la vérification du statut FeexPay :', error);
                if (checkFeexpayStatusMessage) checkFeexpayStatusMessage.textContent = 'Une erreur est survenue. Veuillez réessayer.';
            } finally {
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
        if (!sessionId) {
            console.error('ID de session non disponible, impossible de démarrer le sondage.');
            return;
        }
        // Clear any existing interval to avoid multiple pollers
        if (pollingIntervalId) clearInterval(pollingIntervalId);

        console.log(`Démarrage du sondage du statut pour la session : ${sessionId}`);
        pollCount = 0; // Reset poll count
        pollingIntervalId = setInterval(checkPaymentStatus, pollInterval);
        // Optionally, call it once immediately
        // checkPaymentStatus();
    };

    const checkPaymentStatus = async () => {
        if (!sessionId) {
            console.error('ID de session non disponible pour le sondage.');
            if (pollingIntervalId) clearInterval(pollingIntervalId);
            return;
        }

        pollCount++;
        console.log(`Sondage du statut de paiement (Tentative ${pollCount}/${maxPolls}) : ${sessionId}`);

        try {
            const response = await fetch(`/api/payments/intents/${sessionId}/status`);
            if (!response.ok) {
                console.error('Erreur lors de la récupération du statut de paiement :', response.statusText);
                // Optionally stop polling on network errors or specific HTTP error codes
                if (pollCount >= maxPolls) {
                    console.log('Nombre maximal de tentatives de sondage atteint. Arrêt du sondage.');
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    // Update UI to inform user polling has stopped, if desired
                    if (errorMessage && (paymentStatus === 'PENDING_PROVIDER' || paymentStatus === 'PROCESSING')) {
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

                if (newStatus === 'SUCCEEDED' || newStatus === 'FAILED' || newStatus === 'CANCELED') {
                    console.log(`Le statut de paiement est final : ${newStatus}. Rechargement de la page.`);
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    window.location.reload();
                } else if (newStatus === 'PENDING_PROVIDER' || newStatus === 'PROCESSING') {
                    // Continue polling
                    if (paymentStatus !== newStatus && errorMessage) { // If status changed but still pending, update message
                        paymentStatus = newStatus; // Update local JS variable for consistency
                        if (newStatus === 'PROCESSING') {
                            errorMessage.textContent = 'Le paiement est maintenant en cours de traitement avec le fournisseur...';
                        } else {
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
                } else {
                    // Unexpected status or PENDING_USER_INPUT (should not happen if polling started correctly)
                    console.log(`Statut inattendu du sondage : ${newStatus}. Arrêt du sondage.`);
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                }
            } else {
                console.error('Échec de la récupération du statut de paiement depuis le sondage :', result.message);
            }
        } catch (error) {
            console.error('Erreur lors du sondage du statut de paiement :', error);
            if (pollCount >= maxPolls) {
                console.log('Nombre maximal de tentatives de sondage atteint en raison d\'une erreur. Arrêt du sondage.');
                if (pollingIntervalId) clearInterval(pollingIntervalId);
            }
        }
    };

    if (paymentStatus === 'PENDING_PROVIDER' || paymentStatus === 'PROCESSING') {
        console.log(`Le statut initial est ${paymentStatus}. Démarrage du sondage du statut pour la session : ${sessionId}`);
        // Initial message update for PROCESSING if not already set by PENDING_PROVIDER logic
        if (paymentStatus === 'PROCESSING' && errorMessage) {
            errorMessage.textContent = 'Votre paiement est en cours de traitement. Vérification des mises à jour...';
        }
        // if (pollingIntervalId) clearInterval(pollingIntervalId); // Clear any existing interval - MOVED TO startPolling()
        // pollingIntervalId = setInterval(checkPaymentStatus, pollInterval); // MOVED TO startPolling()
        startPolling(); // Call the new function
    }

});