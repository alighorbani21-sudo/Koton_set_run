KOTON_SET RUN 4.1.1

Mobile-first HTML5 fashion endless runner.

Run locally:
  npm start
Then open:
  http://localhost:3000

Deployment:
  Node.js Web Service
  Build command: npm install
  Start command: npm start

Product assets:
  assets/products/hello-kitty-jacket.png
  assets/products/floral-denim-pants.png
  assets/products/hoodie-fur-pocket.png
  assets/products/cropped-pu-puffer.png
  assets/products/road-way-jacket.png

Leaderboard:
  POST /api/scores
  GET  /api/leaderboard?limit=20&playerId=...
  GET  /api/leaderboard/rank?playerId=...
  GET  /api/health
  GET  /healthz

4.1.1 changes:
  - One leaderboard entry per persistent playerId.
  - A new result replaces the player's previous result only when it ranks better.
  - Existing duplicate records are normalized on server startup.
  - Product image assets are included in assets/products/.

Telegram CTA remains:
  https://t.me/koton_set
