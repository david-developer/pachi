import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicitly invoked local review tooling. This module is never imported by
// Expo app code and never reads credentials, cookies, accounts or a database.
const mobileDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const photographDirectory = resolve(mobileDirectory, '../web/tests/fixtures');
export const privateAddressCanary = 'TEST_ONLY_PRIVATE_EXACT_ADDRESS';
export const firstListingId = '00000000-0000-4000-8000-000000000151';
const emptyTerms = { deposit_amount_minor: null, advance_months: null, minimum_lease_months: null, utilities_included: null, service_charge_amount_minor: null, weekly_amount_minor: null, minimum_nights: null, guest_limit: null, check_in_time: null, check_out_time: null, cleaning_fee_minor: null };
const snapshot = [
  { id: firstListingId, purpose: 'RENT', title: 'TEST · Bright apartment in Akwa', amount: 200000, city: 'Douala', neighborhood: 'Akwa', region: 'Littoral', bedrooms: 2, bathrooms: 2, size: '95', type: 'APARTMENT', furnishing: 'PARTLY_FURNISHED', photo: 0, terms: { deposit_amount_minor: 200000, advance_months: 3, minimum_lease_months: 12, utilities_included: false, service_charge_amount_minor: 10000 } },
  { id: '00000000-0000-4000-8000-000000000161', purpose: 'SHORT_LET', title: 'TEST · Furnished short stay in Molyko', amount: 35000, city: 'Buea', neighborhood: 'Molyko', region: 'Southwest', bedrooms: 1, bathrooms: 1, size: '60', type: 'APARTMENT', furnishing: 'FURNISHED', photo: 1, terms: { weekly_amount_minor: 210000, minimum_nights: 2, guest_limit: 2, check_in_time: '14:00', check_out_time: '11:00', cleaning_fee_minor: 5000 } },
  { id: '00000000-0000-4000-8000-000000000171', purpose: 'SALE', title: 'TEST · Family home for sale', amount: 65000000, city: 'Douala', neighborhood: 'Bonapriso', region: 'Littoral', bedrooms: 4, bathrooms: 3, size: '210', type: 'HOUSE', furnishing: 'UNFURNISHED', photo: null },
  { id: '00000000-0000-4000-8000-000000000181', purpose: 'RENT', title: 'TEST · Calm apartment in Buea', amount: 125000, city: 'Buea', neighborhood: 'Bokwango', region: 'Southwest', bedrooms: 2, bathrooms: 1, size: '80', type: 'APARTMENT', furnishing: 'UNFURNISHED', photo: 2, terms: { deposit_amount_minor: 125000, advance_months: 6, minimum_lease_months: 12, utilities_included: false } },
  { id: '00000000-0000-4000-8000-000000000191', purpose: 'RENT', title: 'TEST · Spacious home in Douala', amount: 350000, city: 'Douala', neighborhood: 'Bonamoussadi', region: 'Littoral', bedrooms: 3, bathrooms: 2, size: '150', type: 'HOUSE', furnishing: 'PARTLY_FURNISHED', photo: 0, terms: { deposit_amount_minor: 350000, advance_months: 3, minimum_lease_months: 12, utilities_included: true } },
  { id: '00000000-0000-4000-8000-000000000201', purpose: 'SHORT_LET', title: 'TEST · Quiet guest apartment', amount: 45000, city: 'Limbe', neighborhood: 'Mile 2', region: 'Southwest', bedrooms: 2, bathrooms: 2, size: '90', type: 'APARTMENT', furnishing: 'FURNISHED', photo: 1, terms: { minimum_nights: 1, guest_limit: 4, check_in_time: '15:00', check_out_time: '10:00', cleaning_fee_minor: 8000 } },
];
export const testListings = snapshot.map((item, index) => ({
  id: item.id, purpose: item.purpose, title: item.title,
  description: 'Synthetic TEST inventory for isolated native browser review. This is not a real property or published marketplace inventory.\nA light-filled living area, comfortable bedrooms and a separate kitchen.',
  price: { amount_minor: item.amount, currency: 'XAF', pricing_period: item.purpose === 'RENT' ? 'MONTHLY' : item.purpose === 'SALE' ? 'TOTAL' : 'NIGHTLY', negotiable: item.purpose === 'SALE' },
  terms: { ...emptyTerms, ...item.terms },
  property: { property_type: item.type, bedrooms: item.bedrooms, bathrooms: item.bathrooms, size_sqm: item.size, furnishing: item.furnishing },
  location: { region: item.region, city: item.city, neighborhood: item.neighborhood },
  market_status: 'AVAILABLE', available_from: '2026-10-20', expires_at: '2026-11-20T00:00:00Z',
  media: item.photo === null ? [] : [0, 1, 2].map(offset => ({ id: `00000000-0000-4000-8000-${String(152 + index * 10 + offset).padStart(12, '0')}`, is_cover: offset === 0, widths: [320, 640, 1280] })),
}));
const photographs = ['synthetic-apartment.jpg', 'synthetic-bedroom.jpg', 'synthetic-kitchen.jpg'];
const mediaFiles = new Map(testListings.flatMap((listing, index) => listing.media.map((media, offset) => [media.id, photographs[(snapshot[index].photo + offset) % photographs.length]])));
const scenarios = new Set(['normal', 'empty', 'fail-once', 'page-fail-once', 'unavailable', 'slow-douala', 'broken-images', 'missing-photos', 'detail-fail-once', 'reviews-unavailable']);

