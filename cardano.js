require('dotenv').config()
const CardanocliJs = require("cardanocli-js");
const shelleyGenesisPath = process.env.SHELLY_GENESIS_PATH;
const socketPath = process.env.NODE_SOCKET_PATH;
const cardanocliJs = new CardanocliJs({ shelleyGenesisPath, socketPath });
const logging = require('./logging')

/**
 * Queries the current tip from the Cardano node
 * @returns {*}
 */
const queryTip = () => {
    return cardanocliJs.queryTip()
}
exports.queryTip = queryTip;

/**
 * Queries stake address info for a given address
 * @param address Address
 * @returns {*}
 */
const queryStakeAddressInfo = (address) => {
    return cardanocliJs.queryStakeAddressInfo(address)
}
exports.queryStakeAddressInfo = queryStakeAddressInfo;

/**
 * Creates private keys for a new payment address in the directory priv/wallet/<wallet_name>
 * @param account Wallet name
 * @returns {Promise<{paymentAddress: *, addressKeyHash: *}>}
 */
const createWallet = async (account) => {
    try {
        const paymentKeys = cardanocliJs.addressKeyGen(account);
        cardanocliJs.addressBuild(account, {
            "paymentVkey": paymentKeys.vkey
        });

        // Wallet is stored on disk in directory priv/wallet/<wallet_name>
        // Remember to back up the wallets

        logging.info(`Created wallet ${account}`)

        return {
            paymentAddress: cardanocliJs.wallet(account).paymentAddr,
            addressKeyHash: cardanocliJs.addressKeyHash(account)
        };
    } catch (err) {
        console.log(err)
        throw err
    }
};
exports.createWallet = createWallet;


/**
 * Creates private keys for a new payment address including stake key in the directory priv/wallet/<wallet_name>
 * @param account Wallet name
 * @returns {Promise<{paymentAddress: *, addressKeyHash: *}>}
 */
const createWalletWithStakeKey = async (account) => {
    const payment = cardanocliJs.addressKeyGen(account);
    const stake = cardanocliJs.stakeAddressKeyGen(account);
    cardanocliJs.stakeAddressBuild(account);
    cardanocliJs.addressBuild(account, {
        paymentVkey: payment.vkey,
        stakeVkey: stake.vkey,
    });

    logging.info(`Created wallet ${account} with stake key`)

    return {
        paymentAddress: cardanocliJs.wallet(account).paymentAddr,
        addressKeyHash: cardanocliJs.addressKeyHash(account)
    };
};
exports.createWalletWithStakeKey = createWalletWithStakeKey;

/**
 * Create a mint script for a given address key hash and policy lock slot (optional)
 * @param addressKeyHash Address key hash
 * @param policyLockSlot Optional policy lock slot
 * @returns {{type: string, scripts: [{keyHash, type: string},{slot: number, type: string}]}|{keyHash, type: string}}
 */
const mintScript = (addressKeyHash, policyLockSlot) => {
    if (policyLockSlot == null || policyLockSlot === -1 || policyLockSlot === '-1') {
        return {
            "keyHash": addressKeyHash,
            "type": "sig"
        }
    } else {
        return {
            "type": "all",
            "scripts": [
                {
                    "keyHash": addressKeyHash,
                    "type": "sig"
                },
                {
                    "slot": parseInt(policyLockSlot),
                    "type": "before"
                }
            ]
        }
    }
}
exports.mintScript = mintScript;

/**
 * Returns the policy id for a given mint script
 * @param mintScript Mint script
 * @returns {*}
 */
const transactionPolicyid = (mintScript) => {
    return cardanocliJs.transactionPolicyid(mintScript)
}
exports.transactionPolicyid = transactionPolicyid;

/**
 * Burns a token inside a wallet
 * @param paymentWalletName Name of the wallet that holds the token
 * @param policyWalletName Name of the policy wallet
 * @param burnObjects Objects to burn in format {policyId.assetId: quantity}
 * @param mintScript The mint script of the policy
 * @param inputTransactions Optional array of input transactions
 * @param inputTransactionsValue
 * @param revenueAddress
 * @returns {{success: boolean, error: string}|{success: boolean, transactionId: *}}
 */
