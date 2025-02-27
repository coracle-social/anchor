A nostr notifier service.

# Usage

```bash
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
