require("dotenv").config();
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const constants = require("./config/constants");
const { Secp256k1HdWallet
} = require("@cosmjs/amino");
const {
    SigningStargateClient,
    GasPrice
} = require("@cosmjs/stargate");
const {
    stringToPath
} = require("@cosmjs/crypto");
const restAPI = process.env.BLOCKCHAIN_REST_SERVER;
const rpc = process.env.RPC;
const mnemonic = process.env.FAUCET_MNEMONIC;
const valMnemonic = process.env.VALIDATOR_MNEMONIC;
const msgSendTypeUrl = "/cosmos.bank.v1beta1.MsgMultiSend";
const {
    MsgMultiSend,
    fromPartial
} = require("cosmjs-types/cosmos/bank/v1beta1/tx");
const Long = require("long")
const { broadcast, getSender, signTransaction } = require("@hanchon/evmos-ts-wallet")
const { ethToEthermint } = require('@tharsis/address-converter')
const { createMessageSend } = require("@tharsis/transactions")
const { Wallet } = require("@ethersproject/wallet")



/*
    Redis Connection
    Default no credential to local host
 */
const redis = require('ioredis')
const client = redis.createClient({
    port: process.env.REDIS_PORT || 6379,
    host: process.env.REDIS_HOST || 'localhost',
})
client.on('connect', function() {
    console.log('connected');
});


/*
    Remove whitespaces from string
 */
function trimWhiteSpaces(data) {
    return data.split(' ').join('');
}

/*
    Compose message
 */
function msg(inputs, outputs) {
    return {
        typeUrl: msgSendTypeUrl,
        value: MsgMultiSend.fromPartial({
            inputs: [{
                address: trimWhiteSpaces(inputs), //fromAddress
                coins: [{
                    denom: constants.DENOM,
                    amount: (outputs.length * parseInt(constants.AMOUNT)).toString(),
                }, ],
            }, ],
            outputs: outputs, //toAddress
        }),
    }
}


/*
    Sign and broadcast message
 */
async function signAndBroadcast(wallet) {
    const localnetChain = {
        chainId: 69420,
        cosmosChainId: "opti_69420-1"
    }
    const localnetFee = {
        amount: "1000",
        denom: "aphoton",
        gas: "200000"
    }

    const sender = await getSender(wallet, "http://localhost:1318")
    const txSimple = createMessageSend(
        localnetChain,
        sender,
        localnetFee,
        '',
        {
            destinationAddress: 'ethm1ft8d54035h04zvftqwv6vswnp8rzyc3hly4qpw',
            amount: '10000',
            denom: 'aphoton',
        },
    )
    const resKeplr = await signTransaction(wallet, txSimple, 'BROADCAST_MODE_SYNC')
    const broadcastRes = await broadcast(resKeplr, "http://localhost:1318")
    console.log(broadcastRes)
    return broadcastRes
}

async function processTransaction(wallet,msgs){
    try {
        let faucetQueue
        faucetQueue = await getFaucetQueue();
        const response = await signAndBroadcast(wallet);
        // const response = await signAndBroadcast(
        //     wallet,
        //     addr,
        //     [msgs], {
        //         "amount": [{
        //             amount: (parseInt(constants.gas) * GasPrice.fromString(constants.gas_price).amount).toString(),
        //             denom: constants.DENOM
        //         }],
        //         "gas": constants.gas
        //     },
        //     "Thanks for using Osmosis Faucet"
        // );
        faucetQueue.forEach(function(address) {
            removeFromQueue(address)
        })
    } catch (err) {
        console.error('Unable to process transaction')
        throw err
    }
}

async function validateAccount(userAddress){
    let xmlHttp = new XMLHttpRequest();
    xmlHttp.open("GET", restAPI + "/cosmos/auth/v1beta1/accounts/" + userAddress, false); // false for synchronous request
    xmlHttp.send(null);
    const accountResponse = JSON.parse(xmlHttp.responseText);
    console.log("Account Validation Response")
    console.log(accountResponse)
    return accountResponse
}

