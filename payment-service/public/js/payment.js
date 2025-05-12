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

    const formPresent = !!form; // Check if the form element itself exists on the page

    // Only run full form setup if the form is actually rendered by EJS
    if (formPresent) {
        if (!countrySelect || !phoneInputGroup || !phoneInput || !submitButton || !operatorSelectGroup || !operatorSelect || !otpInputGroup || !otpInput) {
            console.error('Essential form elements not found, though payment form is present!');
            // No return here if some elements are missing but form is there, page might be partially usable or in a specific state.
        }

        // Define countries for each gateway based on the new rule
        // CinetPay is ONLY for CM. All others are FeexPay.
        const cinetpayCountries = ['CM'];
        const feexpayCountries = ['BJ', 'CI', 'SN', 'CG', 'TG', 'BF', 'GN', 'ML', 'NE', 'GA', 'CD', 'KE']; // All other supported countries

    const feexpayOperators = {
        'BJ': ['mtn', 'moov', 'celtiis_bj'], // Benin
            'CI': ['mtn_ci', 'moov_ci', 'wave_ci', 'orange_ci'], // Côte d'Ivoire
        'SN': ['orange_sn', 'free_sn'], // Senegal
            'CG': ['mtn_cg'], // Congo Brazzaville
            'TG': ['togocom_tg', 'moov_tg'], // Togo (Assumed slugs)
            'BF': ['moov_bf', 'orange_bf'], // Burkina Faso (Assumed s lugs)
            // TODO: Add operators for GN, ML, NE, GA, CD, KE if they use FeexPay and require operator selection
            // Check FeexPay documentation for exact slugs for these & confirm assumed ones.
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

        operatorSelect.innerHTML = '<option value="" disabled selected>-- Select Payment Operator --</option>';
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
                    // Show/hide OTP field based on selected country and newly set operator value
                    if (selectedCountry === 'SN' && operatorSelect.value === 'orange_sn') {
                        otpInputGroup.classList.remove('hidden');
                        otpInput.required = true;
                    } else {
                        otpInputGroup.classList.add('hidden');
                        otpInput.required = false;
                        otpInput.value = ''; // Clear OTP if not applicable
                    }
                } else {
                    otpInputGroup.classList.add('hidden'); // Ensure OTP is hidden if no operator selection or not Orange SN
                    otpInput.required = false;
                    otpInput.value = '';
                }
        } else {
            phoneInputGroup.classList.add('hidden');
            phoneInput.required = false;
            phoneInput.value = '';
                otpInputGroup.classList.add('hidden'); // Ensure OTP is hidden if FeexPay not applicable
                otpInput.required = false;
                otpInput.value = '';
            }
        };

        if (countrySelect) { // Ensure countrySelect exists before adding listener or calling update
            countrySelect.addEventListener('change', () => {
                updateFormForCountry(); // Call on country change
                // Additional logic to specifically update OTP field visibility based on operator for the new country
                // This is because operator selection might not trigger a change event itself if it's auto-selected or has only one option.
                const currentSelectedOperator = operatorSelect.value;
                if (countrySelect.value === 'SN' && currentSelectedOperator === 'orange_sn') {
                    otpInputGroup.classList.remove('hidden');
                    otpInput.required = true;
                } else {
                    otpInputGroup.classList.add('hidden');
                    otpInput.required = false;
                    otpInput.value = '';
                }
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
                buttonText.textContent = 'Confirm on Phone';
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
        console.log('Payment submission handler triggered');

        errorMessage.textContent = '';
            if (buttonText) buttonText.textContent = 'Processing...';
            if (buttonSpinner) buttonSpinner.classList.remove('hidden');
            if (submitButton) submitButton.disabled = true;
        if (retryContainer) retryContainer.classList.add('hidden');

        const selectedCountry = countrySelect.value;
        const requiresPhone = feexpayCountries.includes(selectedCountry);
        const requiresOperator = !operatorSelectGroup.classList.contains('hidden');
        const determinedCurrency = getCurrencyForCountry(selectedCountry);
            const selectedOperatorValue = operatorSelect.value; // Get current operator value

        if (!selectedCountry) {
            errorMessage.textContent = 'Please select your country.';
                if (buttonSpinner) buttonSpinner.classList.add('hidden');
                if (buttonText) buttonText.textContent = 'Proceed to Payment';
                if (submitButton) submitButton.disabled = false;
            return;
        }
            if (requiresOperator && !selectedOperatorValue) {
            errorMessage.textContent = 'Please select a payment operator.';
                if (buttonSpinner) buttonSpinner.classList.add('hidden');
                if (buttonText) buttonText.textContent = 'Proceed to Payment';
                if (submitButton) submitButton.disabled = false;
                return;
            }
            if (selectedCountry === 'SN' && selectedOperatorValue === 'orange_sn' && !otpInput.value) {
                errorMessage.textContent = 'Please enter the OTP for Orange Senegal.';
                if (buttonSpinner) buttonSpinner.classList.add('hidden');
                if (buttonText) buttonText.textContent = 'Proceed to Payment';
                if (submitButton) submitButton.disabled = false;
            return;
        }
        if (requiresPhone && !phoneInput.value) {
            errorMessage.textContent = 'Please enter your phone number for payment.';
                if (buttonSpinner) buttonSpinner.classList.add('hidden');
                if (buttonText) buttonText.textContent = 'Proceed to Payment';
                if (submitButton) submitButton.disabled = false;
            return;
        }

        console.log(`Determined currency for ${selectedCountry}: ${determinedCurrency}`);

        const formData = {
            paymentCurrency: determinedCurrency,
            countryCode: selectedCountry,
                operator: requiresOperator ? selectedOperatorValue : undefined,
                phoneNumber: requiresPhone ? phoneInput.value : undefined,
        };
            if (selectedCountry === 'SN' && selectedOperatorValue === 'orange_sn' && otpInput.value) {
                formData.otp = otpInput.value;
            }
        Object.keys(formData).forEach(key => formData[key] === undefined && delete formData[key]);

        console.log('Submitting payment data:', formData);

        try {
            const response = await fetch(`/api/payments/intents/${sessionId}/submit`, {
                method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify(formData),
            });
            const result = await response.json();
            console.log('Payment submission response:', result);

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to initiate payment. Please check details and try again.');
            }

            if (result.data && result.data.gatewayCheckoutUrl) {
                console.log('Redirecting to payment gateway:', result.data.gatewayCheckoutUrl);
                window.location.href = result.data.gatewayCheckoutUrl;
                    if (buttonText) buttonText.textContent = 'Redirecting...';
                } else {
                    // This is likely a request-to-pay flow (e.g., FeexPay USSD)
                    if (requiresPhone) { // Check if it was a flow that involves a phone (most request-to-pay)
                        if (buttonText) buttonText.textContent = 'Confirm on Phone';
                        errorMessage.textContent = 'Please check your phone to approve the payment request.';
                        // Apply yellow styling for this specific message
                        errorMessage.className = 'text-center mt-4 p-3 bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-md text-base min-h-[2.5rem] font-medium';

                        // Update global status and start polling if now PENDING_PROVIDER
                        if (result.data && result.data.status === 'PENDING_PROVIDER') {
                            paymentStatus = 'PENDING_PROVIDER'; // Update global JS status variable
                            console.log('Request-to-pay successful, new status PENDING_PROVIDER. Starting polling.');
                            startPolling();
                        } else if (result.data && result.data.status === 'PROCESSING') {
                            paymentStatus = 'PROCESSING';
                            errorMessage.textContent = 'Your payment is currently processing. Checking for updates...';
                            // Apply yellow styling for this specific message as well (or a slightly different one for processing)
                            errorMessage.className = 'text-center mt-4 p-3 bg-blue-100 text-blue-800 border border-blue-300 rounded-md text-base min-h-[2.5rem] font-medium';
                            console.log('Request-to-pay successful, new status PROCESSING. Starting polling.');
                            startPolling();
                        }
                    } else {
                        // Should not happen if no redirect and not a phone-based payment
                        throw new Error('Payment initiated, but no redirect URL received and not a phone payment.');
                    }
                }
            } catch (error) {
                console.error('Payment submission error:', error);
                errorMessage.textContent = error.message || 'An unexpected error occurred. Please try again.';
                // Reset to default red error styling if an actual error occurs during submission
                errorMessage.className = 'text-red-600 text-sm text-center mt-3 min-h-[1.25rem]';
                if (buttonText) buttonText.textContent = 'Proceed to Payment';
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
            console.log('Status is PENDING_PROVIDER (no form). Setting button state if button exists.');
            // The submitButton, buttonText, buttonSpinner are already potentially grabbed at the top.
            // EJS for PENDING_PROVIDER should be rendering these button elements.
            if (submitButton && buttonText && buttonSpinner) {
                    buttonText.textContent = 'Confirm on Phone';
                buttonSpinner.classList.remove('hidden');
                submitButton.disabled = true;
            }
            if (errorMessage) { // The div with id 'error-message' is also rendered in this EJS state.
                    errorMessage.textContent = 'Please check your phone to approve the payment request.';
            }
        }
        console.log(`Payment page loaded with status: ${paymentStatus}. Form is not active or fully rendered.`);
    }

    // --- Status Polling Logic ---
    let pollingIntervalId = null;
    let pollCount = 0;
    const maxPolls = 24; // Poll for 2 minutes (24 polls * 5 seconds = 120 seconds)
    const pollInterval = 5000; // 5 seconds

    const startPolling = () => {
        if (!sessionId) {
            console.error('Session ID not available, cannot start polling.');
            return;
        }
        // Clear any existing interval to avoid multiple pollers
        if (pollingIntervalId) clearInterval(pollingIntervalId);

        console.log(`Starting status polling for sessionId: ${sessionId}`);
        pollCount = 0; // Reset poll count
        pollingIntervalId = setInterval(checkPaymentStatus, pollInterval);
        // Optionally, call it once immediately
        // checkPaymentStatus(); 
    };

    const checkPaymentStatus = async () => {
        if (!sessionId) {
            console.error('Session ID not available for polling.');
            if (pollingIntervalId) clearInterval(pollingIntervalId);
            return;
        }

        pollCount++;
        console.log(`Polling for payment status (Attempt ${pollCount}/${maxPolls}): ${sessionId}`);

        try {
            const response = await fetch(`/api/payments/intents/${sessionId}/status`);
            if (!response.ok) {
                console.error('Error fetching payment status:', response.statusText);
                // Optionally stop polling on network errors or specific HTTP error codes
                if (pollCount >= maxPolls) {
                    console.log('Max poll attempts reached. Stopping polling.');
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    // Update UI to inform user polling has stopped, if desired
                    if (errorMessage && (paymentStatus === 'PENDING_PROVIDER' || paymentStatus === 'PROCESSING')) {
                        errorMessage.textContent = 'Status check timed out. Please refresh the page to see the latest status.';
                    }
                }
                return;
            }

            const result = await response.json();
            if (result.success && result.data) {
                const newStatus = result.data;
                console.log('Polled status:', newStatus);

                // Update global paymentStatus if it's different, for other UI elements that might depend on it
                // Note: This client-side update of `paymentStatus` is for immediate UI reaction. Page reload is the source of truth.
                // window.paymentStatus = newStatus; // Or however you want to manage this global if needed elsewhere

                if (newStatus === 'SUCCEEDED' || newStatus === 'FAILED' || newStatus === 'CANCELED') {
                    console.log(`Payment status is final: ${newStatus}. Reloading page.`);
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    window.location.reload();
                } else if (newStatus === 'PENDING_PROVIDER' || newStatus === 'PROCESSING') {
                    // Continue polling
                    if (paymentStatus !== newStatus && errorMessage) { // If status changed but still pending, update message
                        paymentStatus = newStatus; // Update local JS variable for consistency
                        if (newStatus === 'PROCESSING') {
                            errorMessage.textContent = 'Payment is now processing with the provider...';
                        } else {
                            errorMessage.textContent = 'Still waiting for confirmation on your phone...';
                        }
                    }
                    if (pollCount >= maxPolls) {
                        console.log('Max poll attempts reached. Stopping polling.');
                        if (pollingIntervalId) clearInterval(pollingIntervalId);
                        if (errorMessage) {
                            errorMessage.textContent = 'Still waiting for payment confirmation. You can refresh the page to check or continue waiting.';
                        }
                    }
                } else {
                    // Unexpected status or PENDING_USER_INPUT (should not happen if polling started correctly)
                    console.log(`Unexpected status from poll: ${newStatus}. Stopping polling.`);
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                }
            } else {
                console.error('Failed to get payment status from poll:', result.message);
            }
        } catch (error) {
            console.error('Error during payment status poll:', error);
            if (pollCount >= maxPolls) {
                console.log('Max poll attempts reached due to error. Stopping polling.');
                if (pollingIntervalId) clearInterval(pollingIntervalId);
            }
        }
    };

    if (paymentStatus === 'PENDING_PROVIDER' || paymentStatus === 'PROCESSING') {
        console.log(`Initial status is ${paymentStatus}. Starting status polling for sessionId: ${sessionId}`);
        // Initial message update for PROCESSING if not already set by PENDING_PROVIDER logic
        if (paymentStatus === 'PROCESSING' && errorMessage) {
            errorMessage.textContent = 'Your payment is currently processing. Checking for updates...';
        }
        // if (pollingIntervalId) clearInterval(pollingIntervalId); // Clear any existing interval - MOVED TO startPolling()
        // pollingIntervalId = setInterval(checkPaymentStatus, pollInterval); // MOVED TO startPolling()
        startPolling(); // Call the new function
    }

});