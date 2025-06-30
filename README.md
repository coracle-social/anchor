A nostr notifier service.

# Deploying Anchor

## Configuration

Anchor includes several environment variables which need to be either added to the environment or placed in a `.env` file:

- `ANCHOR_SECRET` - a nostr private key used to sign messages and decrypt messages
- `ANCHOR_NAME` - the name of the Anchor instance
- `ANCHOR_URL` - the URL of the Anchor instance
- `INDEXER_RELAYS` - a comma-separated list of relays to use for retrieving `kind 10002` events
- `DEFAULT_RELAYS` - a comma-separated list of relays to use as fallbacks
- `SEARCH_RELAYS` - a comma-separated list of relays to use for searching nostr
- `POSTMARK_API_KEY` - a postmarkapp.com API key
- `POSTMARK_SENDER_ADDRESS` - a postmarkapp.com sender email
- `FCM_KEY` - a Firebase Cloud Messaging API key
- `APN_KEY` - an Apple Push Notifications key
- `APN_KEY_ID` - an Apple Push Notifications key ID
- `APN_TEAM_ID` - an Apple Push Notifications team ID
- `APN_PRODUCTION` - whether to use production APN notifications (`true` for production, otherwise sandbox will be used)
- `VAPID_PRIVATE_KEY` - a VAPID private key
- `VAPID_PUBLIC_KEY` - a VAPID public key corresponding to the private key
- `VAPID_SUBJECT` - a URL for the VAPID subject
- `PORT` - The port to run the web server and relay on

## Installation

There will be some parts of the following templates, for example `<SERVER NAME>`, which you'll need to fill in before running the code. This guide will walk you through creating a user, installing dependencies, and building anchor.

```sh
# Replace with your password
PASSWORD=<YOUR PASSWORD HERE>

# Add the user and set a password
adduser anchor
echo anchor:$PASSWORD | chpasswd

# Login as anchor
sudo su anchor

# Go to anchor's home directory
cd ~

# Install nvm, yarn, clone repos
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Update PATH
. ~/.bashrc

# Clone repository and install dependencies
git clone https://github.com/coracle-social/anchor.git
cd ~/anchor
nvm install
nvm use

# Copy and fill in env variables - this step is required!
cp .env.template .env
cp web/.env.template web/.env

# Next, install dependencies and build the service. We have a script that does this since the
# web front end is its own package. We also modify the package.json files to remove pnpm overrides
# which are used to link dependencies in development.
./build-in-production.sh
```

You can now run anchor using `pnpm run start`.

## System Service

Create a systemd file as `/etc/systemd/system/anchor.service` and fill in the variables:

```conf
[Unit]
Description={DESCRIPTION}
ConditionPathExists={REPOSITORY_PATH}
After=network.target

[Service]
Type=simple
User={USERNAME}
Group={USERNAME}
WorkingDirectory={REPOSITORY_PATH}
ExecStart={FULL_PATH_TO_NODE} {REPOSITORY_PATH}/dist/index.js
Restart=always
RuntimeMaxSec=3600
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=anchor

[Install]
WantedBy=multi-user.target
```

Start the service:

```sh
service anchor start
```

## Nginx/TLS (optional)

If you'd like to set up anchor on a server you control, you'll want to set up a reverse proxy and provision a TSL certificate for the domain you'll be using. You should also make sure to add swap to your server.

First, create an `A` record with your DNS provider pointing to the IP of your server. This will allow certbot to create your certificate later.

Next install `nginx`, `git`, and `certbot`. If you're on a debian- or ubuntu-based distro, run `sudo apt-get update && sudo apt-get install nginx git certbot python3-certbot-nginx`.

Place the following in a file named after your domain in the `/etc/nginx/sites-available` directory, for example, `anchor.example.com`. This should match the `A` record you registered above.

```conf
server {
    listen              80;
    server_name         <SERVER NAME>;

    location / {
        proxy_pass http://127.0.0.1:<PORT>;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }

}
```

Now, enable the site, run certbot, and restart nginx. If you want to be careful, run `nginx -t` before restarting nginx.

```sh
ln -s /etc/nginx/sites-{available,enabled}/<SERVER NAME>
certbot --nginx -d <SERVER NAME>
service nginx restart
```

Now, visit your domain. You should be all set up!

# Usage

```sh
# Fill in the instance's pubkey and url
pubkey=27b7c2ed89ef78322114225ea3ebf5f72c7767c2528d4d0c1854d039c00085df
relay=localhost:4738

# Configure our alert
tags=$(cat <<EOF
[
  ["channel","email"],
  ["cron","0 0 15 * * 2"],
  ["relay","relay.nostrtalk.org"],
  ["filter","{\"kinds\":[11]}"]
]
EOF
)

# Encrypt it
alert_ciphertext="$(nak encrypt -p $pubkey $tags)"

# Publish our alert to the relay
nak event -k 32830 -p $pubkey -t d=my-alert -c $alert_ciphertext $relay

# Request status for all our alerts and decrypt the content
status_ciphertext=$(nak req -k 32831 --auth $relay | jq -r '.content')
status=$(nak decrypt -p $pubkey $status_ciphertext)

echo $status
```