const burnTokens = (paymentWalletName, policyWalletName, burnObjects, mintScript, inputTransactions, inputTransactionsValue, revenueAddress) => {
    try {
        const paymentWallet = cardanocliJs.wallet(paymentWalletName)
        const paymentWalletBalance = paymentWallet.balance()
        const policyWallet = cardanocliJs.wallet(policyWalletName)


        // Bundle transaction inputs
        let txIn = []
        if (inputTransactions != null) {
            for (const input of paymentWalletBalance.utxo) {
                if (inputTransactions.includes(input.txHash)) {
                    txIn.push(input)
                }
            }
        } else {
            txIn = paymentWalletBalance.utxo
        }

        let payoutAddress = paymentWallet.paymentAddr
        if (revenueAddress != null) {
            payoutAddress = revenueAddress
        }
        let payoutLovelace = paymentWalletBalance.value.lovelace
        if (inputTransactionsValue != null) {
            payoutLovelace = inputTransactionsValue
        }

        const tx = {
            txIn: txIn,
            txOut: [
                {
                    address: payoutAddress,
                    value: {
                        lovelace: payoutLovelace,
                    },
                },
            ],
            mint: [],
            witnessCount: 2,
        };

        for (const [key, value] of Object.entries(burnObjects)) {
            tx.mint.push({action: "mint", quantity: -value, asset: key, script: mintScript})
        }

        for (const [key] of Object.entries(burnObjects)) {
            delete tx.txOut[0].value[key]
        }

        // Build raw transaction to calculate fees
        let buildRaw = cardanocliJs.transactionBuildRaw(tx);
        let fee = cardanocliJs.transactionCalculateMinFee({
            ...tx,
            txBody: buildRaw,
        });
        tx.txOut[0].value.lovelace -= fee;

        // Check for policy lock slot
        let invalidAfter;
        if (mintScript.scripts != null) {
            for (const script of mintScript.scripts) {
                if (script.slot != null) {
                    invalidAfter = script.slot
                }
            }
        }

        // Build final raw transaction with correct fees
        let raw
        if (invalidAfter != null) {
            raw = cardanocliJs.transactionBuildRaw({ ...tx, fee, invalidAfter });
        } else {
            raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });
        }

        // Sign the transaction
        const signed = cardanocliJs.transactionSign({
            signingKeys: [paymentWallet.payment.skey, policyWallet.payment.skey],
            txBody: raw,
        });

        const transaction = cardanocliJs.transactionSubmit(signed)
        logging.info('Burning assets in transaction '+transaction)
        return {
            success: true,
            transactionId: transaction,
        }

    } catch(e) {
        logging.error(e)
        console.log(e)
        return {
            success: false,
            error: e.toString()
        }
    }
};
exports.burnTokens = burnTokens;

/**
 * Transfers a token with a given amount to an address
 * @param account Wallet name
 * @param address Recipient Address
 * @param TOKEN PolicyId.AssetId
 * @param amount Amount to transfer
 * @returns {{success: boolean, transaction: *}}
 */
const transferToken = (account, address, TOKEN, amount) => {
    const wallet = cardanocliJs.wallet(account)
    const walletBalance = wallet.balance()

    const tx = {
        txIn: walletBalance.utxo,
        txOut: [
            {
                address: wallet.paymentAddr,
                value: {
                    lovelace: walletBalance.value.lovelace
                },
            },
            {
                address: address,
                value: {
                    lovelace: 1_500_000
                }
            }
        ],
        witnessCount: 1
    };

    // Bundle native tokens into a single value
    for (const utxo of walletBalance.utxo) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[0].value[key] = value;
                } else {
                    tx.txOut[0].value[key] = amount+value;
                }
            }
        }
    }

    // Token transfer
    tx.txOut[0].value[TOKEN] = tx.txOut[0].value[TOKEN]-amount
    if (tx.txOut[0].value[TOKEN] === 0) {
        delete tx.txOut[0].value[TOKEN]
    }
    tx.txOut[1].value[TOKEN] = amount

    // Calculate min ADA value
    let minValue = cardanocliJs.transactionCalculateMinRequiredUtxo(address, tx.txOut[1].value)
    tx.txOut[0].value.lovelace = walletBalance.value.lovelace
    tx.txOut[0].value.lovelace -= minValue
    tx.txOut[1].value.lovelace = 0
    tx.txOut[1].value.lovelace += minValue

    // Bild raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    tx.txOut[0].value.lovelace -= fee;

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey, wallet.payment.skey],
        txBody: raw,
    });

    const transaction = cardanocliJs.transactionSubmit(signed)

    logging.info(`Sending token from wallet ${account} in transaction ${transaction}`)

    return {
        success: true,
        transaction: transaction,
    }
}
exports.transferToken = transferToken;

