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
    const retryContainer = document.getElementById('retry-container');

    // sessionId, paymentStatus, prefillPhoneNumber, prefillCountryCode, prefillOperator are defined globally by EJS

    const formPresent = !!form; // Check if the form element itself exists on the page

    // Only run full form setup if the form is actually rendered by EJS
    if (formPresent) {
        // Simplified check: Only countrySelect and submitButton are essential for the FeexLink flow
        if (!countrySelect || !submitButton) {
            console.error('Essential form elements (country select, submit button) not found!');
            // Decide if you want to return or allow partial functionality
        }

        // Define countries for each gateway based on the new rule
        // CinetPay is ONLY for CM. All others are FeexPay.
        const cinetpayCountries = ['CM'];
        const feexpayCountries = ['BJ', 'CI', 'SN', 'CG', 'TG', 'BF', 'GN', 'ML', 'NE', 'GA', 'CD', 'KE']; // All other supported countries

        const getCurrencyForCountry = (countryCode) => {
            const countryCurrencyMap = {
                'BJ': 'XOF', 'CI': 'XOF', 'SN': 'XOF', 'TG': 'XOF', 'ML': 'XOF',
                'NE': 'XOF', 'BF': 'XOF', 'CG': 'XAF', 'CM': 'XAF', 'GA': 'XAF',
                'CD': 'CDF', 'KE': 'KES', 'GN': 'GNF',
            };
            return countryCurrencyMap[countryCode] || 'XAF'; // Default or throw error?
        };

        const updateFormForCountry = () => {
            // Only needs to act on countrySelect now
            if (!countrySelect) return; // Guard if countrySelect is missing

            // No longer need to show/hide phone, operator, otp
            const selectedCountry = countrySelect.value;
            console.log(`Country selected: ${selectedCountry}. Form requires no additional fields.`);
            // Form remains the same regardless of FeexPay country now.
        };

        if (countrySelect) { // Ensure countrySelect exists before adding listener or calling update
            countrySelect.addEventListener('change', updateFormForCountry);
            updateFormForCountry(); // Initial call to set up form based on pre-selected country
        }

        // Handle page load based on paymentStatus if the form is meant to be interactive
        if (paymentStatus === 'PENDING_USER_INPUT') {
            console.log('Status is PENDING_USER_INPUT. Initializing form for user input.');
            if (prefillCountryCode && countrySelect) {
                countrySelect.value = prefillCountryCode;
                updateFormForCountry(); // Reflect any changes needed based on country
            }
            // Remove prefill logic for phone/operator

            if (submitButton) submitButton.disabled = false; // Ensure button is enabled

        } else if (paymentStatus === 'PENDING_PROVIDER') {
            // The EJS for PENDING_PROVIDER includes the button structure.
            console.log('Status is PENDING_PROVIDER. Setting up UI (button state). Button should redirect if clicked.');

            if (submitButton && buttonText && buttonSpinner) {
                // The button action is now effectively a "Retry Redirect" or refresh
                buttonText.textContent = 'Go to Payment Page';
                buttonSpinner.classList.add('hidden'); // Spinner not needed, it's a redirect
                submitButton.disabled = false; // Allow clicking to re-attempt navigation
                submitButton.addEventListener('click', () => {
                    // Attempt to redirect again if the paymentIntent object has the URL
                    // This requires fetching the paymentIntent state again or storing the URL
                    // Simpler: just reload the page, the controller might redirect
                    console.log('Retry redirect button clicked. Reloading page...');
                    window.location.reload();
                });
            }
            if (errorMessage) {
                // Message is updated in EJS, but confirm it's suitable:
                errorMessage.textContent = 'If you are not redirected, please click the button above or refresh.';
            }
            startPolling(); // Start polling in case user is on this page waiting
        }

        const handleSubmission = async (e) => {
            if (e) e.preventDefault();
            // Simplified guard: only need form, countrySelect, submitButton, errorMessage
            if (!form || !countrySelect || !submitButton || !errorMessage) return;
            console.log('Payment submission handler triggered (FeexLink flow)');

            errorMessage.textContent = '';
            if (buttonText) buttonText.textContent = 'Generating Link...'; // Updated text
            if (buttonSpinner) buttonSpinner.classList.remove('hidden');
            if (submitButton) submitButton.disabled = true;
            if (retryContainer) retryContainer.classList.add('hidden');

            const selectedCountry = countrySelect.value;
            const determinedCurrency = getCurrencyForCountry(selectedCountry);

            if (!selectedCountry) {
                errorMessage.textContent = 'Please select your country.';
                if (buttonSpinner) buttonSpinner.classList.add('hidden');
                if (buttonText) buttonText.textContent = 'Proceed to Payment'; // Reset text
                if (submitButton) submitButton.disabled = false;
                return;
            }

            // Remove checks for phone/operator/otp

            console.log(`Determined currency for ${selectedCountry}: ${determinedCurrency}`);

            // Simplified formData for FeexLink flow
            const formData = {
                paymentCurrency: determinedCurrency,
                countryCode: selectedCountry,
            };

            console.log('Submitting payment data (FeexLink):', formData);

            try {
                const response = await fetch(`/api/payments/intents/${sessionId}/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify(formData),
                });
                const result = await response.json();
                console.log('Payment submission response (FeexLink): ', result);

                if (!response.ok || !result.success) {
                    throw new Error(result.message || 'Failed to generate payment link. Please check details and try again.');
                }

                // Check if we received the FeexLink URL
                if (result.data && result.data.gatewayCheckoutUrl) {
                    console.log('Redirecting to FeexLink payment page:', result.data.gatewayCheckoutUrl);
                    if (buttonText) buttonText.textContent = 'Redirecting...';
                    window.location.href = result.data.gatewayCheckoutUrl;
                    // No need to start polling here as user leaves the page.
                    // Polling will start if user returns and status is PENDING_PROVIDER/PROCESSING.
                } else {
                    // This case should not happen if the backend successfully generated the link
                    log.error('FeexLink URL missing in successful response from /submit endpoint.');
                    throw new Error('Payment link generation succeeded but URL was not provided.');
                }
            } catch (error) {
                console.error('Payment submission error (FeexLink): ', error);
                errorMessage.textContent = error.message || 'An unexpected error occurred. Please try again.';
                errorMessage.className = 'text-red-600 text-sm text-center mt-3 min-h-[1.25rem]';
                if (buttonText) buttonText.textContent = 'Proceed to Payment'; // Reset text
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
        // Updated logic for PENDING_PROVIDER page (without form)
        if (paymentStatus === 'PENDING_PROVIDER') {
            console.log('Status is PENDING_PROVIDER (no form). Setting button state.');
            if (submitButton && buttonText && buttonSpinner) {
                // Button should allow user to manually trigger reload/redirect check
                buttonText.textContent = 'Check Payment Status / Refresh'; // Or similar
                buttonSpinner.classList.add('hidden');
                submitButton.disabled = false;
                // Add listener to reload the page on click
                submitButton.addEventListener('click', () => {
                    console.log('PENDING_PROVIDER page refresh button clicked.');
                    window.location.reload();
                });
            }
            if (errorMessage) { // EJS should render this div
                errorMessage.textContent = 'Waiting for payment confirmation. Refresh the page to check the status.'; // Update message
                errorMessage.className = 'text-center mt-4 p-3 bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-md text-base min-h-[2.5rem] font-medium';
            }
            startPolling(); // Start polling for status updates
        }
        console.log(`Payment page loaded with status: ${paymentStatus}. Form is not active or fully rendered.`);
    }

    // --- Status Polling Logic (Remains largely the same) ---
    let pollingIntervalId = null;
    let pollCount = 0;
    const maxPolls = 24; // Poll for 2 minutes (24 polls * 5 seconds = 120 seconds)
    const pollInterval = 5000; // 5 seconds

    const startPolling = () => {
        if (!sessionId) {
            console.error('Session ID not available, cannot start polling.');
            return;
        }
        if (pollingIntervalId) clearInterval(pollingIntervalId);

        console.log(`Starting status polling for sessionId: ${sessionId}`);
        pollCount = 0;
        pollingIntervalId = setInterval(checkPaymentStatus, pollInterval);
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
                if (pollCount >= maxPolls) {
                    console.log('Max poll attempts reached. Stopping polling.');
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
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

                if (newStatus === 'SUCCEEDED' || newStatus === 'FAILED' || newStatus === 'CANCELED') {
                    console.log(`Payment status is final: ${newStatus}. Reloading page.`);
                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                    window.location.reload(); // Reload to show final status page
                } else if (newStatus === 'PENDING_PROVIDER' || newStatus === 'PROCESSING') {
                    // Continue polling
                    if (paymentStatus !== newStatus && errorMessage) {
                        paymentStatus = newStatus; // Update local JS variable for message consistency
                        if (newStatus === 'PROCESSING') {
                            errorMessage.textContent = 'Payment is now processing... Refresh page to check status.';
                        } else { // Still PENDING_PROVIDER
                            errorMessage.textContent = 'Waiting for payment confirmation. Refresh the page to check status.';
                        }
                    }
                    if (pollCount >= maxPolls) {
                        console.log('Max poll attempts reached. Stopping polling.');
                        if (pollingIntervalId) clearInterval(pollingIntervalId);
                        if (errorMessage) {
                            errorMessage.textContent = 'Still waiting for payment confirmation. Please refresh the page to check the status.';
                        }
                    }
                } else {
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

    // Start polling if the initial status requires it
    if (paymentStatus === 'PENDING_PROVIDER' || paymentStatus === 'PROCESSING') {
        console.log(`Initial status is ${paymentStatus}. Starting status polling for sessionId: ${sessionId}`);
        startPolling();
    }

});