# Krahaso: price comparison for Albanian electronics stores

Krahaso checks **Neptun, Globe, Shpresa, Ozone and AZA Electronics** on a schedule, matches the same product across stores by model number, and shows the best offer first. It starts with **TVs**, and you can add more categories later.

```
public/            the website (static: index.html, app.js, styles.css)
public/data/       prices written by the scraper (tv.json, history-tv.json, index.json)
scraper/           the scraper: one adapter per store platform + product matching
config/stores.js   store list and listing URLs per category
config/categories.js  categories and accessory filters
config/aliases.json   manual product matches, if automatic matching misses one
server.js          optional self-hosted server (website + scrape timer)
.github/workflows/scrape.yml   free hosting: scrape every 3 h + publish on GitHub Pages
```

## How it reads each store

| Store | Platform | Method |
|---|---|---|
| Shpresa | WooCommerce | Public Store API (JSON), HTML fallback |
| AZA Electronics | OpenCart | Category HTML, `?limit=100&page=N` |
| Ozone | PrestaShop | JSON listing (XHR), HTML fallback |
| Neptun | Angular app | Product JSON embedded in the page (`data-categorydetails`) + `POST /NeptunCategories/LoadProductsForCategory` for all pages; headless Chrome fallback |
| Globe | JavaScript app | Headless Chrome, `?page=N` |

If the normal method fails for a store, the scraper retries it with headless Chrome. If that also fails, the store keeps its **last good prices**, marked "price from X ago" on the site, so one blocked run never empties the page. The coloured dots at the top show each store's status: green is OK, amber means the last check failed, grey means not checked yet.

## Option A: free hosting on GitHub (recommended)

1. Create a new GitHub repository and push this folder to its `main` branch.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Open **Actions → "Scrape prices and publish site" → Run workflow** once.

After that, the site goes live at `https://<your-user>.github.io/<repo>/` and refreshes every 3 hours. Every run commits the new prices, so price history builds up over time. To change how often it runs, edit the `cron` line in `.github/workflows/scrape.yml`. GitHub's minimum is every 5 minutes, but every 1–3 hours is polite to the stores.

## Option B: your own server or VPS

```bash
npm install
npx playwright install --with-deps chromium
npm start                  # http://localhost:3000, re-scrapes every 3 hours
# PORT=8080 SCRAPE_EVERY_HOURS=1 npm start
```

Run it under `pm2` or `systemd` to keep it running. An Albanian or EU server is less likely to be blocked by the stores than a US datacenter.

## Run a scrape by hand

```bash
npm run scrape                       # all stores, all categories
node scraper/index.js --store aza    # one store
node scraper/index.js --category tv  # one category
npm test                             # parser + end-to-end tests against a local mock of all 5 platforms
```

## Adding a category later (phones, laptops, fridges…)

1. Add it to `config/categories.js`, for example:
   ```js
   phones: { label: 'Phones', exclude: /KELLEF|CASE|MBROJTESE|KARIKUES|KABELL|XHAM/ },
   ```
2. Add the category's listing URL for each store in `config/stores.js`:
   ```js
   categories: { tv: [...], phones: ['https://www.azaelectronics.com/celulare'] },
   ```
   Shpresa takes `{ slug, url }`, where the slug is the WooCommerce category slug from the URL.
3. Run `npm run scrape`. A new tab appears on the site automatically.

Product matching (`scraper/lib/match.js`) works from model numbers. It already handles TV naming, including Samsung's regional suffixes (`UE55U8072FUXXH` = "Samsung 55" U8072F"). Phones are named by model and storage ("Galaxy S26 256GB"). When you add phones, extend `productKey()` to build keys from brand + model + storage.

## When a store changes its website

The site shows that store with an amber dot, and the Actions log says `FAILED: …`. Usually the fix is one of these:

- **The listing URL moved.** Update it in `config/stores.js`.
- **The product link format changed** (browser stores). Update `productLinkPattern` in `config/stores.js`.
- **The HTML changed** (AZA, Shpresa and Ozone fallbacks). Adjust the CSS selectors in `scraper/adapters/<platform>.js`.

## Fixing a wrong match

If two products that should be one row show separately, or the other way round, map them by hand in `config/aliases.json`:

```json
{ "byUrl": { "https://www.neptun.al/categories/.../TV-XYZ": "samsung|55|u8072f" }, "byName": {} }
```

The key of any product is visible in `public/data/tv.json`.

## Notes

- Prices are read from public pages. The site tells visitors to confirm the price on the store's page before buying.
- Keep the schedule reasonable (hourly or less often). Each run makes roughly 10–30 page requests per store.
