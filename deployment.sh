
#!/bin/bash

sudo apt update -y
sudo apt install -y nginx git curl

# Node.js + npm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone your app
cd /home/ubuntu
git clone https://github.com/YOURUSERNAME/YOUR-APP.git
cd YOUR-APP
npm install
npm run build || true

# PM2 setup
sudo npm install -g pm2
pm2 start app.js --name node-app
pm2 startup systemd
pm2 save

# Nginx setup
sudo bash -c 'cat > /etc/nginx/sites-available/node-app <<EOF
server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF'

sudo ln -s /etc/nginx/sites-available/node-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

echo "Deployment completed!"