/**
 * Transfers all native tokens inside the wallet to a single address
 * @param account Wallet Name
 * @param address Recipient Address
 * @returns {string}
 */
const transferAllNativeTokens = (account, address) => {
    const wallet = cardanocliJs.wallet(account)
    const walletBalance = wallet.balance()

    const tx = {
        txIn: walletBalance.utxo,
        txOut: [
            {
                address: wallet.paymentAddr,
                value: {
                    lovelace: walletBalance.value.lovelace
                },
            },
            {
                address: address,
                value: {
                    lovelace: 1_500_000
                }
            }
        ],
        witnessCount: 1
    };

    // Bundle native tokens into a single value
    for (const utxo of walletBalance.utxo) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[1].value[key] = value;
                } else {
                    tx.txOut[1].value[key] = amount+value;
                }
            }
        }
    }

    // Calculate min ADA value
    let minValue = cardanocliJs.transactionCalculateMinRequiredUtxo(address, tx.txOut[1].value)
    tx.txOut[0].value.lovelace = walletBalance.value.lovelace
    tx.txOut[0].value.lovelace -= minValue
    tx.txOut[1].value.lovelace = 0
    tx.txOut[1].value.lovelace += minValue

    // Bild raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    tx.txOut[0].value.lovelace -= fee;

    //console.log(tx.txOut);

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey, wallet.payment.skey],
        txBody: raw,
    });

    logging.info(`Sending all native tokens of wallet ${account}`)

    return cardanocliJs.transactionSubmit(signed)
}
exports.transferAllNativeTokens = transferAllNativeTokens;

/**
 * Wipes the whole wallet by sending all assets
 * @param account Wallet Name
 * @param address Recipient Address
 * @returns {{success: boolean, transaction: string}}
 */
const wipeWallet = (account, address) => {
    const wallet = cardanocliJs.wallet(account)
    const walletBalance = wallet.balance()

    const tx = {
        txIn: walletBalance.utxo,
        txOut: [
            {
                address: address,
                value: {
                    lovelace: walletBalance.value.lovelace
                }
            }
        ],
        witnessCount: 1
    };

    // Bundle native tokens into a single value
    for (const utxo of walletBalance.utxo) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[0].value[key] = value;
                } else {
                    tx.txOut[0].value[key] = amount+value;
                }
            }
        }
    }

    // Bild raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    tx.txOut[0].value.lovelace = walletBalance.value.lovelace-fee;

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey, wallet.payment.skey],
        txBody: raw,
    });

    const transaction = cardanocliJs.transactionSubmit(signed)


    logging.info(`Wiping wallet ${account} in transaction ${transaction}`)

    return {
        success: true,
        transaction: transaction,
    }
}
exports.wipeWallet = wipeWallet;

/**
 * Refunds a transaction
 * @param account Wallet name
 * @param transactionHash Hash of the transaction to be refunded
 * @param address Address of the recipient
 * @param message Optional tx message
 * @returns {{success: boolean, transaction: *}}
 */
const refundTransaction = (account, transactionHash, address, message) => {
    const wallet = cardanocliJs.wallet(account)

    let txIn = []
    let totalTransactionValue = 0
    for (const input of wallet.balance().utxo) {
        if (transactionHash === input.txHash) {
            totalTransactionValue += parseInt(input.value.lovelace)
            txIn.push(input)
        }
    }

    // Build transaction
    let tx = {
        txIn: txIn,
        txOut: [
            {
                address: address,
                value: {
                    lovelace: totalTransactionValue
                },
            }
        ],
        witnessCount: 1,
    };

    for (const utxo of txIn) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[0].value[key] = value;
                } else {
                    tx.txOut[0].value[key] = amount+value;
                }
            }
        }
    }

    // Set optional message as metadata
    if (message != null) {
        tx.metadata = {"674": { "msg": [message]}}
    }

    // Bild raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    tx.txOut[0].value.lovelace -= fee;

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey, wallet.payment.skey],
        txBody: raw,
    });

    const transaction = cardanocliJs.transactionSubmit(signed)

    logging.info(`Refunding transaction ${transactionHash} for wallet ${account} in transaction ${transaction}`)

    return {
        success: true,
        transaction: transaction,
    }
}
exports.refundTransaction = refundTransaction;

