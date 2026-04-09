<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/0717dcf2-b9e9-4bfa-914f-17344c2f7904

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

### Troubleshooting on Windows

When running `npm run dev`, you may encounter the following error:

```
failed to load config from C:\...\vite.config.ts
error when starting dev server:
Error: Cannot find native binding. npm has a bug related to optional dependencies
(https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing
both package-lock.json and node_modules directory.
    at Object.<anonymous> (...\node_modules\@tailwindcss\oxide\index.js:559:11)
```

This is caused by a known npm bug where platform-specific optional dependencies (in this case the native Rust binary for Tailwind v4) are not installed correctly.

**To fix it:**

1. Delete `node_modules` and `package-lock.json`, then reinstall with `--force`:
   ```bash
   npm install --force
   ```
2. If the error persists, install the Windows native binding explicitly:
   ```bash
   npm install @tailwindcss/oxide-win32-x64-msvc
   ```
3. Run the app:
   ```bash
   npm run dev
   ```
