// Store configuration.
// To add a new product category later (phones, laptops...), add a key under
// `categories` in config/categories.js and the matching listing URL for each store here.

export const stores = {
  neptun: {
    name: 'Neptun',
    homepage: 'https://www.neptun.al',
    // Product data is embedded as JSON in the page + a JSON endpoint for more pages
    // (see scraper/adapters/neptun.js). Falls back to the headless browser if blocked.
    type: 'neptun',
    productLinkPattern: '/categories/.+',
    pageParam: 'page', // used only by the browser fallback
    categories: {
      tv: ['https://www.neptun.al/te_gjithe_tv.nspx'],
    },
  },
  globe: {
    name: 'Globe',
    homepage: 'https://globe.al',
    // Globe is a JavaScript app, so a headless browser is used.
    type: 'browser',
    productLinkPattern: '/products/\\d+',
    pageParam: 'page', // globe.al/products?categoryId=3048&page=2
    categories: {
      tv: ['https://globe.al/products?categoryId=3048'],
    },
  },
  shpresa: {
    name: 'Shpresa',
    homepage: 'https://shpresa.al',
    // WooCommerce: public Store API (JSON), with HTML fallback.
    type: 'woocommerce',
    categories: {
      tv: [{ slug: 'televizor', url: 'https://shpresa.al/product-category/tv-video-audio/televizor/' }],
    },
  },
  ozone: {
    name: 'Ozone',
    homepage: 'https://ozone.al',
    // PrestaShop: JSON listing endpoint, with HTML and browser fallbacks.
    type: 'prestashop',
    productLinkPattern: '/televizor-audio/\\d+-.+\\.html',
    categories: {
      tv: ['https://ozone.al/32-tv'],
    },
  },
  aza: {
    name: 'AZA Electronics',
    homepage: 'https://www.azaelectronics.com',
    // OpenCart: plain HTML with ?page=N&limit=100.
    type: 'opencart',
    productLinkPattern: '\\.html|product_id=',
    categories: {
      tv: ['https://www.azaelectronics.com/tvs'],
    },
  },
};