/**
 * Transfers Lovelace from a wallet to a single address
 * @param account Wallet Name
 * @param address Recipient Address
 * @param amount Amount in ADA
 * @param message Optional transaction message
 * @param minusTxFee If true, the transaction fee will be deducted from the sending amount
 * @param inputTxHash Optional input transaction to use for the transfer
 * @returns {{success: boolean, transaction: string}}
 */
const transferLovelace = (account, address, amount, message, minusTxFee, inputTxHash) => {
    const wallet = cardanocliJs.wallet(account)
    const walletBalance = wallet.balance()

    let tx = {
        txIn: walletBalance.utxo,
        txOut: [
            {
                address: wallet.paymentAddr,
                value: {
                    lovelace: walletBalance.value.lovelace - amount
                },
            },
            {
                address: address,
                value: {
                    lovelace: amount
                }
            }
        ],
        witnessCount: 1
    };

    // Check if a single input tx should be used
    if (inputTxHash != null) {
        let inputTx = walletBalance.utxo.find(e => e.txHash === inputTxHash)
        if (inputTx != null) {
            tx = {
                txIn: [inputTx],
                txOut: [
                    {
                        address: wallet.paymentAddr,
                        value: {
                            lovelace: inputTx.value.lovelace - amount
                        },
                    },
                    {
                        address: address,
                        value: {
                            lovelace: amount
                        }
                    }
                ],
                witnessCount: 1
            };
        } else {
            logging.error('Could not find specified transaction input hash '+inputTxHash)
            return {
                success: false,
                error: 'Could not find specified transaction input hash '+inputTxHash,
            }
        }
    }

    // Set optional message as metadata
    if (message != null) {
        tx.metadata = {"674": { "msg": [message]}}
    }

    // Bundle native tokens into a single value
    for (const utxo of walletBalance.utxo) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[0].value[key] = value;
                } else {
                    tx.txOut[0].value[key] = amount+value;
                }
            }
        }
    }

    // Bild raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    if (minusTxFee === true) {
        tx.txOut[1].value.lovelace -= fee;
    } else {
        tx.txOut[0].value.lovelace -= fee;
    }

    // Remove first input if value is zero
    if (tx.txOut[0].value.lovelace <= 0) {
        tx.txOut.shift();
    }

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey, wallet.payment.skey],
        txBody: raw,
    });

    const transaction = cardanocliJs.transactionSubmit(signed)

    logging.info(`Sending lovelace from wallet ${account} in transaction ${transaction}`)

    return {
        success: true,
        transaction: transaction,
    }
}
exports.transferLovelace = transferLovelace;

/**
 * Transfers ADA from a wallet to a single address
 * @param account Wallet Name
 * @param address Recipient Address
 * @param amount Amount in ADA
 * @param message Optional transaction message
 * @returns {{success: boolean, transaction: string}}
 */
const transferADA = (account, address, amount, message) => {
    return transferLovelace(account, address, amount*1000000, message)
}
exports.transferADA = transferADA;

/**
 * Transfers amounts of a fungible token with a single asset id to multiple recipients
 * @param account Wallet Name
 * @param TOKEN Asset ID of the tokens to send
 * @param recipients Recipients Dictionary in the format {address: quantity}
 * @param recipientsLovelace Dictionary describing how many lovelace should be sent to the recipient in the format {address: quantity}
 * @param message Optional transaction message
 * @returns {{success: boolean, transaction: string}}
 */
