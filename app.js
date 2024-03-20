require('dotenv').config()
const express = require('express');
const cardano = require('./cardano')
const logging = require('./logging')
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(function (req, res, next) {
    if (process.env.API_KEY === "" || req.headers['secret'] === process.env.API_KEY) {
        next()
    } else {
        res.sendStatus(403);
    }
})

app.post('/api/status', function (req, res) {
    const tip = cardano.queryTip()
    res.send(tip);
})

app.post('/api/queryUtxo', function (req, res) {
    try {
        if (req.query.address == null) {
            res.json({success: false});
        } else {
            const utxo = cardano.queryUtxo(req.query.address)
            res.json({success: true, utxo: utxo});
        }
    } catch(e) {
        res.json({success: false, error: e});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/wallet/create', async function (req, res) {
    try {
        if (req.query.name == null) {
            res.json({success: false});
        } else {
            const wallet = await cardano.createWallet(req.query.name);
            // Check if mint script should be created too
            if (req.query.policyLockSlot != null) {
                const mintScript = cardano.mintScript(wallet.addressKeyHash, req.query.policyLockSlot);
                const policyId = cardano.transactionPolicyid(mintScript)
                res.json({success: true, address: wallet.paymentAddress, mintScript: mintScript, policyId: policyId});
            } else {
                res.json({success: true, address: wallet.paymentAddress});
            }
        }
    } catch(e) {
        res.json({success: false, error: e});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/wallet/balance', async function (req, res) {
    try {
        if (req.query.name == null) {
            res.json({success: false});
        } else {
            const balance = cardano.walletBalance(req.query.name);
            res.json({success: true, balance: balance});
        }
    } catch(e) {
        res.json({success: false, error: e});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/burn', async function (req, res) {
    try {
        if (req.body.paymentWalletName == null || req.body.policyWalletName == null || req.body.mintScript == null || req.body.burnObjects == null) {
            res.json({success: false, error: 'Invalid Request'});
        } else {
            const response = cardano.burnTokens(req.body.paymentWalletName, req.body.policyWalletName, req.body.burnObjects, req.body.mintScript, req.body.inputTransactions, req.body.inputTransactionsValue, req.body.revenueAddress)
            res.json(response);
        }
    } catch(e) {
        res.json({success: false, error: e.toString()});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/transfer/lovelace', async function (req, res) {
    try {
        if (req.body.wallet == null || req.body.address == null || req.body.amount == null) {
            res.json({success: false, error: 'Invalid Request'});
        } else {
            const response = cardano.transferLovelace(req.body.wallet, req.body.address, req.body.amount, req.body.message, req.body.minusTxFee, req.body.inputTx)
            res.json(response);
        }
    } catch(e) {
        res.json({success: false, error: e});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/transfer/tokensToRecipients', async function (req, res) {
    try {
        if (req.body.wallet == null || req.body.recipients == null || req.body.assetId == null) {
            res.json({success: false, error: 'Invalid Request'});
        } else {
            const response = cardano.transferTokensToRecipients(req.body.wallet, req.body.assetId, req.body.recipients, req.body.recipientsLovelace, req.body.message)
            res.json(response);
        }
    } catch(e) {
        res.json({success: false, error: e.toString()});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/transfer/wipeWallet', async function (req, res) {
    try {
        if (req.body.wallet == null || req.body.address == null) {
            res.json({success: false, error: 'Invalid Request'});
        } else {
            const response = cardano.wipeWallet(req.body.wallet, req.body.address)
            res.json(response);
        }
    } catch(e) {
        res.json({success: false, error: e.toString()});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/refund', async function (req, res) {
    try {
        if (req.body.wallet == null || req.body.transactionHash == null || req.body.address == null) {
            res.json({success: false, error: 'Invalid Request'});
        } else {
            const response = cardano.refundTransaction(req.body.wallet, req.body.transactionHash, req.body.address, req.body.message)
            res.json(response);
        }
    } catch(e) {
        res.json({success: false, error: e.toString()});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/transfer/randomWalletAssetsToRecipients', async function (req, res) {
    try {
        if (req.body.wallet == null || req.body.recipients == null) {
            res.json({success: false, error: 'Invalid Request'});
        } else {
            const response = cardano.transferRandomWalletAssetsToRecipients(req.body.wallet, req.body.recipients, req.body.message)
            res.json(response);
        }
    } catch(e) {
        res.json({success: false, error: e.toString()});
        logging.error(e)
        console.log(e)
    }
})

app.post('/api/transfer/multipleAssetsToRecipients', async function (req, res) {
    try {
        if (req.body.wallet == null || req.body.recipients == null) {
            res.json({success: false, error: 'Invalid Request'});
        } else {
            const response = cardano.transferMultipleAssetsToRecipients(req.body.wallet, req.body.recipients, req.body.inputTransactions, req.body.message)
            res.json(response);
        }
    } catch(e) {
        res.json({success: false, error: e.toString()});
        logging.error(e)
        console.log(e)
    }
})

const run = async () => {
    // Create mandatory folders
    if (fs.existsSync(`priv/`) === false) {
        await fs.promises.mkdir(`priv`)
        await fs.promises.mkdir(`priv/wallet`)
    }
    if (fs.existsSync(`logs/`) === false) {
        await fs.promises.mkdir(`logs`)
    }
    // Listen on port 3001
    await app.listen(3001)
    logging.info('Listening on port 3001...')
}
run().then().catch(console.log)