async function getFaucetQueue() {
    let faucetQueue
    try {
        faucetQueue = await client.lrange('faucetQueue',0, -1)
        console.log("Getting Faucet Queue")
        console.log(faucetQueue);
        return faucetQueue
    } catch (err) {
        console.error('Unable to get queue')
        throw err
    }
}

async function addToQueue(userAddress){
    let addQueue
    try {
        addQueue = await client.lpush(['faucetQueue',userAddress])
        console.log(userAddress, "ADDED TO LIST Count:",+addQueue);
    } catch (err) {
        console.error('addQueue: could not increment key')
        throw err
    }
}

async function removeFromQueue(address) {
    console.log("Removing address"+address)
    let removeFromQueue
    try {
        removeFromQueue = await client.lrem('faucetQueue',-1,address)
    console.log("removeFromQueue")
    console.log(removeFromQueue);
} catch (err) {
        console.error('isOverLimit: could not increment key')
        throw err
    }

}

function runner() {
    setInterval(async function() {

/*
Faucet Queue
*/
let faucetQueue
faucetQueue = await getFaucetQueue();
        if (faucetQueue.length > 0) {
            try {
                let wallet = await Wallet.fromMnemonic(mnemonic)
                let outputs = [];
                faucetQueue.forEach(receiver => outputs.push({
                    address: trimWhiteSpaces(receiver),
                    coins: [{
                        denom: constants.DENOM,
                        amount: constants.AMOUNT,
                    }, ],
                }));
                console.log("wallet: ", wallet)
                addr = ethToEthermint(wallet.address)
                console.log("ethermint address: ", addr)
                const msgs = msg(addr, outputs);
                await processTransaction(wallet,addr,msgs)

            } catch (e) {
                console.log("Transaction Failed: ", e);
            }
        } else {
            console.log("No Accounts to faucet");
            console.log(constants.faucetQueue);
        }
    }, 7000);
}

function secondsToHms(d) {
    d = Number(d);
    let h = Math.floor(d / 3600);
    let m = Math.floor(d % 3600 / 60);
    let s = Math.floor(d % 3600 % 60);

    let hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours ") : "";
    let mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes ") : "";
    let sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
    return hDisplay + mDisplay + sDisplay;
}

async function handleFaucetRequest(req) {
    let userAddress = req.body.address
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress

    try {
        let ipCount
        try {
            ipCount = await client.incr(ip)
        } catch (err) {
            console.error('ipCount: could not increment key')
            throw err
        }
        console.log(`${ip} has value: ${ipCount}`)

        if (ipCount > constants.MAX_PER_IP) {
            console.log("Ip is over limits")
            client.expire(ip, constants.TIME_LIMIT)
            return JSON.stringify({
                status: "error",
                message: "You have requested " + ipCount + " times. The limit  " + constants.MAX_PER_IP + " per " + secondsToHms(constants.TIME_LIMIT) + ""
            });
        } else {
            let accountResponse
            accountResponse = await validateAccount(userAddress);

            // If we get any code then report it, except 5 which means no account exist which is fine to send to a new account.
            if (accountResponse.code && accountResponse.code !== 5) {
                return JSON.stringify({
                    status: "error",
                    message: accountResponse.message
                });
            }else if (ipCount < constants.MAX_PER_IP) {
                let [wallet, addr] = await MnemonicWalletWithPassphrase(mnemonic);
                await addToQueue(userAddress);
                return JSON.stringify({
                    status: "success",
                    message: "Success, your address "+userAddress+" will receive funds shortly from "+addr+""
                });
            } else {
                console.log("error")
                console.log(accountResponse);
                return JSON.stringify({status: "error", message: "Your account cannot get funds at this time. "
                });
            }
        }
    } catch (e) {
        console.log(e);
        return JSON.stringify({
            status: "error",
            message: e.toString()
        });
    }

}

async function getQueue() {
    let getQueue
    getQueue = await getFaucetQueue();
    console.log(getQueue)
    return getQueue;
}

module.exports = {runner, handleFaucetRequest,processTransaction,getQueue};
