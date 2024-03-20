# Cardano Node API

This is a simple API server can be run on a Cardano node to simplify activities like checking balances and transferring multiple different tokens to different wallets in one transaction. 
To get started set the environment variables to point to your node socket and shelly genesis file. Optionally set an API key that has to be included in the request header.

Run ``node index.js`` to start the server.

This project uses a forked version of [cardanocli-js](https://github.com/shareslake/cardanocli-js) that is not maintained and may be outdated.
