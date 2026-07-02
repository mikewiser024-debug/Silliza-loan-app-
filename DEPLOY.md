# Silliza — Deployment Guide

## Your Files
```
silliza/
├── index.html       ← The full app
├── manifest.json    ← PWA config
├── sw.js            ← Offline / service worker
└── icons/           ← App icons (all sizes)
```

---

## STEP 1 — HOST IT (FREE, 2 MINUTES)

### Option A: Netlify (Easiest)
1. Go to https://netlify.com and sign up free
2. Drag the entire `silliza/` folder onto the page
3. Netlify gives you a live URL like: `https://silliza.netlify.app`
4. Done! Share the link — people can open it on any phone

### Option B: Vercel
1. Go to https://vercel.com and sign up free
2. Install Vercel CLI: `npm i -g vercel`
3. In the silliza folder, run: `vercel`
4. Follow the prompts — you'll get a live URL

---

## STEP 2 — INSTALL ON ANDROID (NO APP STORE NEEDED)

Once hosted, users can install directly from Chrome:
1. Open the URL in Chrome on Android
2. A banner will appear: "Add Silliza to Home Screen"
3. Tap Install → app appears on home screen
4. Works offline (cached by service worker)

---

## STEP 3 — BUILD A REAL ANDROID APK (OPTIONAL)

To publish on Google Play Store ($25 one-time fee):

### Requirements
- Node.js installed (https://nodejs.org)
- Android Studio installed (https://developer.android.com/studio)
- Java 17+

### Commands
```bash
# 1. Create a new folder for Capacitor project
mkdir silliza-app && cd silliza-app

# 2. Init Node project
npm init -y

# 3. Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# 4. Copy your web files
mkdir www
cp -r /path/to/silliza/* www/

# 5. Init Capacitor
npx cap init Silliza com.silliza.app --web-dir www

# 6. Add Android
npx cap add android

# 7. Open in Android Studio
npx cap open android
```

In Android Studio:
- Click **Build → Generate Signed Bundle / APK**
- Choose APK → create a keystore → build
- Upload the APK to Google Play Console

---

## STEP 4 — iOS (REQUIRES MAC + APPLE DEVELOPER ACCOUNT $99/yr)

```bash
npx cap add ios
npx cap open ios
```
Then build and submit via Xcode.

---

## AI AGENT (SILA) — API KEY NOTE

The Sila AI agent calls the Anthropic API. In the hosted version,
Claude.ai handles the API key automatically.

If you host it yourself, you'll need to add your API key.
For security, set up a small backend (Node/Express) that holds the key
and forwards requests — never put the API key in your HTML file directly.

Simple backend example:
```javascript
// server.js
const express = require('express');
const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(req.body)
  });
  const data = await response.json();
  res.json(data);
});

app.listen(3000);
```

Deploy this backend to Railway (https://railway.app) — free tier available.
Then change the fetch URL in index.html from `https://api.anthropic.com/v1/messages`
to your backend URL.

---

## QUICK SUMMARY

| Goal | Tool | Cost | Time |
|------|------|------|------|
| Share link | Netlify/Vercel | Free | 2 min |
| Install on Android | Chrome PWA | Free | 0 min |
| Google Play APK | Capacitor + Android Studio | $25 | 2–4 hrs |
| iOS App Store | Capacitor + Xcode | $99/yr | 4–8 hrs |
