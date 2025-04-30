A nostr notifier service.

# Installation

First, clone the repository:

```sh
git clone https://github.com/coracle-social/anchor.git && cd anchor
```

Next, copy the env file and fill it in:

```sh
cp .env.template .env
```

Next, install dependencies and build the service. We have a script that does this since the web front end is its own package. We also modify the package.json files to remove pnpm overrides which are used to link dependencies in development.

```sh
./build-in-production.sh
```

Next, create a systemd file:

```conf
[Unit]
Description=DOMAIN
ConditionPathExists=RELAY_PATH
After=network.target

[Service]
Type=simple
User=USERNAME
Group=USERNAME
WorkingDirectory=RELAY_PATH
ExecStart=/home/anchor/.nvm/versions/node/v22.15.0/bin/node ANCHOR_PATH/dist/index.js
Restart=always
RuntimeMaxSec=3600
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=NAME

[Install]
WantedBy=multi-user.target
```

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

# TODO

- [ ] Serve deletes
- [ ] Add timezone and locale
- [ ] Use handlers correctly
