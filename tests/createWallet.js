const cardano = require('../cardano')

(async () => {
    await cardano.createWallet('example-wallet')
})()