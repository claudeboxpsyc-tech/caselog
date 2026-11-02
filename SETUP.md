# Setting up Case Log for friends

This version needs no NAS. Each person's cases live on their own phone and computer, and the
devices sync through a small relay that only ever sees encrypted data. You set it up once (about
20 minutes, both services free) and then send friends one link.

You'll set up two things:

1. **The relay** on Cloudflare: passes encrypted cases between a person's devices.
2. **The app** on GitHub Pages: the web address everyone opens.

Do them in this order, because the app needs the relay's address.

---

## Part 1: The relay (Cloudflare)

1. Create a free account at <https://dash.cloudflare.com/sign-up> and verify your email.

2. **Create the database.** In the left menu open **Storage & databases → D1 SQL database**
   and click **Create database**. Name it `caselog-relay` and create it.

3. **Create the tables.** Open the new database, go to its **Console** tab, paste the whole
   contents of `relay/schema.sql`, and click **Execute**. You should see that the commands ran
   successfully.

4. **Create the Worker.** In the left menu open **Compute → Workers & Pages**, click
   **Create**, choose **Start with Hello World**, name it `caselog-relay`, and click **Deploy**.

5. **Put in the relay code.** On the Worker's page click **Edit code**. Delete everything in
   the editor, paste the whole contents of `relay/worker.js`, and click **Deploy**.

6. **Connect the database.** On the Worker's page open **Bindings** (under Settings on some
   accounts), click **Add binding → D1 database**. Set **Variable name** to `DB` (capitals,
   exactly) and choose `caselog-relay`. Save, then deploy if asked.

7. **Copy the address.** The Worker's page shows its address, like
   `https://caselog-relay.yourname.workers.dev`. Keep it for Part 2.

8. **Check it.** Open this in a browser, with your address:
   `https://caselog-relay.yourname.workers.dev/v1/rooms/00000000000000000000000000000000/batches`.
   You should see `{"error":"Missing or malformed token."}`. That means it's working. If you see
   an error about `DB`, recheck step 6.

Cloudflare's menu names change from time to time; if one doesn't match, look for the nearest
equivalent ("D1", "Workers", "Bindings").

---

## Part 2: The app (GitHub Pages)

1. **Put in the relay address.** Open `config.js` in a text editor (Notepad, TextEdit in plain-text
   mode, or any code editor) and replace the address with yours:

   ```js
   export const RELAY_URL = "https://caselog-relay.yourname.workers.dev";
   ```

   No slash at the end. Save.

2. Create a free account at <https://github.com/signup> if you don't have one.

3. **Create the repository.** Click **+ → New repository**. Name it `caselog`, choose
   **Public** (free GitHub Pages needs it; the app's code is public, nobody's cases ever are),
   and click **Create repository**.

4. **Upload the files.** On the new repository's page click **uploading an existing file**.
   Open the `caselog-web` folder on your computer, select **everything inside it** (the files and
   the `fonts`, `icons`, `vendor` and `relay` folders) and drag it onto the page. Wait for the
   list to finish, then click **Commit changes**.

   `.nojekyll` is a hidden file; it's fine if it doesn't come along.

5. **Turn on Pages.** In the repository open **Settings → Pages**. Under **Build and deployment**
   set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.

6. After a minute or two the page shows your site's address:
   `https://yourusername.github.io/caselog/`. Open it. The app should load, and **More → Sync with
   your other device** should show **Set up sync on this device**. If it says the relay address
   is missing, `config.js` wasn't updated (you can fix it on GitHub: open the file, click the
   pencil icon, edit, **Commit changes**).

That address is the one you send to friends, together with `FRIENDS.md`.

---

## Updating later

When you get a new version, upload the changed files the same way (step 4 overwrites files with
the same names). Keep your `config.js` rather than the new one, or edit the address again.
Devices pick up the new version the next time the app is opened with an internet connection.

## What it costs and what it holds

- Both services are free at this scale. Cloudflare's free plan allows 100,000 relay requests a
  day; one person's two devices use a few hundred.
- The relay stores only encrypted batches. The key is created on the device and travels only in
  the pairing QR code, so neither you, Cloudflare nor GitHub can read anyone's cases. Even with
  full access to your Cloudflare account, someone would see only scrambled text and anonymous
  random IDs.
- Everyone's real copy of their log is on their own devices. If someone unpairs or loses a
  device, their other device still has everything.