const transferTokensToRecipients = (account, TOKEN, recipients, recipientsLovelace, message) => {
    const wallet = cardanocliJs.wallet(account)
    const walletBalance = wallet.balance()

    const tx = {
        txIn: walletBalance.utxo,
        txOut: [
            {
                address: wallet.paymentAddr,
                value: {
                    lovelace: walletBalance.value.lovelace
                },
            }
        ],
        witnessCount: 1
    };

    // Bundle native tokens into a single value
    for (const utxo of walletBalance.utxo) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[0].value[key] = value;
                } else {
                    tx.txOut[0].value[key] = amount+value;
                }
            }
        }
    }

    // Token transfer
    for (const [address, amount] of Object.entries(recipients)) {
        let minValue
        if (recipientsLovelace != null && recipientsLovelace[address] != null && recipientsLovelace[address] !== 0) {
            minValue = recipientsLovelace[address]
        } else {
            minValue = cardanocliJs.transactionCalculateMinRequiredUtxo(address, {
                lovelace: 1_500_000,
                [TOKEN]: amount
            })
        }
        tx.txOut[0].value[TOKEN] -= amount
        tx.txOut[0].value.lovelace -= minValue
        tx.txOut.push({
            address: address,
            value: {
                lovelace: minValue,
                [TOKEN]: amount
            }
        })
    }

    if (tx.txOut[0].value[TOKEN] === 0) {
        delete tx.txOut[0].value[TOKEN]
    }

    // Set optional message as metadata
    if (message != null) {
        if (message.length > 64) {
            tx.metadata = {"674": { "msg": chunkString(message)}}
        } else {
            tx.metadata = {"674": { "msg": [message]}}
        }
    }

    // Build raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    tx.txOut[0].value.lovelace -= fee;

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey],
        txBody: raw,
    });

    const transaction = cardanocliJs.transactionSubmit(signed)

    logging.info(`Sending tokens from wallet ${account} in transaction ${transaction}`)

    return {
        success: true,
        transaction: transaction,
        networkFee: fee,
    }
}
exports.transferTokensToRecipients = transferTokensToRecipients;

/**
 * Transfers multiple different assets to multiple recipients
 * @param account Wallet Name
 * @param recipients Recipients Dictionary in the format {address: {policyId.assetId: quantity}}
 * @param message Optional transaction message
 * @returns {{success: boolean, transaction: string}}
 */
const transferMultipleAssetsToRecipients = (account, recipients, inputTransactions, message) => {
    const wallet = cardanocliJs.wallet(account)
    const walletBalance = wallet.balance()

    // Bundle transaction inputs
    let txIn = []
    let inputTxValue = 0
    if (inputTransactions != null) {
        for (const input of walletBalance.utxo) {
            if (inputTransactions.includes(input.txHash)) {
                txIn.push(input)
                inputTxValue += input.value.lovelace
            } else if (Object.keys(input.value).length > 1) {
                // Always include tx inputs with tokens
                txIn.push(input)
                inputTxValue += input.value.lovelace
            }
        }
    } else {
        inputTxValue = walletBalance.value.lovelace
        txIn = walletBalance.utxo
    }

    const tx = {
        txIn: txIn,
        txOut: [
            {
                address: wallet.paymentAddr,
                value: {
                    lovelace: inputTxValue
                },
            }
        ],
        witnessCount: 1
    };

    // Bundle native tokens into a single value
    for (const utxo of walletBalance.utxo) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[0].value[key] = value;
                } else {
                    tx.txOut[0].value[key] = amount+value;
                }
            }
        }
    }

    // Token transfer
    for (const [address, assets] of Object.entries(recipients)) {
        let value = {
            lovelace: 1_500_000,
        }
        let customLovelace = undefined
        for (const [assetId, quantity] of Object.entries(assets)) {
            if (assetId === 'lovelace') {
                customLovelace = quantity
                continue
            }
            value[assetId] = quantity
            tx.txOut[0].value[assetId] -= quantity
            if (tx.txOut[0].value[assetId] === 0) {
                delete tx.txOut[0].value[assetId]
            }
        }
        let lovelace
        if (customLovelace != null) {
            lovelace = customLovelace
        } else {
            lovelace = cardanocliJs.transactionCalculateMinRequiredUtxo(address, value)
        }
        tx.txOut[0].value.lovelace -= lovelace
        tx.txOut.push({
            address: address,
            value: {
                ...value,
                lovelace: lovelace
            }
        })
    }

    // Set optional message as metadata
    if (message != null) {
        if (message.length > 64) {
            tx.metadata = {"674": { "msg": chunkString(message)}}
        } else {
            tx.metadata = {"674": { "msg": [message]}}
        }
    }

    // Build raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    tx.txOut[0].value.lovelace -= fee;

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey],
        txBody: raw,
    });

    const transaction = cardanocliJs.transactionSubmit(signed)

    logging.info(`Sending multiple tokens from wallet ${account} in transaction ${transaction}`)

    return {
        success: true,
        transaction: transaction,
    }
}
exports.transferMultipleAssetsToRecipients = transferMultipleAssetsToRecipients;


/**
 * Transfers random assets in the wallet to recipients (1 asset each)
 * @param account Wallet Name
 * @param recipients Recipients Array in the format {address: quantity}
 * @param message Optional transaction message
 * @returns {{success: boolean, transaction: string}}
 */
