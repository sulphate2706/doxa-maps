/**
 * iso3-name.js — the ISO3 -> English country name table the map sheets are LABELLED from.
 *
 * It lived in the UPG-100 profile's data (territory-counts.js). The print standard needs it wherever a
 * sheet is drawn — the Node generator, the browser generator for any map, and the packet's relabeller,
 * which inverts this exact table to recognise each drawn name — so it is library data now, with a named
 * second consumer (Country Posters). territory-counts.js re-exports it, so its importers are unchanged.
 * Short common names, as a poster prints them.
 */
export const ISO3_NAME = {
  ABW: 'Aruba', IND: 'India', AFG: 'Afghanistan', AGO: 'Angola', ALB: 'Albania',
  AND: 'Andorra', ARE: 'United Arab Emirates', ARM: 'Armenia',
  ASM: 'American Samoa', ATG: 'Antigua and Barbuda', AZE: 'Azerbaijan',
  BEN: 'Benin', BFA: 'Burkina Faso', BGD: 'Bangladesh', BGR: 'Bulgaria',
  BHR: 'Bahrain', BHS: 'Bahamas', BIH: 'Bosnia and Herzegovina',
  BLM: 'Saint Barthélemy', BLR: 'Belarus', BMU: 'Bermuda', BOL: 'Bolivia',
  BRA: 'Brazil', BRB: 'Barbados', BRN: 'Brunei', BTN: 'Bhutan',
  CAF: 'Central African Republic', CHN: 'China', CIV: "Côte d'Ivoire",
  CMR: 'Cameroon', COD: 'DR Congo', COG: 'Congo', COK: 'Cook Islands',
  COL: 'Colombia', COM: 'Comoros', CUB: 'Cuba', CUW: 'Curaçao',
  CYM: 'Cayman Islands', CYP: 'Cyprus', CZE: 'Czechia', DJI: 'Djibouti',
  DMA: 'Dominica', DZA: 'Algeria', ECU: 'Ecuador', EGY: 'Egypt',
  ERI: 'Eritrea', ESP: 'Spain', ETH: 'Ethiopia', FIN: 'Finland', FJI: 'Fiji',
  FRO: 'Faroe Islands', FSM: 'Micronesia', GAB: 'Gabon', GEO: 'Georgia',
  GGY: 'Guernsey', GHA: 'Ghana', GIN: 'Guinea', GLP: 'Guadeloupe',
  GMB: 'Gambia', GNB: 'Guinea-Bissau', GNQ: 'Equatorial Guinea', GRC: 'Greece',
  GRD: 'Grenada', GUF: 'French Guiana', GUM: 'Guam', GUY: 'Guyana',
  IDN: 'Indonesia', IRN: 'Iran', IRQ: 'Iraq', ISL: 'Iceland', ISR: 'Israel',
  JAM: 'Jamaica', JOR: 'Jordan', JPN: 'Japan', KAZ: 'Kazakhstan', KEN: 'Kenya',
  KGZ: 'Kyrgyzstan', KHM: 'Cambodia', KIR: 'Kiribati', KWT: 'Kuwait',
  LAO: 'Laos', LBN: 'Lebanon', LBR: 'Liberia', LBY: 'Libya', LCA: 'Saint Lucia',
  LIE: 'Liechtenstein', LKA: 'Sri Lanka', LUX: 'Luxembourg', MAR: 'Morocco',
  MDV: 'Maldives', MHL: 'Marshall Islands', MLI: 'Mali', MLT: 'Malta',
  MMR: 'Myanmar', MNE: 'Montenegro', MNG: 'Mongolia',
  MNP: 'Northern Mariana Islands', MOZ: 'Mozambique', MRT: 'Mauritania',
  MSR: 'Montserrat', MUS: 'Mauritius', MWI: 'Malawi', MYS: 'Malaysia',
  MYT: 'Mayotte', NAM: 'Namibia', NCL: 'New Caledonia', NER: 'Niger',
  NGA: 'Nigeria', NIU: 'Niue', NPL: 'Nepal', NZL: 'New Zealand', OMN: 'Oman',
  PAK: 'Pakistan', PAN: 'Panama', PER: 'Peru', PHL: 'Philippines',
  PLW: 'Palau', PNG: 'Papua New Guinea', PRK: 'North Korea', PRY: 'Paraguay',
  PSE: 'Palestine', PYF: 'French Polynesia', QAT: 'Qatar', RUS: 'Russia',
  SAU: 'Saudi Arabia', SDN: 'Sudan', SEN: 'Senegal', SHN: 'Saint Helena',
  SLB: 'Solomon Islands', SLE: 'Sierra Leone', SMR: 'San Marino',
  SOM: 'Somalia', SSD: 'South Sudan', STP: 'São Tomé and Príncipe',
  SUR: 'Suriname', SWE: 'Sweden', SWZ: 'Eswatini', SYR: 'Syria',
  TCA: 'Turks and Caicos Islands', TCD: 'Chad', TGO: 'Togo', THA: 'Thailand',
  TJK: 'Tajikistan', TON: 'Tonga', TUN: 'Tunisia', TUR: 'Turkey',
  TZA: 'Tanzania', UGA: 'Uganda', USA: 'United States', UZB: 'Uzbekistan',
  VCT: 'Saint Vincent and the Grenadines', VEN: 'Venezuela',
  VGB: 'British Virgin Islands', VIR: 'U.S. Virgin Islands', VNM: 'Vietnam',
  VUT: 'Vanuatu', WLF: 'Wallis and Futuna', WSM: 'Samoa', YEM: 'Yemen',
  ZAF: 'South Africa', ZMB: 'Zambia', ZWE: 'Zimbabwe',
  // Territories with their own people groups (each has a country poster): without a name here the facts row's
  // COUNTRIES cell printed the raw code. KOS is the source data's code for Kosovo (not ISO 3166; XKX is its
  // user-assigned code).
  CCK: 'Cocos (Keeling) Islands', CXR: 'Christmas Island', ESH: 'Western Sahara', GIB: 'Gibraltar',
  HKG: 'Hong Kong', JEY: 'Jersey', KOS: 'Kosovo', MAC: 'Macao', MCO: 'Monaco', NFK: 'Norfolk Island',
  SJM: 'Svalbard and Jan Mayen', SXM: 'Sint Maarten', TKL: 'Tokelau',
};
