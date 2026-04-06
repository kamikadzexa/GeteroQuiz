# Getero Quiz

Private party quiz app with a React + TypeScript frontend and an Express + SQLite backend. It supports mobile-friendly player joins, JWT-protected admin tools, live Socket.IO updates, classic quiz rounds, and buzz-in trivia rounds.

## Stack

- Frontend: Vite, React, TypeScript
- Backend: Node.js, Express, Socket.IO
- Database: SQLite via Sequelize
- Auth: JWT for admin
- Uploads: local filesystem via Multer

## Project structure

```text
backend/
  src/
    controllers/
    middleware/
    models/
    routes/
    services/
    sockets/
  data/
  uploads/
frontend/
  src/
    components/
    context/
    hooks/
    i18n/
    pages/
    services/
    types/
```

## Features

- Players join an active session with a room code
- Players set a display name and choose or upload an avatar
- Players receive a short rejoin code for reconnecting
- Admin creates quizzes, edits questions, uploads media, and starts sessions
- Classic mode with timed answers and automatic multiple-choice scoring
- Buzz mode with first-buzzer lock, wrong-answer penalty, and manual judging
- English and Russian UI with JSON translation files
- Live leaderboard and session state updates through Socket.IO

## Local setup

### 1. Install dependencies

```powershell
cd backend
npm install

cd ../frontend
npm install
```

### 2. Configure environment

Copy the examples if you want custom values:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Default backend credentials after first boot:

- Username: `admin`
- Password: `party1234`

### 3. Start the backend

```powershell
cd backend
npm run dev
```

Backend defaults to `http://localhost:4000`.

### 4. Start the frontend

```powershell
cd frontend
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies API, uploads, and Socket.IO traffic to the backend.

## Production build

```powershell
cd frontend
npm run build
```

The production frontend bundle is emitted to `frontend/dist`.

## Backend data model

The SQLite schema is defined in Sequelize models under `backend/src/models`:

- `User`
- `Quiz`
- `Question`
- `GameSession`
- `Player`
- `Answer`
- `Score`

SQLite database file location:

- `backend/data/quiz.sqlite`

## Ubuntu VPS deployment

### 1. Install system packages

```bash
sudo apt update
sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Upload the project and install dependencies

```bash
cd /var/www/getero-quiz/backend
npm install --production

cd /var/www/getero-quiz/frontend
npm install
npm run build
```

### 3. Configure backend environment

Create `/var/www/getero-quiz/backend/.env`:

```env
PORT=4000
JWT_SECRET=replace-with-a-long-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me
ADMIN_DISPLAY_NAME=Quiz Host
CORS_ORIGIN=https://your-domain.example
MAX_UPLOAD_SIZE_MB=25
```

### 4. Run backend with PM2

```bash
cd /var/www/getero-quiz/backend
pm2 start src/server.js --name getero-quiz
pm2 save
pm2 startup
```

### 5. Serve frontend with Nginx

Example Nginx site config:

```nginx
server {
    listen 80;
    server_name your-domain.example;
    client_max_body_size 25M;

    root /var/www/getero-quiz/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:4000/uploads/;
        proxy_set_header Host $host;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/getero-quiz /etc/nginx/sites-enabled/getero-quiz
sudo nginx -t
sudo systemctl reload nginx
```

If uploads larger than 1 MB fail on Ubuntu, double-check the `client_max_body_size` value in your active Nginx site config and reload Nginx after changing it.

## Notes

- Session state is kept in memory for realtime flow and mirrored to SQLite for fallback data.
- Uploaded files are stored locally under `backend/uploads`.
- If port `4000` is already taken locally, change `PORT` in `backend/.env`.
