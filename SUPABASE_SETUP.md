# Supabase Realtime Setup

This app can sync shared group membership live across everyone who opens the same shared link.

## 1. Create the table

Run the SQL in [supabase/schema.sql](/Users/shavil/Documents/New project/supabase/schema.sql) in the Supabase SQL editor.

This creates:
- `public.chemistry_groups`
- open anon read/write policies for this prototype
- Realtime publication for the table

## 2. Add your public client config

Edit [config.js](/Users/shavil/Documents/New project/config.js):

```js
window.PERSONALITY_CHEMISTRY_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  supabaseTable: "chemistry_groups"
};
```

For a browser app, the Supabase URL and anon key are public client credentials.

## 3. Push and redeploy

Commit and push the updated `config.js`, then Vercel will redeploy.

## 4. What syncs live

These changes are shared in realtime:
- added people
- removed people
- the shared default group composition

These stay local to each viewer:
- which node is currently selected as the active chemistry subject
- hover state
- language toggle
- label visibility toggle

## Notes

- If `config.js` is blank, the app falls back to local-only mode.
- This prototype uses open anon policies so anyone with the public site can contribute to the shared group data.
- For a production-hardened version, the next step would be authenticated writes or signed row-level access.
