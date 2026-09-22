KOTON_SET RUN 4.1.0

Files:
- index.html — game frontend
- server.js — dependency-free leaderboard/static server
- package.json — Node start configuration
- data/scores.json — leaderboard storage
- assets/products/ — optional isolated transparent product PNG/WebP files

Run:
1. npm start
2. Open http://localhost:3000

For real product sprites, place:
hello-kitty-jacket.png
floral-denim-pants.png
hoodie-fur-pocket.png
cropped-pu-puffer.png
road-way-jacket.png
inside assets/products/.

The frontend is configured to use the same-origin API paths:
POST /api/scores
GET  /api/leaderboard
GET  /api/leaderboard/rank
