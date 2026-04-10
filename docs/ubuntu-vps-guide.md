# Getero Quiz Ubuntu VPS Guide

This guide covers three separate workflows for this project:

1. Fresh installation on a new Ubuntu VPS
2. Updating the app and server packages later
3. Uninstalling the app cleanly

It is written for the current project structure:

- Backend: Node.js + Express + PM2
- Frontend: Vite build served by Nginx
- App path: `/var/www/getero-quiz`
- Backend process name: `getero-quiz`

Replace these placeholders before running commands:

- `YOUR_REPO_URL`
- `your-domain.com`
- `your-email@example.com`
- `replace-with-a-long-secret`
- `replace-me`

## 1. Fresh Install On A New Ubuntu VPS

### Step 1. Connect to the server

```bash
ssh root@your-server-ip
```

If you use a non-root user with sudo, run the same commands without switching users.

### Step 2. Update Ubuntu packages

```bash
sudo apt update
sudo apt upgrade -y
sudo apt autoremove -y
```

### Step 3. Install required system packages

```bash
sudo apt install -y nginx git curl ufw snapd build-essential python3 make g++
```

### Step 4. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### Step 5. Install PM2 globally

```bash
sudo npm install -g pm2
pm2 -v
```

### Step 6. Configure firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

### Step 7. Clone the project

```bash
sudo mkdir -p /var/www
cd /var/www
sudo git clone YOUR_REPO_URL getero-quiz
sudo chown -R $USER:$USER /var/www/getero-quiz
cd /var/www/getero-quiz
```

### Step 8. Install backend dependencies

```bash
cd /var/www/getero-quiz/backend
npm install --omit=dev
```

### Step 9. Create backend environment file

```bash
cat > /var/www/getero-quiz/backend/.env <<'EOF'
PORT=4000
JWT_SECRET=replace-with-a-long-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me
ADMIN_DISPLAY_NAME=Quiz Host
CORS_ORIGIN=https://your-domain.com
MAX_UPLOAD_SIZE_MB=300
EOF
```

### Step 10. Start the backend with PM2

```bash
cd /var/www/getero-quiz/backend
pm2 start src/server.js --name getero-quiz --max-memory-restart 512M
pm2 save
pm2 startup
```

After `pm2 startup`, PM2 will print one more command. Run that command exactly once so the service starts on reboot.

### Step 11. Install frontend dependencies and build

```bash
cd /var/www/getero-quiz/frontend
npm install
npm run build
```

The production site files will be created in `/var/www/getero-quiz/frontend/dist`.

### Step 12. Create the Nginx site config

```bash
sudo tee /etc/nginx/sites-available/getero-quiz > /dev/null <<'EOF'
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Allow large media uploads (must match MAX_UPLOAD_SIZE_MB in backend .env)
    client_max_body_size 300M;

    # Performance: efficient file transfer and connection reuse
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;

    # Gzip compression for text assets
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/x-javascript
        text/xml
        application/xml
        image/svg+xml;

    root /var/www/getero-quiz/frontend/dist;
    index index.html;

    # SPA fallback for frontend routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Vite build assets have content-hashed filenames — cache aggressively
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Backend API — stream uploads without buffering to Node, allow long transfers
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Do not buffer uploads in Nginx before forwarding — stream directly to Node
        proxy_request_buffering off;

        # Allow up to 5 minutes for large file uploads and slow connections
        proxy_connect_timeout 60s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;
    }

    # Avatar uploads — served directly from disk for speed
    location /uploads/ {
        alias /var/www/getero-quiz/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public";
        add_header X-Content-Type-Options nosniff;
        try_files $uri =404;
    }

    # Quiz media files — served directly from disk for speed
    # Without this block, quiz images/audio/video will never load on the server.
    location /quiz-data/ {
        alias /var/www/getero-quiz/backend/data/quizzes/;
        expires 7d;
        add_header Cache-Control "public";
        add_header X-Content-Type-Options nosniff;
        try_files $uri =404;
    }

    # WebSocket for real-time quiz sessions — needs a long idle timeout
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Keep socket connections alive for the duration of a quiz session
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF
```

### Step 13. Enable the Nginx site

```bash
sudo ln -sf /etc/nginx/sites-available/getero-quiz /etc/nginx/sites-enabled/getero-quiz
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

### Step 14. Install SSL certificate with Certbot

Make sure your domain already points to the VPS before running this.

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot

sudo certbot --nginx -d your-domain.com -d www.your-domain.com -m your-email@example.com --agree-tos --redirect
sudo certbot renew --dry-run
```

