# Sanitas Benefits Tracker

**Deploy-Optionen:** GitHub Pages _oder_ Vercel.

### GitHub Pages
1. Repo erstellen, Dateien hochladen.
2. In `vite.config.js` die `base` auf `/<REPO-NAME>/` setzen (z. B. `/sanitas-tracker/`).
3. Pushen → Workflow deployt automatisch.
4. URL: `https://<user>.github.io/<REPO-NAME>/`

### Vercel
1. Repo auf vercel.com importieren.
2. Framework: **Vite** (Build: `vite build`, Output: `dist`).
3. Deploy → URL: `https://<project>.vercel.app`

### Lokal
```bash
npm i
npm run dev
```
