# doxa-maps — embedded example

This folder is an **example of doxa-maps portability**: it shows the standalone doxa-maps
bundler dropped into another repo.

Here the Vite build is set to output the map bundles into this site's **`public/` folder**, so the
site serves the built maps itself — acting as a **CDN** for them. That's a proof of the maps'
portability.

This is **not the only way** to serve the maps for embedding on partner sites. You can also use the
**doxa-maps repo on GitHub directly** (build there and serve from GitHub Pages / jsDelivr), or host
the built bundles on any CDN. The bundler is the same everywhere — only the output location changes.
