
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Resend } from 'resend';

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

interface Item {
    url: string;
    name: string;
    lastStatus?: 'in_stock' | 'out_of_stock' | 'error';
}

interface Config {
    checkIntervalSeconds?: number;
    resendApiKey: string;
    emailFrom: string;
    emailTo: string;
    items: Item[];
}

const CONFIG_PATH = path.resolve(__dirname, '../config/config.json');

// Helper to Load Config
function loadConfig(): Config {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`Config file not found at ${CONFIG_PATH}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// Check if an item is in stock
async function checkItemStock(browser: any, item: Item): Promise<'in_stock' | 'out_of_stock' | 'error'> {
    const page = await browser.newPage();
    try {
        // Set viewport to look like a desktop browser
        await page.setViewport({ width: 1366, height: 768 });

        // Randomize user agent slightly or use a standard one
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`Checking stock for: ${item.name}`);
        await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Check for "Continue shopping" buttons (interstitials)
        // User reported specific button: <button type="submit" class="a-button-text" alt="Continue shopping">Continue shopping</button>
        try {
            // Check broadly for buttons that might be the interstitial
            const buttons = await page.$$('button, input[type="submit"], a');
            let continueBtn = null;

            for (const btn of buttons) {
                const text = await btn.evaluate((node: any) => (node as HTMLElement).innerText).catch(() => '');
                const alt = await btn.evaluate((node: any) => (node as HTMLElement).getAttribute('alt')).catch(() => '');
                if (
                    (text && text.toLowerCase().includes('continue shopping')) ||
                    (alt && alt.toLowerCase().includes('continue shopping'))
                ) {
                    continueBtn = btn;
                    break;
                }
            }

            if (continueBtn) {
                console.log("Found 'Continue shopping' interstitial. Clicking...");
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch((e: Error) => console.log("Navigation wait warning:", e.message)),
                    continueBtn.click()
                ]);
            }
        } catch (e) {
            console.log("Error handling interstitial:", e);
        }

        try {
            await page.waitForSelector('#productTitle', { timeout: 10000 });
        } catch (e) {
            try {
                const title = await page.title();
                console.warn(`Timeout waiting for #productTitle. Page title: "${title}". Page might be a CAPTCHA or failed to load.`);
            } catch (titleError) {
                console.warn(`Timeout waiting for #productTitle. Could not get page title (possibly detached):`, titleError);
            }
        }

        // Amazon specific selectors (these can change, so we might need robust logic)
        // Common "Add to Cart" button ID or "Buy Now" button
        const addToCartButton = await page.$('#add-to-cart-button');
        const buyNowButton = await page.$('#buy-now-button');
        const availabilityDiv = await page.$('#availability');

        let isAvailable = false;

        if (addToCartButton || buyNowButton) {
            isAvailable = true;
        }

        // Double check availability text if buttons aren't found or to verify "Currently unavailable"
        if (availabilityDiv) {
            const text = await page.evaluate((el: any) => el.innerText, availabilityDiv);
            if (text.toLowerCase().includes('currently unavailable') || text.toLowerCase().includes('out of stock')) {
                isAvailable = false;
            }
        }

        // Sometimes there are "See All Buying Options" which implies main stock is gone, or maybe 3rd party
        // For now, let's assume if there's no main add to cart, it's out of stock for the main price.

        return isAvailable ? 'in_stock' : 'out_of_stock';
    } catch (error) {
        console.error(`Error checking ${item.name}:`, error);
        return 'error';
    } finally {
        await page.close();
    }
}

async function sendNotification(config: Config, item: Item) {
    const resend = new Resend(config.resendApiKey);

    try {
        const { data, error } = await resend.emails.send({
            from: config.emailFrom,
            to: config.emailTo,
            subject: `In Stock: ${item.name}`,
            html: `
        <h1>Item Back in Stock!</h1>
        <p><strong>${item.name}</strong> is now available.</p>
        <p><a href="${item.url}">Buy Now on Amazon</a></p>
      `
        });

        if (error) {
            console.error('Error sending email:', error);
        } else {
            console.log('Email sent successfully:', data);
        }
    } catch (err) {
        console.error('Exception sending email:', err);
    }
}

async function main() {
    const config = loadConfig();
    const checkInterval = (config.checkIntervalSeconds || 300) * 1000;

    // Keep track of previous statuses to avoid spamming
    const STATUS_FILE = path.resolve(__dirname, '../config/status.json');
    let itemStatuses: Record<string, 'in_stock' | 'out_of_stock' | 'error'> = {};

    if (fs.existsSync(STATUS_FILE)) {
        try {
            itemStatuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
            console.log('Loaded previous statuses:', itemStatuses);
        } catch (e) {
            console.error('Failed to load status file:', e);
        }
    }

    console.log('Starting Amazon Item Tracker...');
    console.log(`Tracking ${config.items.length} items. Check interval: ${config.checkIntervalSeconds}s`);

    while (true) {
        // Reload config each loop...
        let currentConfig: Config;
        try {
            currentConfig = loadConfig();
        } catch (e) {
            console.error("Failed to reload config, using previous config", e);
            currentConfig = config;
        }

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        for (const item of currentConfig.items) {
            const status = await checkItemStock(browser, item);
            console.log(`Status for ${item.name}: ${status}`);

            const prevStatus = itemStatuses[item.url];

            if (status === 'in_stock' && prevStatus !== 'in_stock') {
                console.log(`!!! ${item.name} IS IN STOCK !!! Sending notification...`);
                await sendNotification(currentConfig, item);
                // Update status immediately and save
                itemStatuses[item.url] = status;
                fs.writeFileSync(STATUS_FILE, JSON.stringify(itemStatuses, null, 2));
            } else if (status !== 'error') {
                // Only update status if it's a valid check (not error)
                // If it was in_stock and now out_of_stock, update it.
                // If it was out_of_stock and still out_of_stock, update it (no change).
                if (itemStatuses[item.url] !== status) {
                    itemStatuses[item.url] = status;
                    fs.writeFileSync(STATUS_FILE, JSON.stringify(itemStatuses, null, 2));
                }
            } else {
                console.log(`Skipping status update for ${item.name} due to error.`);
            }

            // Small delay between items to be nice
            await new Promise(r => setTimeout(r, 5000));
        }

        await browser.close();

        console.log(`Cycle complete. Waiting ${checkInterval / 1000} seconds...`);
        await new Promise(r => setTimeout(r, checkInterval));
    }
}

main().catch(console.error);
