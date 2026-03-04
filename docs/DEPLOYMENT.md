# Deployment Guide

## GitHub Pages

This repo uses a GitHub Actions workflow in `.github/workflows/pages.yml`.

### Setup

1. In GitHub: `Settings -> Pages`.
2. Set `Source` to `GitHub Actions`.
3. Push to `main`.

### URL

For this repo, the site URL is:
`https://csavenables.github.io/3DGSViewerV1/`

## Cloudflare Pages

### Setup

1. In Cloudflare Pages, connect the GitHub repo.
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Root directory: repo root (leave blank unless needed)

### Notes

- This is a static app, no server needed.
- Do not place secrets in frontend code.
- Scene assets must stay in `public/scenes/...` for predictable static paths.

## Post-Deploy Smoke Test

1. Open default URL.
2. Confirm one scene loads and model is visible.
3. Switch scenes from dropdown.
4. Test `Reset`, `Auto Rotate`, `Fullscreen`.
5. Confirm mobile portrait and landscape behavior.

## Wix Embed

Use Wix HTML iframe to embed your hosted viewer URL:

`https://<your-host>/?scene=cake&embed=1&replayButton=1&autorotate=1&parentOrigin=https://<your-wix-domain>`

### Optional PostMessage API

From Wix (HTML component):

- `viewer:playIntro`
- `viewer:setAutoRotate` with `{ value: true | false }`
- `viewer:reset`

Viewer emits:

- `viewer:ready` with `{ sceneId }`

For production embeds, set `parentOrigin` to your Wix site origin so incoming messages are origin-locked.
