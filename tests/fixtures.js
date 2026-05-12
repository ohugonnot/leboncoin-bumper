// Realistic ad fixtures captured from leboncoin's /finder/search API.
// PII (phone numbers, full descriptions) is trimmed; titles are public anyway.

export const adWordpressMetz = {
  list_id: 3196483489,
  subject: 'Cherche un technicien web, CRM WordPress',
  body: 'Bonjour, je recherche un technicien web pour intervenir sur mon CRM WordPress. PHP et plugins requis.',
  first_publication_date: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString().replace('T', ' ').slice(0, 19), // 6h ago
  category_id: 34, category_name: 'Autres services',
  ad_type: 'demand',
  url: 'https://www.leboncoin.fr/ad/autres_services/3196483489',
  location: { city: 'Metz', zipcode: '57000' }
};

export const adProgrammeurN8N = {
  list_id: 3193981434,
  subject: 'Programmeur N8N',
  body: 'Recherche personne maitrisant n8n pour automatiser quelques workflows.',
  first_publication_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString().replace('T', ' ').slice(0, 19),
  category_id: 36, category_name: 'Cours particuliers',
  ad_type: 'demand',
  url: 'https://www.leboncoin.fr/ad/cours_particuliers/3193981434',
  location: { city: 'Croix', zipcode: '59170' }
};

export const adCleaner = {
  list_id: 9000000001,
  subject: 'Recherche femme de ménage 4h par semaine',
  body: 'Bonjour, cherche femme de ménage pour intervenir 4h par semaine.',
  first_publication_date: new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19),
  category_id: 99, category_name: 'Services à la personne',
  ad_type: 'demand',
  url: 'https://www.leboncoin.fr/ad/services_a_la_personne/9000000001',
  location: { city: 'Lyon', zipcode: '69002' }
};

export const adOldDeveloper = {
  list_id: 9000000002,
  subject: 'Rechercher développeur',
  body: 'Je recherche un développeur freelance pour un projet web.',
  first_publication_date: new Date(Date.now() - 86400000 * 60).toISOString().replace('T', ' ').slice(0, 19), // 60d ago — too old
  category_id: 34, category_name: 'Autres services',
  ad_type: 'demand',
  url: 'https://www.leboncoin.fr/ad/autres_services/9000000002',
  location: { city: 'Amboise', zipcode: '37400' }
};

export const adShortTitle = {
  list_id: 9000000003,
  subject: 'Aide',  // < 8 chars
  body: 'Demande aide pour mon site web wordpress.',
  first_publication_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
  category_id: 34, category_name: 'Autres services',
  ad_type: 'demand',
  url: 'https://www.leboncoin.fr/ad/autres_services/9000000003',
  location: { city: 'Paris', zipcode: '75001' }
};

export const adVagueButTechBody = {
  list_id: 9000000004,
  subject: 'Demande aide projet professionnel',
  body: 'Je dois finir un site web avec PHP Symfony et un peu de Vue.js pour mon entreprise. Quelqu\'un de dispo ?',
  first_publication_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
  category_id: 34, category_name: 'Autres services',
  ad_type: 'demand',
  url: 'https://www.leboncoin.fr/ad/autres_services/9000000004',
  location: { city: 'Bordeaux', zipcode: '33000' }
};

export const ALL_ADS = [
  adWordpressMetz, adProgrammeurN8N, adCleaner,
  adOldDeveloper, adShortTitle, adVagueButTechBody
];

/**
 * Build a deterministic fetch mock that responds with the provided ads
 * for any /finder/search call. The keyword in the request body is ignored —
 * test setups can stub more granularly by inspecting the body themselves.
 */
export function mockFetch(adsByKeyword) {
  return async (url, init) => {
    if (!url.includes('/finder/search')) throw new Error('unexpected url ' + url);
    const body = JSON.parse(init.body);
    const kw = body?.filters?.keywords?.text;
    const ads = (adsByKeyword?.[kw] ?? adsByKeyword?.['*'] ?? []);
    return {
      ok: true, status: 200,
      json: async () => ({ ads, total: ads.length, max_pages: 1 })
    };
  };
}
