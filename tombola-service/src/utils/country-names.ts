/**
 * Free-text country fields (Impact Challenge entrepreneurs) hold an ISO-2 code
 * from the admin form, but older or hand-made records may hold a French or
 * English name. `countryFieldMatch(code)` matches both, any case.
 *
 * The names are copied from user-service `src/utils/phone.utils.ts`
 * (`countryNameVariations`); keep them in step if that list grows.
 */
const countryNameVariations: { [key: string]: string } = {
    // North Africa
    'algeria': 'DZ', 'algérie': 'DZ', 'algerian': 'DZ', 'algérien': 'DZ',
    'democratic and popular republic of algeria': 'DZ',
    
    'egypt': 'EG', 'égypte': 'EG', 'egyptian': 'EG', 'égyptien': 'EG',
    'arab republic of egypt': 'EG', 'united arab republic': 'EG',
    
    'libya': 'LY', 'libye': 'LY', 'libyan': 'LY', 'libyen': 'LY',
    'state of libya': 'LY', 'great socialist people\'s libyan arab jamahiriya': 'LY',
    
    'morocco': 'MA', 'maroc': 'MA', 'moroccan': 'MA', 'marocain': 'MA',
    'kingdom of morocco': 'MA', 'royaume du maroc': 'MA',
    
    'sudan': 'SD', 'soudan': 'SD', 'sudanese': 'SD', 'soudanais': 'SD',
    'republic of sudan': 'SD', 'république du soudan': 'SD',
    
    'tunisia': 'TN', 'tunisie': 'TN', 'tunisian': 'TN', 'tunisien': 'TN',
    'republic of tunisia': 'TN', 'république tunisienne': 'TN',
    
    'south sudan': 'SS', 'soudan du sud': 'SS', 'south sudanese': 'SS',
    'republic of south sudan': 'SS',

    // West Africa
    'benin': 'BJ', 'bénin': 'BJ', 'béninoise': 'BJ', 'beninoise': 'BJ',
    'republic of benin': 'BJ', 'république du bénin': 'BJ',
    
    'burkina faso': 'BF', 'burkina': 'BF', 'burkina-faso': 'BF', 'burkinabe': 'BF',
    'burkinafaso': 'BF', 'burkina_faso': 'BF', 'upper volta': 'BF',
    
    'cape verde': 'CV', 'cap-vert': 'CV', 'cabo verde': 'CV', 'cape verdean': 'CV',
    'republic of cape verde': 'CV',
    
    'cote divoire': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI', 'ivory coast': 'CI',
    'cote-d\'ivoire': 'CI', 'cote-divoire': 'CI', 'cotedivoire': 'CI', 'ivorian': 'CI',
    'republic of côte d\'ivoire': 'CI',
    
    'gambia': 'GM', 'gambie': 'GM', 'gambian': 'GM', 'gambien': 'GM',
    'republic of the gambia': 'GM',
    
    'ghana': 'GH', 'ghanaian': 'GH', 'gold coast': 'GH',
    'republic of ghana': 'GH',
    
    'guinea': 'GN', 'guinée': 'GN', 'guinea conakry': 'GN', 'guinée-conakry': 'GN',
    'republic of guinea': 'GN', 'republique de guinee': 'GN',
    
    'guinea bissau': 'GW', 'guinea-bissau': 'GW', 'guiné-bissau': 'GW',
    'republic of guinea-bissau': 'GW',
    
    'liberia': 'LR', 'libéria': 'LR', 'liberian': 'LR', 'libérien': 'LR',
    'republic of liberia': 'LR',
    
    'mali': 'ML', 'malian': 'ML', 'republic of mali': 'ML', 'republique du mali': 'ML',
    
    'mauritania': 'MR', 'mauritanie': 'MR', 'mauritanian': 'MR', 'mauritanien': 'MR',
    'islamic republic of mauritania': 'MR',
    
    'niger': 'NE', 'nigerien': 'NE', 'republic of niger': 'NE', 'republique du niger': 'NE',
    
    'nigeria': 'NG', 'nigéria': 'NG', 'nigerian': 'NG', 'nigérian': 'NG',
    'federal republic of nigeria': 'NG',
    
    'senegal': 'SN', 'sénégal': 'SN', 'senegalese': 'SN', 'sénégalais': 'SN',
    'republic of senegal': 'SN',
    
    'sierra leone': 'SL', 'sierra léone': 'SL', 'sierra leonean': 'SL',
    'republic of sierra leone': 'SL',
    
    'togo': 'TG', 'togolese': 'TG', 'togolais': 'TG', 'republic of togo': 'TG',
    'republique togolaise': 'TG',

    // Central Africa
    'angola': 'AO', 'angolan': 'AO', 'angolais': 'AO',
    'republic of angola': 'AO',
    
    'cameroon': 'CM', 'cameroun': 'CM', 'camerun': 'CM', 'kamerun': 'CM',
    'republic of cameroon': 'CM',
    
    'central african republic': 'CF', 'republique centrafricaine': 'CF',
    'central african empire': 'CF', 'car': 'CF',
    
    'chad': 'TD', 'tchad': 'TD', 'chadian': 'TD', 'tchadien': 'TD',
    'republic of chad': 'TD',
    
    'republic of congo': 'CG', 'congo brazzaville': 'CG', 'congo': 'CG', 'congo-brazzaville': 'CG',
    'republique du congo': 'CG', 'congo republic': 'CG',
    
    'democratic republic of congo': 'CD', 'dr congo': 'CD', 'drc': 'CD', 'congo kinshasa': 'CD',
    'zaire': 'CD', 'congo-kinshasa': 'CD', 'rdc': 'CD', 'republique democratique du congo': 'CD',
    
    'equatorial guinea': 'GQ', 'guinée équatoriale': 'GQ', 'guinea ecuatorial': 'GQ',
    'republic of equatorial guinea': 'GQ',
    
    'gabon': 'GA', 'gabonese': 'GA', 'gabonais': 'GA', 'republic of gabon': 'GA',
    'republique gabonaise': 'GA',
    
    'sao tome and principe': 'ST', 'são tomé and príncipe': 'ST', 'sao tome': 'ST',
    'democratic republic of são tomé and príncipe': 'ST',

    // East Africa
    'burundi': 'BI', 'burundian': 'BI', 'burundais': 'BI',
    'republic of burundi': 'BI',
    
    'comoros': 'KM', 'comores': 'KM', 'comorian': 'KM', 'comorien': 'KM',
    'union of the comoros': 'KM',
    
    'djibouti': 'DJ', 'djiboutian': 'DJ', 'djiboutien': 'DJ',
    'republic of djibouti': 'DJ',
    
    'eritrea': 'ER', 'érythrée': 'ER', 'eritrean': 'ER', 'érythréen': 'ER',
    'state of eritrea': 'ER',
    
    'ethiopia': 'ET', 'éthiopie': 'ET', 'ethiopian': 'ET', 'éthiopien': 'ET',
    'federal democratic republic of ethiopia': 'ET',
    
    'kenya': 'KE', 'kenyan': 'KE', 'republic of kenya': 'KE',
    
    'madagascar': 'MG', 'malagasy': 'MG', 'malgache': 'MG',
    'republic of madagascar': 'MG',
    
    'malawi': 'MW', 'malawian': 'MW', 'malawien': 'MW',
    'republic of malawi': 'MW',
    
    'mauritius': 'MU', 'maurice': 'MU', 'mauritian': 'MU', 'mauricien': 'MU',
    'republic of mauritius': 'MU',
    
    'mozambique': 'MZ', 'mozambican': 'MZ', 'mozambicain': 'MZ',
    'republic of mozambique': 'MZ',
    
    'rwanda': 'RW', 'rwandan': 'RW', 'rwandais': 'RW',
    'republic of rwanda': 'RW',
    
    'seychelles': 'SC', 'seychellois': 'SC',
    'republic of seychelles': 'SC',
    
    'somalia': 'SO', 'somalie': 'SO', 'somali': 'SO', 'somalien': 'SO',
    'federal republic of somalia': 'SO',
    
    'tanzania': 'TZ', 'tanzanie': 'TZ', 'tanzanian': 'TZ', 'tanzanien': 'TZ',
    'united republic of tanzania': 'TZ',
    
    'uganda': 'UG', 'ouganda': 'UG', 'ugandan': 'UG', 'ougandais': 'UG',
    'republic of uganda': 'UG',

    // Southern Africa
    'botswana': 'BW', 'batswana': 'BW', 'republic of botswana': 'BW',
    
    'eswatini': 'SZ', 'swaziland': 'SZ', 'swazi': 'SZ',
    'kingdom of eswatini': 'SZ', 'kingdom of swaziland': 'SZ',
    
    'lesotho': 'LS', 'basotho': 'LS', 'kingdom of lesotho': 'LS',
    
    'namibia': 'NA', 'namibie': 'NA', 'namibian': 'NA', 'namibien': 'NA',
    'republic of namibia': 'NA',
    
    'south africa': 'ZA', 'afrique du sud': 'ZA', 'south african': 'ZA',
    'republic of south africa': 'ZA',
    
    'zambia': 'ZM', 'zambie': 'ZM', 'zambian': 'ZM', 'zambien': 'ZM',
    'republic of zambia': 'ZM',
    
    'zimbabwe': 'ZW', 'zimbabwean': 'ZW', 'zimbabwéen': 'ZW',
    'republic of zimbabwe': 'ZW', 'rhodesia': 'ZW',
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every spelling stored for `code` (ISO-2): the code itself and its known names, lower case. */
export function countrySpellings(code: string): string[] {
    const upper = code.toUpperCase();
    const names = Object.entries(countryNameVariations)
        .filter(([, c]) => c === upper)
        .map(([name]) => name);
    return [upper.toLowerCase(), ...names];
}

/**
 * Mongo condition for a free-text country field equal (any case, surrounding
 * spaces ignored) to `code` or one of its names. A case-insensitive anchored
 * regex: only used on small collections (entrepreneurs, ~10 per challenge).
 */
export function countryFieldMatch(code: string): { $regex: RegExp } {
    const alternatives = countrySpellings(code).map(escapeRegex).join('|');
    return { $regex: new RegExp(`^\\s*(?:${alternatives})\\s*$`, 'i') };
}

/** Same test in memory. */
export function countryFieldIs(value: string | null | undefined, code: string): boolean {
    if (!value) return false;
    return countrySpellings(code).includes(value.trim().toLowerCase());
}