const transferRandomWalletAssetsToRecipients = (account, recipients, message) => {
    const wallet = cardanocliJs.wallet(account)
    const walletBalance = wallet.balance()

    const tx = {
        txIn: walletBalance.utxo,
        txOut: [
            {
                address: wallet.paymentAddr,
                value: {
                    lovelace: walletBalance.value.lovelace
                },
            }
        ],
        witnessCount: 1
    };

    // Bundle native tokens into a single value
    for (const utxo of walletBalance.utxo) {
        for (const [key, value] of Object.entries(utxo.value)) {
            if (key !== 'lovelace') {
                const amount = tx.txOut[0].value[key]
                if (amount == null) {
                    tx.txOut[0].value[key] = value;
                } else {
                    tx.txOut[0].value[key] = amount+value;
                }
            }
        }
    }

    // Token transfer
    for (const [address, amount] of Object.entries(recipients)) {
        let assetIds = []

        for (let i = 0; i < amount; i++) {
            const rndInt = Math.floor(Math.random() * (Object.keys(tx.txOut[0].value).length-1)) + 1
            const assetId = Object.keys(tx.txOut[0].value)[rndInt]
            tx.txOut[0].value[assetId] -= 1
            if (tx.txOut[0].value[assetId] === 0) {
                delete tx.txOut[0].value[assetId]
            }
            assetIds.push(assetId)
        }

        let value = {
            lovelace: 1_500_000,
        }
        for (const assetId of assetIds) {
            value[assetId] = 1
        }
        let minValue = cardanocliJs.transactionCalculateMinRequiredUtxo(address, value)
        tx.txOut[0].value.lovelace -= minValue
        tx.txOut.push({
            address: address,
            value: {
                ...value,
                lovelace: minValue
            }
        })
    }

    // Set optional message as metadata
    if (message != null) {
        if (message.length > 64) {
            tx.metadata = {"674": { "msg": chunkString(message)}}
        } else {
            tx.metadata = {"674": { "msg": [message]}}
        }
    }

    // Build raw transaction to calculate fees
    let buildRaw = cardanocliJs.transactionBuildRaw(tx);
    let fee = cardanocliJs.transactionCalculateMinFee({
        ...tx,
        txBody: buildRaw,
    });
    tx.txOut[0].value.lovelace -= fee;

    // Build final raw transaction with correct fees
    const raw = cardanocliJs.transactionBuildRaw({ ...tx, fee });

    // Sign the transaction
    const signed = cardanocliJs.transactionSign({
        signingKeys: [wallet.payment.skey],
        txBody: raw,
    });

    const transaction = cardanocliJs.transactionSubmit(signed)

    logging.info(`Sending random tokens from wallet ${account} in transaction ${transaction}`)

    return {
        success: true,
        transaction: transaction,
    }
}
exports.transferRandomWalletAssetsToRecipients = transferRandomWalletAssetsToRecipients;

/**
 * Returns te balance for given wallet name
 * @param account
 * @returns {{utxo: *, value: {}}}
 */
const walletBalance = (account) => {
    const wallet = cardanocliJs.wallet(account)
    return wallet.balance()
}
exports.walletBalance = walletBalance;

/**
 * Queries the UTXO for a given address
 * @param address Address
 * @returns {*}
 */
const queryUtxo = (address) => {
    return cardanocliJs.queryUtxo(address)
}
exports.queryUtxo = queryUtxo;

/**
 * This function splits a string an any array of strings with a max length of 64. If possible words are not broken.
 * @param string Input String
 * @returns {*[]}
 */
function chunkString(string) {
    let result = []
    let chunk = ''
    const elements = string.split(' ')
    for (const element of elements) {
        if (element.length > 64) {
            let innerElements = element.match(new RegExp('.{1,' + 64 + '}', 'g'));
            for (const innerElement of innerElements) {
                if (chunk.length + innerElement.length <= 64) {
                    chunk += innerElement + ' '
                } else {
                    result.push(chunk.slice(0,-1))
                    chunk = innerElement + ' '
                }
            }
        } else {
            if (chunk.length + element.length <= 64) {
                chunk += element + ' '
            } else {
                result.push(chunk.slice(0,-1))
                chunk = element + ' '
            }
        }
    }
    result.push(chunk.slice(0,-1))
    return result
}
