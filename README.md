# Lunch Account

A TypeScript app for lunch orders, daily bills, and monthly settlements.

## Run locally

Use Node.js 20.10 or later and npm. Install the dependencies and start the app from this directory.

```sh
npm ci
npm start
```

Open [Lunch Account](http://127.0.0.1:41735). With no Firebase configuration, the app stores lunch entries in `data/ledger.json` and meal preferences in `data/participants.json`.

Use **Manage people** to add a name and choose **Full meal** or **Poriyal only**. You can change the meal type there later. A saved lunch keeps the meal type and prices recorded for that date.

## Connect a Firebase Spark project

1. In the [Firebase console](https://console.firebase.google.com/), create a Spark project, register a Web App, and create the default Cloud Firestore database in production mode.
2. Enable Google sign-in in Firebase Authentication. Under **Authorized domains**, add the hostname where you will open the app, such as `127.0.0.1` for local testing or your GitHub Pages hostname for a hosted build.
3. Copy `firebase-config.example.json` to `firebase-config.json` and fill the `firebase` object with the Web App configuration from the console. Use the browser configuration fields only. The app never needs a service account key.
4. Publish the contents of `firestore.rules` in the Firestore Rules tab for this project. The rules limit reads and writes to each signed-in user's ledger.
5. Restart the app and sign in with Google. Use the same Google account on both devices to access the same entries. If local entries exist, open the app on the original computer and use **Import local entries** after sign-in. Dates already in Firestore keep their saved entries.

For static hosting, run `npm run build` to build the interface and its public Firebase configuration into `dist/web`. Deploy that directory to the static host. The Firebase-configured build uses Firestore through the browser SDK.

## Lunch rules

- Bharath and Riti share one food portion when both eat. If only one eats, that person pays for the full portion. Bharath gets the extra paise when the price cannot be split to the nearest paise.
- Egg charges follow each person's egg count. An extra charge is added to that person's share and the day's bill.
- Select who paid the full bill upfront to include that day in net balances. A day with no recorded payer still counts toward each person's lunch share.
- Open a saved day in the monthly summary to review or edit it. New dates use the most recent earlier saved prices, with initial prices of ₹80 for food, ₹30 for poriyal, and ₹15 per egg.
