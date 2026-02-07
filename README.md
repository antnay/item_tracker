# Amazon Item Tracker

A lightweight tracking service that monitors Amazon product availability and sends email notifications when items come back in stock.

## Features

- **Automated Checking**: Monitor items at configurable intervals.
- **Stock Detection**: Checks if the "Add to Cart" or "Buy Now" button is available.
- **Email Notifications**: Uses Resend to send instant alerts.
- **Stealth Mode**: Uses Puppeteer with stealth plugins to avoid detection.
- **Dockerized**: Easy deployment with Docker Compose.

## Configuration

Edit `config/config.json` to add your items and email settings:

```json
{
  "checkIntervalSeconds": 300,
  "resendApiKey": "re_123456789",
  "emailFrom": "onboarding@resend.dev",
  "emailTo": "you@example.com",
  "items": [
    {
      "url": "https://www.amazon.com/dp/B08H93ZRK9",
      "name": "PlayStation 5 Digital Edition"
    }
  ]
}
```

**Note:** Ensure your `emailFrom` domain is verified in Resend, or use the test domain `onboarding@resend.dev` sending ONLY to your own email address if testing.

## Running with Docker

1. **Build and Start**:
   ```bash
   docker-compose up -d --build
   ```

2. **View Logs**:
   ```bash
   docker-compose logs -f
   ```

3. **Stop**:
   ```bash
   docker-compose down
   ```

## Local Development

If you want to run without Docker:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build typescript:
   ```bash
   npm run build
   ```
3. Run the tracker:
   ```bash
   npm start
   ```
