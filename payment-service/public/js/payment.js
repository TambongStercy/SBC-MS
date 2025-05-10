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

    // sessionId is defined globally in the EJS template

    if (!form || !countrySelect || !phoneInputGroup || !phoneInput || !submitButton || !operatorSelectGroup || !operatorSelect) {
        console.error('Essential form elements not found!');
        return;
    }

    // Define countries for each gateway
    const feexpayCountries = ['BJ', 'CI', 'SN', 'CG', 'TG']; // Removed CM
    const cinetpayCountries = ['CM', 'BF', 'GN', 'ML', 'NE'];

    // Define Feexpay operators per country (key: country code, value: array of operator slugs used in API endpoints)
    const feexpayOperators = {
        'BJ': ['mtn', 'moov', 'celtiis_bj'], // Benin
        'CI': ['moov_ci', 'mtn_ci', 'orange_ci', 'wave_ci'], // Côte d'Ivoire
        'SN': ['orange_sn', 'free_sn'], // Senegal
        'CG': ['mtn_cg'], // Congo
        'TG': ['togocom_tg', 'moov_tg'], // Togo
        // 'CM': ['mtn_cm', 'orange_cm'] // Removed CM as it's handled by CinetPay
    };

    // Function to map country code to payment currency
    const getCurrencyForCountry = (countryCode) => {
        const countryCurrencyMap = {
            'BJ': 'XOF', // Benin
            'CI': 'XOF', // Côte d'Ivoire
            'SN': 'XOF', // Senegal
            'TG': 'XOF', // Togo
            'ML': 'XOF', // Mali
            'NE': 'XOF', // Niger
            'BF': 'XOF', // Burkina Faso
            'CG': 'XAF', // Congo Brazzaville
            'CM': 'XAF', // Cameroon
            'GA': 'XAF', // Gabon
            'CD': 'CDF', // DRC - Ensure backend/gateway support CDF
            'KE': 'KES', // Kenya
            'GN': 'GNF', // Guinea - Ensure backend/gateway support GNF
            // Add other mappings as needed
        };
        return countryCurrencyMap[countryCode] || 'XAF'; // Default to XAF if mapping not found
    };

    // Function to update UI based on country selection
    const updateFormForCountry = () => {
        const selectedCountry = countrySelect.value;
        const countryOperators = feexpayOperators[selectedCountry] || [];

        // Reset operator dropdown
        operatorSelect.innerHTML = '<option value="" disabled selected>-- Select Payment Operator --</option>';
        operatorSelect.required = false;
        operatorSelectGroup.classList.add('hidden');

        // If it's a Feexpay country, phone is needed
        if (feexpayCountries.includes(selectedCountry)) {
            phoneInputGroup.classList.remove('hidden');
            phoneInput.required = true;

            // If multiple operators defined, show and populate the operator select
            if (countryOperators.length > 1) {
                countryOperators.forEach(op => {
                    const option = document.createElement('option');
                    option.value = op;
                    // Simple formatting for display (replace underscores, capitalize)
                    option.textContent = op.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    operatorSelect.appendChild(option);
                });
                operatorSelectGroup.classList.remove('hidden');
                operatorSelect.required = true;
            } // If only one operator or none mapped, we don't show the select (backend will use default/logic)

            // Otherwise (CinetPay countries), phone and operator are not needed on this form
        } else {
            phoneInputGroup.classList.add('hidden');
            phoneInput.required = false;
            phoneInput.value = '';
            // Operator select remains hidden
        }
    };

    // Add event listener for country changes
    countrySelect.addEventListener('change', updateFormForCountry);

    // Initial check in case a country is pre-selected
    updateFormForCountry();

    // Function to handle submission
    const handleSubmission = async (e) => {
        if (e) e.preventDefault();
        console.log('Payment submission handler triggered');

        errorMessage.textContent = '';
        buttonText.textContent = 'Processing...';
        buttonSpinner.classList.remove('hidden');
        submitButton.disabled = true;
        if (retryContainer) retryContainer.classList.add('hidden');

        const selectedCountry = countrySelect.value;
        const requiresPhone = feexpayCountries.includes(selectedCountry);
        // Check if operator selection is currently visible and thus required
        const requiresOperator = !operatorSelectGroup.classList.contains('hidden');
        const determinedCurrency = getCurrencyForCountry(selectedCountry);

        // Basic validation before sending
        if (!selectedCountry) {
            errorMessage.textContent = 'Please select your country.';
            // Re-enable button etc.
            buttonSpinner.classList.add('hidden');
            buttonText.textContent = 'Proceed to Payment';
            submitButton.disabled = false;
            return;
        }
        // Validate operator if required
        if (requiresOperator && !operatorSelect.value) {
            errorMessage.textContent = 'Please select a payment operator.';
            // Re-enable button etc.
            buttonSpinner.classList.add('hidden');
            buttonText.textContent = 'Proceed to Payment';
            submitButton.disabled = false;
            return;
        }
        // Only validate phone if it's required for the selected country
        if (requiresPhone && !phoneInput.value) {
            errorMessage.textContent = 'Please enter your phone number for payment.';
            // Re-enable button etc.
            buttonSpinner.classList.add('hidden');
            buttonText.textContent = 'Proceed to Payment';
            submitButton.disabled = false;
            return;
        }

        console.log(`Determined currency for ${selectedCountry}: ${determinedCurrency}`);

        // Get form data conditionally
        const formData = {
            paymentCurrency: determinedCurrency,
            countryCode: selectedCountry,
            operator: requiresOperator ? operatorSelect.value : undefined, // Include operator if selected
            phoneNumber: requiresPhone ? phoneInput.value : undefined, // Include phone if required
        };

        // Remove undefined fields before sending
        Object.keys(formData).forEach(key => formData[key] === undefined && delete formData[key]);

        console.log('Submitting payment data:', formData);

        try {
            const response = await fetch(`/api/payments/intents/${sessionId}/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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
                buttonText.textContent = 'Redirecting...';
            } else {
                // Handle cases where Feexpay request-to-pay doesn't have a URL but expects user phone confirmation
                // Or if CinetPay redirect URL was missing (which would be an error)
                if (requiresPhone) { // Likely Feexpay success (no redirect needed)
                    buttonText.textContent = 'Confirm on Phone';
                    // Display instructions to user to check their phone
                    errorMessage.textContent = 'Please check your phone to approve the payment request.';
                    // Optionally disable button permanently or change UI state
                } else { // Likely an error if CinetPay had no redirect URL
                    throw new Error('Payment initiated, but no redirect URL received.');
                }
            }
        } catch (error) {
            console.error('Payment submission error:', error);
            errorMessage.textContent = error.message || 'An unexpected error occurred. Please try again.';
            buttonText.textContent = 'Proceed to Payment';
            buttonSpinner.classList.add('hidden');
            submitButton.disabled = false;

            if (retryContainer) {
                retryContainer.classList.remove('hidden');
            }
        }

        return false;
    };

    form.addEventListener('submit', handleSubmission);

    submitButton.addEventListener('click', function (e) {
        e.preventDefault();
        handleSubmission(e);
    });
});