export function searchFixture(parameters, items = testListings) {
  let matches = items.filter(item => ['purpose', 'property_type', 'furnishing', 'region'].every(key => {
    const value = parameters.get(key);
    return !value || (key === 'region' ? item.location.region : key === 'purpose' ? item.purpose : item.property[key]) === value;
  }));
  for (const key of ['city', 'neighborhood']) {
    const value = parameters.get(key)?.trim().toLocaleLowerCase();
    if (value) matches = matches.filter(item => item.location[key]?.toLocaleLowerCase().includes(value));
  }
  for (const [key, compare] of [['min_price', (item, value) => item.price.amount_minor >= value], ['max_price', (item, value) => item.price.amount_minor <= value], ['min_bedrooms', (item, value) => (item.property.bedrooms ?? -1) >= value], ['min_bathrooms', (item, value) => (item.property.bathrooms ?? -1) >= value]]) {
    if (parameters.has(key)) matches = matches.filter(item => compare(item, Number(parameters.get(key))));
  }
  if (parameters.has('available_from')) matches = matches.filter(item => item.available_from && item.available_from <= parameters.get('available_from'));
  const sort = parameters.get('sort');
  if (sort === 'price_asc') matches = [...matches].sort((a, b) => a.price.amount_minor - b.price.amount_minor);
  if (sort === 'price_desc') matches = [...matches].sort((a, b) => b.price.amount_minor - a.price.amount_minor);
  // The deliberately small fixture page exercises pagination on a short screen.
  const offset = Number(parameters.get('cursor')?.replace(/^test-offset-/, '') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const limit = Math.min(Math.max(Number(parameters.get('limit') ?? 2) || 2, 1), 2);
  const page = matches.slice(offset, offset + limit);
  const more = offset + page.length < matches.length;
  return { items: page, filters: Object.fromEntries(parameters), next_cursor: more ? `test-offset-${offset + page.length}` : null, has_more: more };
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export async function startPreview({ port = 8085, fixturePort = 8086, directory = resolve(mobileDirectory, 'dist-test'), scenario = 'normal' } = {}) {
  const root = await realpath(directory);
  await stat(resolve(root, 'index.html'));
  let currentScenario;
  let failures = 0;
  const requests = [];
  const setScenario = value => {
    if (!scenarios.has(value)) throw new Error(`Unknown synthetic fixture scenario: ${value}`);
    currentScenario = value;
    failures = 0;
  };
  setScenario(scenario);
  const reply = (request, response, status, body = '', type = 'application/json') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Pachi-Inventory': 'synthetic-test-only', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' });
    response.end(request.method === 'HEAD' ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const handler = apiOnly => async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '')) return reply(request, response, 405, { code: 'SYNTHETIC_READ_ONLY' });
      if (request.method === 'OPTIONS') return reply(request, response, 204);
      requests.push({ path: url.pathname, query: url.search, method: request.method });
      if (url.pathname === '/__test/status') return reply(request, response, 200, { inventory: 'SYNTHETIC TEST ONLY', read_only: true, scenario: currentScenario });
      const publicPath = url.pathname.replace(/^\/v1/, '');
      if (publicPath === '/public/listings') {
        if (currentScenario === 'unavailable' || currentScenario === 'fail-once' && failures++ === 0 || currentScenario === 'page-fail-once' && url.searchParams.has('cursor') && failures++ === 0) return reply(request, response, 503, { code: 'SYNTHETIC_INTERNAL_ERROR_DO_NOT_RENDER' });
        if (currentScenario === 'slow-douala' && url.searchParams.get('city') === 'Douala') await new Promise(resolveDelay => setTimeout(resolveDelay, 1800));
        const items = currentScenario === 'empty' ? [] : currentScenario === 'missing-photos' ? testListings.map(item => ({ ...item, media: [] })) : testListings;
        const result = searchFixture(url.searchParams, items);
        return reply(request, response, result ? 200 : 400, result ?? { code: 'INVALID_TEST_CURSOR' });
      }
      const match = publicPath.match(/^\/public\/listings\/([^/]+)(.*)$/);
      if (match) {
        const listing = testListings.find(item => item.id === match[1]);
        if (!listing || currentScenario === 'empty') return reply(request, response, 404, { code: 'LISTING_UNAVAILABLE' });
        if (match[2] === '/reviews') return reply(request, response, currentScenario === 'reviews-unavailable' ? 503 : 200, currentScenario === 'reviews-unavailable' ? { code: 'SYNTHETIC_INTERNAL_ERROR_DO_NOT_RENDER' } : { items: [], next_cursor: null, reputation: { count: 0, average: null } });
        if (match[2] === '') {
          if (currentScenario === 'detail-fail-once' && failures++ === 0) return reply(request, response, 503, { code: 'SYNTHETIC_INTERNAL_ERROR_DO_NOT_RENDER' });
          return reply(request, response, 200, { ...listing, ...(currentScenario === 'missing-photos' ? { media: [] } : {}), location: { ...listing.location, private_address: privateAddressCanary } });
        }
        const media = match[2].match(/^\/media\/([^/]+)\/variants\/(320|640|1280|1920)$/);
        const photograph = media && listing.media.some(item => item.id === media[1]) && mediaFiles.get(media[1]);
        if (photograph && currentScenario !== 'broken-images') return reply(request, response, 200, await readFile(resolve(photographDirectory, photograph)), 'image/jpeg');
        return reply(request, response, 404, { code: 'MEDIA_UNAVAILABLE' });
      }
      // There is no session, account, contact or mutation adapter in this server.
      if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/') || apiOnly) return reply(request, response, 404, { code: 'SYNTHETIC_PUBLIC_ROUTES_ONLY' });
      let requested;
      try { requested = resolve(root, `.${decodeURIComponent(url.pathname)}`); } catch { return reply(request, response, 400); }
      if (requested !== root && !requested.startsWith(`${root}${sep}`)) return reply(request, response, 403);
      let selected;
      for (const candidate of [requested, `${requested}.html`, resolve(requested, 'index.html')]) {
        try {
          const actual = await realpath(candidate);
          if (!actual.startsWith(`${root}${sep}`)) continue;
          if ((await stat(actual)).isFile()) { selected = actual; break; }
        } catch { /* Expo single-page export routes use the index fallback. */ }
      }
      selected ??= resolve(root, 'index.html');
      return reply(request, response, 200, await readFile(selected), contentTypes[extname(selected)] ?? 'application/octet-stream');
    } catch {
      return reply(request, response, 500, { code: 'SYNTHETIC_PREVIEW_ERROR' });
    }
  };
  const servers = [];
  try {
    for (const [listenPort, apiOnly] of [[port, false], ...(fixturePort === null ? [] : [[fixturePort, true]])]) {
      const server = createServer(handler(apiOnly));
      await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(listenPort, '127.0.0.1', resolveListen); });
      servers.push(server);
    }
  } catch (error) {
    await Promise.all(servers.map(server => new Promise(resolveClose => server.close(resolveClose))));
    throw error;
  }
  return { setScenario, requests, port: servers[0].address().port, fixturePort: servers[1]?.address().port, close: async () => { await Promise.all(servers.map(server => new Promise(resolveClose => { server.closeAllConnections(); server.close(resolveClose); }))); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await startPreview({ port: Number(process.env.PACHI_MOBILE_PREVIEW_PORT ?? 8085), fixturePort: Number(process.env.PACHI_MOBILE_FIXTURE_PORT ?? 8086), directory: process.env.PACHI_MOBILE_EXPORT_DIRECTORY, scenario: process.env.PACHI_MOBILE_FIXTURE_SCENARIO ?? 'normal' });
  process.stdout.write(`SYNTHETIC TEST inventory only; read-only; no database or accounts.\nNative Expo web review: http://localhost:${preview.port}\nLoopback fixture API: http://localhost:${preview.fixturePort}/v1\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void preview.close().then(() => process.exit(0)); });
}
