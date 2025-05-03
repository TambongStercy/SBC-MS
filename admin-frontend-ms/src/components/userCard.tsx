import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { AdminUserData, updateUser } from "../services/adminUserApi"; // <-- Import admin update function

import Dropdown from "../components/common/dropdown";



enum SubscriptionType {
  CLASSIQUE = 'CLASSIQUE',
  CIBLE = 'CIBLE',
  // Add other types if necessary
}

interface UserCardProps {
  // Define the data shape UserCard actually needs, based on AdminUserData
  // but ensuring correct types for display/input components.
  data: {
    // Fields directly from AdminUserData (types might need adjustment)
    _id: string; // Use _id from AdminUserData
    id: string; // Keep id if needed for child components
    name: string;
    email?: string; // Allow optional email
    role: string; // Assuming role is a string
    avatar?: string; // Optional avatar
    momoOperator?: string; // Optional momoOperator
    city?: string; // Optional city
    region?: string; // Optional region
    country?: string; // Optional country
    isVerified?: boolean; // Assuming boolean
    activeSubscriptionTypes?: string[]; // Assuming array of strings
    createdAt?: string; // Original date string

    // Fields that need type conversion or specific handling
    phoneNumber: string; // Ensure this is string for the component
    momoNumber: string;  // Ensure this is string for the component
    registeredAt: string; // Ensure this is string (formatted date)

    // Include other fields from AdminUserData if UserCard actually uses them
    product?: Array<any>; // Assuming product is needed, keep type flexible
  };
  onSubscriptionChange: (userId: string, newType: SubscriptionType | 'NONE') => Promise<void>;
}

