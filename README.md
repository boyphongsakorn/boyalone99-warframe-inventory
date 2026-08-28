# boyalone99-warframe-inventory

Fastify proxy for the Warframe profile loadout image.

## Run

```sh
pnpm start
```

Open `http://localhost:3000/loadout` to return the image. A different player can
be requested with `?playerId=<id>`.

The upstream profile endpoint must include an image URL in its JSON response. If
Warframe rejects the request or no image is present, the server returns a JSON
error with status `502` or `404` respectively.