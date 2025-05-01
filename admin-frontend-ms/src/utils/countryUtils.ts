// Mapping from ISO 2-letter country codes to French names
const countryCodeToNameMap: { [key: string]: string } = {
    DZ: "Algérie",
    AO: "Angola",
    BJ: "Bénin",
    BW: "Botswana",
    BF: "Burkina Faso",
    BI: "Burundi",
    CV: "Cap-Vert",
    CM: "Cameroun",
    CF: "République Centrafricaine",
    TD: "Tchad",
    KM: "Comores",
    CD: "RD Congo",
    CG: "Congo-Brazzaville",
    CI: "Côte d'Ivoire",
    DJ: "Djibouti",
    EG: "Égypte",
    GQ: "Guinée Équatoriale",
    ER: "Érythrée",
    SZ: "Eswatini",
    ET: "Éthiopie",
    GA: "Gabon",
    GM: "Gambie",
    GH: "Ghana",
    GN: "Guinée",
    GW: "Guinée-Bissau",
    KE: "Kenya",
    LS: "Lesotho",
    LR: "Libéria",
    LY: "Libye",
    MG: "Madagascar",
    MW: "Malawi",
    ML: "Mali",
    MR: "Mauritanie",
    MU: "Maurice",
    MA: "Maroc",
    MZ: "Mozambique",
    NA: "Namibie",
    NE: "Niger",
    NG: "Nigéria",
    RW: "Rwanda",
    ST: "Sao Tomé-et-Principe",
    SN: "Sénégal",
    SC: "Seychelles",
    SL: "Sierra Leone",
    SO: "Somalie",
    ZA: "Afrique du Sud",
    SS: "Soudan du Sud",
    SD: "Soudan",
    TZ: "Tanzanie",
    TG: "Togo",
    TN: "Tunisie",
    UG: "Ouganda",
    ZM: "Zambie",
    ZW: "Zimbabwe",
    Autres: "Autres Pays", // Handle the 'Autres' key
};

/**
 * Gets the full country name from an ISO 2-letter code.
 * @param code The ISO 2-letter country code (e.g., 'CM') or 'Autres'.
 * @returns The full country name in French or the code itself if not found.
 */
export const getCountryName = (code: string): string => {
    return countryCodeToNameMap[code] || code; // Return the code if no mapping exists
}; 