### Step 15. Verify the deployment

```bash
pm2 status
pm2 logs getero-quiz --lines 50

sudo nginx -t
sudo systemctl status nginx --no-pager

ls -la /var/www/getero-quiz/frontend/dist
curl -I http://127.0.0.1:4000/api
```

### Step 16. Check the site in the browser

Open:

- `https://your-domain.com`
- `https://www.your-domain.com`

If the backend is reachable but the website looks old, clear browser cache and confirm that Nginx is serving `/var/www/getero-quiz/frontend/dist`.

## 2. Updating The App Later

Use this when the code in Git changed and you want the server to get the latest version.

### Step 1. Connect to the VPS

```bash
ssh root@your-server-ip
```

### Step 2. Pull the latest code

```bash
cd /var/www/getero-quiz
git pull origin main
```

Confirm you got the expected commit:

```bash
git log -1 --oneline
```

### Step 3. Update backend dependencies

Run this every time after a pull so any added or changed packages are installed.
It is safe to run when nothing changed — it will finish instantly.

```bash
cd /var/www/getero-quiz/backend
npm install --omit=dev
```

### Step 4. Restart the backend

```bash
pm2 restart getero-quiz
```

Wait a few seconds, then confirm the process is online and not crashing:

```bash
pm2 status
pm2 logs getero-quiz --lines 30
```

If the logs show errors, check the `.env` file and fix the issue before continuing.

### Step 5. Update frontend dependencies and rebuild

Run this every time after a pull.

```bash
cd /var/www/getero-quiz/frontend
npm install
npm run build
```

The build output goes to `/var/www/getero-quiz/frontend/dist`.
Check that new files appeared there and the timestamps are current:

```bash
ls -la /var/www/getero-quiz/frontend/dist
```

### Step 6. Reload Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Always run `nginx -t` first. If it reports a config error, fix it before reloading.

### Step 7. Verify the update

Open the site in the browser. If it still shows old content:

1. Hard-refresh the browser (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac).
2. Check that the dist folder has the correct build:

```bash
ls -la /var/www/getero-quiz/frontend/dist/assets/
```

3. Check Nginx is serving the right folder:

```bash
sudo grep -R "root /var/www/getero-quiz/frontend/dist;" /etc/nginx/sites-enabled /etc/nginx/sites-available
```

4. Check the backend is running on port 4000:

```bash
curl -s http://127.0.0.1:4000/api/health
```

This should return `{"ok":true}`. If it does not, the backend process is down — check `pm2 logs getero-quiz`.

## 3. Updating Ubuntu And Installed Programs

Use this separately when you want to update system packages, Node.js, and PM2.

### Step 1. Update Ubuntu packages

```bash
sudo apt update
sudo apt upgrade -y
sudo apt autoremove -y
```

### Step 2. Check Node.js and npm versions

```bash
node -v
npm -v
```

### Step 3. Refresh Node.js 22 from NodeSource

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### Step 4. Update PM2

```bash
sudo npm install -g pm2@latest
pm2 update
pm2 save
pm2 -v
```

### Step 5. Check Nginx

```bash
nginx -v
sudo nginx -t
sudo systemctl restart nginx
```

### Step 6. Rebuild the app after runtime updates

```bash
cd /var/www/getero-quiz/backend
npm install --omit=dev
pm2 restart getero-quiz

cd /var/www/getero-quiz/frontend
npm install
npm run build

sudo systemctl reload nginx
```

## 4. Full Uninstall And Cleanup

Use this only if you want to completely remove the app from the server.

### Step 1. Stop and remove the PM2 process

```bash
pm2 stop getero-quiz || true
pm2 delete getero-quiz || true
pm2 save
```

### Step 2. Remove the Nginx site config

```bash
sudo rm -f /etc/nginx/sites-enabled/getero-quiz
sudo rm -f /etc/nginx/sites-available/getero-quiz
sudo nginx -t
sudo systemctl reload nginx
```

### Step 3. Remove the project files

```bash
sudo rm -rf /var/www/getero-quiz
```

### Step 4. Optionally remove SSL certificate

List certificates first:

```bash
sudo certbot certificates
```

Then delete the one for your domain:

```bash
sudo certbot delete
```

### Step 5. Optionally uninstall PM2

```bash
sudo npm uninstall -g pm2
```

### Step 6. Optionally uninstall Node.js

```bash
sudo apt remove -y nodejs
sudo apt autoremove -y
```

### Step 7. Optionally uninstall Nginx