const UserCard: React.FC<UserCardProps> = ({ data, onSubscriptionChange }) => {
  const [name, setName] = useState(data.name);
  const [phoneNumber, setPhoneNumber] = useState<string>(String(data.phoneNumber || ''));
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionType | 'NONE'>(() => {
    const types = data.activeSubscriptionTypes || [];
    console.log("UserCard received activeSubscriptionTypes:", types); // Debug log
    if (types.includes(SubscriptionType.CIBLE)) {
      console.log("Setting initial subscription to CIBLE");
      return SubscriptionType.CIBLE;
    }
    if (types.includes(SubscriptionType.CLASSIQUE)) {
      console.log("Setting initial subscription to CLASSIQUE");
      return SubscriptionType.CLASSIQUE;
    }
    console.log("Setting initial subscription to NONE");
    return 'NONE';
  });
  const [momoNumber, setMomoNumber] = useState<string>(String(data.momoNumber || ''));
  const [momoOperator, setMomoOperator] = useState(data.momoOperator);
  const [region, setRegion] = useState(data.region);
  const [country, setCountry] = useState(data.country || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Add country code mapping at the top of the component
  const countryCodeMap: Record<string, CountryCode> = {
    '229': 'BJ', // Benin
    '237': 'CM', // Cameroon
    '226': 'BF', // Burkina Faso
    '243': 'CD', // DRC
    '254': 'KE', // Kenya
    '234': 'NG', // Nigeria
    '221': 'SN', // Senegal
    '242': 'CG', // Congo
    '241': 'GA', // Gabon
    '225': 'CI'  // Côte d'Ivoire
  };

  // Bring back the country operators configuration
  type CountryCode = 'BJ' | 'CM' | 'BF' | 'CD' | 'KE' | 'NG' | 'SN' | 'CG' | 'GA' | 'CI';
  const countryOperators: Record<CountryCode, string[]> = {
    'BJ': ['MTN_MOMO_BEN', 'MOOV_BEN'],
    'CM': ['MTN_MOMO_CMR', 'ORANGE_CMR'],
    'BF': ['MOOV_BFA', 'ORANGE_BFA'],
    'CD': ['VODACOM_MPESA_COD', 'AIRTEL_COD', 'ORANGE_COD'],
    'KE': ['MPESA_KEN'],
    'NG': ['MTN_MOMO_NGA', 'AIRTEL_NGA'],
    'SN': ['FREE_SEN', 'ORANGE_SEN'],
    'CG': ['AIRTEL_COG', 'MTN_MOMO_COG'],
    'GA': ['AIRTEL_GAB'],
    'CI': ['MTN_MOMO_CIV', 'ORANGE_CIV']
  };

  // Add a function to check if a string is a valid CountryCode
  const isValidCountryCode = (code: string): code is CountryCode => {
    return ['BJ', 'CM', 'BF', 'CD', 'KE', 'NG', 'SN', 'CG', 'GA', 'CI'].includes(code);
  };

  // Replace the momoCountry state initialization with this improved version
  const [momoCountry, setMomoCountry] = useState<CountryCode>(() => {
    // First try to detect from momoNumber (now guaranteed string)
    if (momoNumber && momoNumber.length >= 3) {
      const cleanNumber = momoNumber.replace(/^\+/, ''); // Remove leading +
      const prefix = cleanNumber.substring(0, 3);
      const detectedCountry = countryCodeMap[prefix];
      if (detectedCountry) {
        console.log("Initial country detected from momo number:", detectedCountry);
        return detectedCountry;
      }
    }

    // If we have a momoOperator, find which country it belongs to
    if (data.momoOperator) {
      for (const [country, operators] of Object.entries(countryOperators)) {
        if (operators.includes(data.momoOperator)) {
          console.log("Initial country detected from operator:", country);
          return country as CountryCode;
        }
      }
    }

    // If region is a valid country code, use that
    const upperRegion = data.region?.toUpperCase(); // Get uppercase version safely
    if (upperRegion && isValidCountryCode(upperRegion)) { // Check both existence and validity
      console.log("Using region as country:", upperRegion);
      return upperRegion; // Return the validated uppercase string
    }

    // Default fallback
    console.log("Using default country: BJ");
    return 'BJ';
  });

  // Update momoCountry when Momo number changes (but don't affect region)
  useEffect(() => {
    if (momoNumber && momoNumber.length >= 3) {
      const cleanNumber = momoNumber.replace(/^\+/, '');
      const prefix = cleanNumber.substring(0, 3);
      const detectedCountry = countryCodeMap[prefix];

      if (detectedCountry) {
        console.log("Momo country updated:", detectedCountry);
        setMomoCountry(detectedCountry);
      }
    }
  }, [momoNumber]);

  // Define the country list here
  const africanCountries = [
    { code: 'CM', name: 'Cameroon' }, { code: 'BJ', name: 'Benin' },
    { code: 'CG', name: 'Congo - Brazzaville' }, { code: 'CD', name: 'Congo - Kinshasa (DRC)' },
    { code: 'GA', name: 'Gabon' }, { code: 'GH', name: 'Ghana' }, { code: 'CI', name: 'Côte d\'Ivoire' },
    { code: 'SN', name: 'Senegal' }, { code: 'NG', name: 'Nigeria' }, { code: 'BF', name: 'Burkina Faso' },
    { code: 'KE', name: 'Kenya' }, { code: 'DZ', name: 'Algeria' }, { code: 'AO', name: 'Angola' },
    { code: 'BW', name: 'Botswana' }, { code: 'BI', name: 'Burundi' }, { code: 'CV', name: 'Cabo Verde' },
    { code: 'CF', name: 'Central African Republic' }, { code: 'TD', name: 'Chad' }, { code: 'KM', name: 'Comoros' },
    { code: 'DJ', name: 'Djibouti' }, { code: 'EG', name: 'Egypt' }, { code: 'GQ', name: 'Equatorial Guinea' },
    { code: 'ER', name: 'Eritrea' }, { code: 'SZ', name: 'Eswatini' }, { code: 'ET', name: 'Ethiopia' },
    { code: 'GM', name: 'Gambia' }, { code: 'GN', name: 'Guinea' }, { code: 'GW', name: 'Guinea-Bissau' },
    { code: 'LS', name: 'Lesotho' }, { code: 'LR', name: 'Liberia' }, { code: 'LY', name: 'Libya' },
    { code: 'MG', name: 'Madagascar' }, { code: 'MW', name: 'Malawi' }, { code: 'ML', name: 'Mali' },
    { code: 'MR', name: 'Mauritania' }, { code: 'MU', name: 'Mauritius' }, { code: 'MA', name: 'Morocco' },
    { code: 'MZ', name: 'Mozambique' }, { code: 'NA', name: 'Namibia' }, { code: 'NE', name: 'Niger' },
    { code: 'RW', name: 'Rwanda' }, { code: 'ST', name: 'Sao Tome and Principe' }, { code: 'SC', name: 'Seychelles' },
    { code: 'SL', name: 'Sierra Leone' }, { code: 'SO', name: 'Somalia' }, { code: 'ZA', name: 'South Africa' },
    { code: 'SS', name: 'South Sudan' }, { code: 'SD', name: 'Sudan' }, { code: 'TZ', name: 'Tanzania' },
    { code: 'TG', name: 'Togo' }, { code: 'TN', name: 'Tunisia' }, { code: 'UG', name: 'Uganda' },
    { code: 'ZM', name: 'Zambia' }, { code: 'ZW', name: 'Zimbabwe' },
    // Add other non-African countries if needed
    { code: 'FR', name: 'France' }, { code: 'US', name: 'United States' },
    // Add a separator or group non-African countries if the list gets long
  ];

  const handleSubscriptionSelect = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = event.target.value as SubscriptionType | 'NONE';
    const originalType = selectedSubscription; // Store original state for potential revert
    setSelectedSubscription(newType);
    console.log("Selected subscription:", newType);
    setIsSubmitting(true);
    try {
      await onSubscriptionChange(data.id, newType);
    } catch (error) {
      console.error("Failed to update subscription from UserCard", error);
      // Revert local state if the API call fails
      setSelectedSubscription(originalType);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOperatorSelect = (item: string) => {
    setMomoOperator(item);
    console.log("Selected operator:", item);
    // Maybe trigger handleUpdate for momoOperator here?
  };

  // Function to handle the API call for updating simple fields using the ADMIN endpoint
  const handleSimpleFieldUpdate = async (field: keyof AdminUserData, value: string | number | boolean | string[]) => {
    const updateData: Partial<AdminUserData> = {};
    const finalValue = field === 'country' && typeof value === 'string' ? value.toUpperCase() : value;
    (updateData as any)[field] = finalValue;
    setIsSubmitting(true);
    try {
      // Use the correctly imported updateUser function
      await updateUser(data.id, updateData);
      alert(`${field} updated successfully!`);
    } catch (error) {
      console.error(`Failed to update ${field}:`, error);
      alert(`Failed to update ${field}. Please try again.`);
      // Revert local state on error
      if (field === 'name') setName(data.name);
      if (field === 'phoneNumber') setPhoneNumber(String(data.phoneNumber || ''));
      if (field === 'region') setRegion(data.region);
      if (field === 'country') setCountry(data.country || '');
      if (field === 'momoNumber') setMomoNumber(String(data.momoNumber || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Specific handler for momoOperator
  const handleMomoOperatorUpdate = async (selectedOperator: string) => {
    setIsSubmitting(true);
    try {
      // Use the correctly imported updateUser function
      await updateUser(data.id, { momoOperator: selectedOperator });
      setMomoOperator(selectedOperator); // Update local state on success
      alert(`momoOperator updated successfully!`);
    } catch (error) {
      console.error(`Failed to update momoOperator:`, error);
      alert(`Failed to update momoOperator. Please try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4 sm:mb-0">
        Informations personelles
      </h2>
      <div className="flex flex-col sm:flex-col items-center justify-between mb-6">
        <img
          src={data.avatar}
          alt={name}
          className="rounded-full size-20 object-cover"
        />
        <p className="text-gray-100">{name}</p>
        <p className="text-gray-400 opacity-40 font-extralight text-xs">
          Membre depuis le {data.registeredAt}
        </p>

        {/* Name Input */}
        <div className="flex flex-row gap-2 items-center justify-center mb-6">
          <div className="flex-col">
            <h3 className="mb-1">Nom</h3>
            <input
              type="text"
              name="name"
              placeholder="Entrer le nouveau nom..."
              className="bg-gray-700 bg-opacity-20 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-4"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <motion.button
            className="text-white rounded pt-0 flex items-center mt-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            onClick={() => handleSimpleFieldUpdate("name", name)}
            disabled={isSubmitting}
          >
            <Check color="#10b981" />
          </motion.button>
        </div>

        {/* Phone Number Input */}
        <div className="flex flex-row gap-2 items-center justify-center mb-6">
          <div className="flex-col">
            <h3 className="mb-1">Tel</h3>
            <input
              type="text"
              name="phoneNumber"
              placeholder="Entrer le nouveau numero..."
              className="bg-gray-700 bg-opacity-20 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-4"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <motion.button
            className="text-white rounded pt-0 flex items-center mt-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            onClick={() => handleSimpleFieldUpdate("phoneNumber", phoneNumber)}
            disabled={isSubmitting}
          >
            <Check color="#10b981" />
          </motion.button>
        </div>

        {/* Region Input */}
        <div className="flex flex-row gap-2 items-center justify-center mb-6">
          <div className="flex-col">
            <h3 className="mb-1">Region</h3>
            <input
              type="text"
              name="region"
              placeholder="Entrer la région..."
              className="bg-gray-700 bg-opacity-20 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-4"
              value={region}
              onChange={(e) => {
                const upperValue = e.target.value.toUpperCase();
                if (isValidCountryCode(upperValue)) {
                  setRegion(upperValue);
                }
              }}
              disabled={isSubmitting}
            />
          </div>
          <motion.button
            className="text-white rounded pt-0 flex items-center mt-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            onClick={() => {
              if (region !== undefined) { // Ensure region is defined before updating
                handleSimpleFieldUpdate("region", region)
              }
            }}
            disabled={isSubmitting}
          >
            <Check color="#10b981" />
          </motion.button>
        </div>

        {/* Country Dropdown (ISO Alpha-2) */}
        <div className="flex flex-row gap-2 items-center justify-center mb-6">
          <div className="flex-col w-full max-w-xs">
            <h3 className="mb-1 self-start">Country</h3>
            <select
              name="country"
              value={country} // Bind to state
              onChange={(e) => setCountry(e.target.value)} // Update state on change
              disabled={isSubmitting}
              className="bg-gray-700 bg-opacity-20 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
              style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="white" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1.5em' }}
            >
              <option value="" disabled>-- Select Country --</option>
              {africanCountries.map(c => (
                <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
          <motion.button
            className="text-white rounded pt-0 flex items-center mt-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            onClick={() => handleSimpleFieldUpdate("country", country)}
            disabled={isSubmitting || !country} // Disable if no country selected
          >
            <Check color="#10b981" />
          </motion.button>
        </div>

        {/* Subscription Dropdown */}
        <div className="flex flex-col items-center mb-6 w-full max-w-xs">
          <h3 className="mb-1 self-start">Abonnement</h3>
          <select
            name="subscription"
            value={selectedSubscription}
            onChange={handleSubscriptionSelect}
            disabled={isSubmitting}
            className="bg-gray-700 bg-opacity-20 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
            style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="white" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1.5em' }}
          >
            <option value="NONE">Aucun</option>
            <option value={SubscriptionType.CLASSIQUE}>Classique</option>
            <option value={SubscriptionType.CIBLE}>Cible</option>
          </select>
        </div>

        {/* Momo Number Input */}
        <div className="flex flex-row gap-2 items-center justify-center mb-6">
          <div className="flex-col">
            <h3 className="mb-1">Numéro Momo</h3>
            <input
              type="text"
              name="momoNumber"
              placeholder="Entrer le nouveau numéro Momo..."
              className="bg-gray-700 bg-opacity-20 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-4"
              value={momoNumber}
              onChange={(e) => setMomoNumber(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <motion.button
            className="text-white rounded pt-0 flex items-center mt-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            onClick={() => handleSimpleFieldUpdate("momoNumber", momoNumber)}
            disabled={isSubmitting}
          >
            <Check color="#10b981" />
          </motion.button>
        </div>

        {/* Momo Operator Dropdown */}
        <div className="flex flex-row gap-2 items-center justify-center mb-6">
          <div className="flex-col">
            <h3 className="mb-1">Opérateur Momo</h3>
            <Dropdown
              label={momoOperator || "Sélectionner un opérateur"}
              items={countryOperators[momoCountry]}
              onSelect={handleOperatorSelect}
              disabled={isSubmitting}
            />
          </div>
          <motion.button
            className="text-white rounded pt-0 flex items-center mt-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            onClick={() => {
              if (momoOperator) { // Ensure momoOperator is defined before updating
                handleMomoOperatorUpdate(momoOperator)
              }
            }}
            disabled={isSubmitting || !momoOperator}
          >
            <Check color="#10b981" />
          </motion.button>
        </div>
      </div>
    </>
  );
};

export default UserCard;
