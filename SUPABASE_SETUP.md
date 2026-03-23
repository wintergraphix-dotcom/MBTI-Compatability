# Supabase Group Setup

This version stores public groups and group members separately, so the app can open a default public group at the root URL and let anyone create their own.

## 1. Run the schema

Run the SQL in [supabase/schema.sql](/Users/shavil/Documents/New project/supabase/schema.sql) in the Supabase SQL editor.

This creates:
- `public.chemistry_public_groups`
- `public.chemistry_group_members`
- open anon policies for this prototype
- Realtime publication for both tables

## 2. Check config

Make sure [config.js](/Users/shavil/Documents/New project/config.js) includes:

```js
window.PERSONALITY_CHEMISTRY_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  supabaseGroupsTable: "chemistry_public_groups",
  supabaseMembersTable: "chemistry_group_members",
  defaultGroupSlug: "shavs-crew",
  defaultGroupName: "Shav's crew"
};
```

## 3. Deploy

Commit and push the frontend changes, then let Vercel redeploy.

## 4. What the app now does

- The root URL opens the default public group, `Shav's crew`
- Public group links use clean slugs like `/g/shavs-crew`
- Admin access stays token-based through the private admin link
- Participants get the public group view only
- Anyone can start their own public group from the app

## Notes

- This prototype keeps groups public and writable for anyone with the public link.
- Admin tokens are stored hashed in Supabase. The browser keeps the plain admin token locally for copy/admin access.
- If a group slug is missing, the app falls back gracefully instead of crashing.