```bash
sudo systemctl stop nginx
sudo apt remove -y nginx nginx-common
sudo apt autoremove -y
```

### Step 8. Optionally remove firewall rules

```bash
sudo ufw delete allow 'Nginx Full'
sudo ufw status
```

## 5. Quick Command Sets

### Fresh install summary

```bash
sudo apt update && sudo apt upgrade -y && sudo apt autoremove -y
sudo apt install -y nginx git curl ufw snapd build-essential python3 make g++
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo mkdir -p /var/www
cd /var/www
sudo git clone YOUR_REPO_URL getero-quiz
sudo chown -R $USER:$USER /var/www/getero-quiz
cd /var/www/getero-quiz/backend
npm install --omit=dev
cd /var/www/getero-quiz/frontend
npm install
npm run build
```

### App update summary

```bash
cd /var/www/getero-quiz
git pull origin main
git log -1 --oneline
cd /var/www/getero-quiz/backend
npm install --omit=dev
pm2 restart getero-quiz
pm2 logs getero-quiz --lines 20 --nostream
cd /var/www/getero-quiz/frontend
npm install
npm run build
sudo nginx -t
sudo systemctl reload nginx
curl -s http://127.0.0.1:4000/api/health
```

### Full uninstall summary

```bash
pm2 delete getero-quiz || true
pm2 save
sudo rm -f /etc/nginx/sites-enabled/getero-quiz
sudo rm -f /etc/nginx/sites-available/getero-quiz
sudo systemctl reload nginx
sudo rm -rf /var/www/getero-quiz
```

## 6. Common Problems

### Quiz images and audio do not load (media files return 404 or the page)

This means the Nginx config is missing the `/quiz-data/` location block. Nginx has no route for that path and falls through to the SPA fallback, which returns `index.html` instead of the file.

Check whether the block exists:

```bash
sudo grep -A3 "quiz-data" /etc/nginx/sites-available/getero-quiz
```

If it is missing, recreate the Nginx config (Step 12) and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Also verify that Nginx can read the media folder:

```bash
ls /var/www/getero-quiz/backend/data/quizzes/
```

If the directory is missing or empty, no quiz media has been uploaded yet, which is expected on a fresh install.

### File uploads larger than 1 MB fail with a 413 error

Nginx has a default `client_max_body_size` of 1 MB. The Nginx config for this app raises it to 300 MB. If you are getting 413 errors, the directive is missing or was lost when Certbot rewrote the config for HTTPS.

Check the active config:

```bash
sudo grep -r "client_max_body_size" /etc/nginx/
```

If the value is missing or lower than expected, recreate the config (Step 12), then re-run Certbot to restore HTTPS:

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com -m your-email@example.com --agree-tos --redirect
sudo nginx -t
sudo systemctl reload nginx
```

### The site did not update after `git pull`

Run:

```bash
cd /var/www/getero-quiz
git log -1 --oneline

cd /var/www/getero-quiz/frontend
npm run build

sudo grep -R "root /var/www/getero-quiz/frontend/dist;" /etc/nginx/sites-enabled /etc/nginx/sites-available
```

Most often, the code was pulled but the frontend was not rebuilt, or Nginx is serving a different folder.

### PM2 restarted but the browser still shows old pages

That is expected if only frontend files changed. PM2 controls the backend process. Frontend changes require:

```bash
cd /var/www/getero-quiz/frontend
npm run build
sudo systemctl reload nginx
```

### SSL install fails

Check:

1. The domain points to the VPS public IP.
2. Port 80 is open in the firewall.
3. Nginx is running successfully before Certbot starts.

### Backend install fails on `sqlite3` with `node-gyp` or `make not found`

This means the server is missing build tools needed for native Node modules.

Install them:

```bash
sudo apt update
sudo apt install -y build-essential python3 make g++
```

Then retry the backend install:

```bash
cd /var/www/getero-quiz/backend
rm -rf node_modules
npm install --omit=dev
```

If you already created a broken partial install and want a cleaner retry:

```bash
cd /var/www/getero-quiz/backend
rm -rf node_modules package-lock.json
npm install --omit=dev
```

The warning about `--production` versus `--omit=dev` is not the failure. The actual blocker is usually:

```text
gyp ERR! stack Error: not found: make
```

## 7. Project References

This guide matches the current project deployment model documented in the main README:

- Backend runs with PM2 from `backend/src/server.js`
- Frontend is built with Vite into `frontend/dist`
- Nginx serves the frontend and proxies `/api`, `/uploads`, and `/socket.io`
