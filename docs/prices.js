// What PsycheAI charges, by currency, and which currency a reader pays in.
//
// One table, read by both sides: the page shows its prices from it, and the
// server (lib/stripe.js) charges only an amount from it, in a currency from
// it, and checks a payment against it. Amounts are in each currency's minor
// unit, as Stripe takes them — cents, pence — except JPY, which has none.
//
// Rounded local prices in the major markets; everywhere else pays in USD.
// To change a price, change it here and deploy; to add a market, add its
// currency below and its countries to COUNTRY_CURRENCY. Stripe accepts any of
// these on a Singapore account without further setup and converts them to
// the account's currency on payout.
(function (root) {
  'use strict';

  const TABLE = {
    usd: { symbol: 'US$', unlock: 500, analysis: 200 },
    sgd: { symbol: 'S$', unlock: 700, analysis: 300 },
    gbp: { symbol: '£', unlock: 400, analysis: 150 },
    eur: { symbol: '€', unlock: 500, analysis: 200 },
    aud: { symbol: 'A$', unlock: 800, analysis: 300 },
    cad: { symbol: 'C$', unlock: 700, analysis: 300 },
    nzd: { symbol: 'NZ$', unlock: 900, analysis: 350 },
    hkd: { symbol: 'HK$', unlock: 3900, analysis: 1500 },
    jpy: { symbol: '¥', unlock: 800, analysis: 300, zeroDecimal: true },
    chf: { symbol: 'CHF ', unlock: 500, analysis: 200 },
    myr: { symbol: 'RM', unlock: 2200, analysis: 900 },
  };
  const DEFAULT_CURRENCY = 'usd';
  // Stripe's smallest charge in each currency, in the same minor unit. A
  // discount never takes a price below it: a 95%-off code pays this instead
  // of an amount Stripe would refuse.
  const MINIMUM = { usd: 50, sgd: 50, gbp: 30, eur: 50, aud: 50, cad: 50, nzd: 50, hkd: 400, jpy: 50, chf: 50, myr: 200 };

  const EUROZONE = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV',
    'MT', 'NL', 'PT', 'SI', 'SK'];
  const COUNTRY_CURRENCY = Object.assign({
    US: 'usd', SG: 'sgd', GB: 'gbp', AU: 'aud', CA: 'cad', NZ: 'nzd', HK: 'hkd', JP: 'jpy',
    CH: 'chf', LI: 'chf', MY: 'myr',
  }, Object.fromEntries(EUROZONE.map(code => [code, 'eur'])));

  // Where the reader is, read from the browser: its time zone first, which
  // follows where the device is, then the region of its language. A guess,
  // and an honest one — the prices are rounded equivalents, so a wrong guess
  // costs a reader a little either way rather than a lot.
  const ZONE_COUNTRY = {
    'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
    'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
    'Europe/Vienna': 'AT', 'Europe/Lisbon': 'PT', 'Europe/Helsinki': 'FI', 'Europe/Athens': 'GR',
    'Europe/Luxembourg': 'LU', 'Europe/Bratislava': 'SK', 'Europe/Ljubljana': 'SI', 'Europe/Tallinn': 'EE',
    'Europe/Riga': 'LV', 'Europe/Vilnius': 'LT', 'Europe/Malta': 'MT', 'Asia/Nicosia': 'CY',
    'Europe/Nicosia': 'CY', 'Europe/Zagreb': 'HR', 'Europe/Zurich': 'CH', 'Europe/Vaduz': 'LI',
    'Asia/Singapore': 'SG', 'Asia/Hong_Kong': 'HK', 'Asia/Tokyo': 'JP', 'Asia/Kuala_Lumpur': 'MY',
    'Asia/Kuching': 'MY', 'Pacific/Auckland': 'NZ', 'Pacific/Chatham': 'NZ',
  };
  function countryFromZone(zone) {
    const z = String(zone || '');
    if (ZONE_COUNTRY[z]) return ZONE_COUNTRY[z];
    if (z.startsWith('Australia/')) return 'AU';
    if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit)$/.test(z)) return 'CA';
    if (/^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Juneau|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)|Pacific\/Honolulu)$/.test(z)) return 'US';
    return '';
  }

  /** The reader's country, best guess, as two letters, or '' when there is no telling. */
  function guessCountry(env) {
    const e = env || {};
    const zone = e.timeZone !== undefined ? e.timeZone : (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (error) { return ''; }
    })();
    const fromZone = countryFromZone(zone);
    if (fromZone) return fromZone;
    const languages = e.languages || (root.navigator && (root.navigator.languages || [root.navigator.language])) || [];
    for (const tag of languages) {
      const region = String(tag || '').split('-')[1];
      if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
    }
    return '';
  }

  /** The currency a country pays in: its own where the table has it, USD otherwise. */
  function currencyFor(country) {
    const currency = COUNTRY_CURRENCY[String(country || '').toUpperCase()];
    return currency && TABLE[currency] ? currency : DEFAULT_CURRENCY;
  }

  /** A known currency, or the default for anything else. */
  function known(currency) {
    const c = String(currency || '').toLowerCase();
    return TABLE[c] ? c : DEFAULT_CURRENCY;
  }

  /** What a product costs in a currency, in its minor unit. */
  function amount(currency, product) {
    const row = TABLE[known(currency)];
    const value = row[product === 'analysis' ? 'analysis' : 'unlock'];
    return value;
  }

  /**
   * What a product costs with `percent` taken off by a promo code: the table's
   * price less that share, rounded to a whole minor unit, and never under
   * Stripe's minimum for the currency. 100 or more is free (0).
   */
  function discounted(currency, product, percent) {
    const c = known(currency);
    const off = Number(percent) || 0;
    if (off >= 100) return 0;
    const full = amount(c, product);
    if (off <= 0) return full;
    return Math.min(full, Math.max(MINIMUM[c] || 50, Math.round(full * (100 - off) / 100)));
  }

  /** "S$7", "£1.50", "¥800": whole amounts without decimals, others with two. */
  function label(currency, product, minorAmount) {
    const c = known(currency);
    const row = TABLE[c];
    const minor = minorAmount == null ? amount(c, product) : minorAmount;
    const major = row.zeroDecimal ? minor : minor / 100;
    const text = Number.isInteger(major) ? String(major) : major.toFixed(2);
    return row.symbol + text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  root.PsychePrices = { TABLE, DEFAULT_CURRENCY, COUNTRY_CURRENCY, guessCountry, countryFromZone, currencyFor, known, amount, discounted, label, MINIMUM };
})(typeof window !== 'undefined' ? window : globalThis);
