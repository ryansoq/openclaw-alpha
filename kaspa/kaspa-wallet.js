// Kaspa Testnet-12 Web Wallet
// BIP-39 mnemonic + BIP-32 key derivation
// Pure browser-based, no private keys leave the client

// ============================================================
// Crypto helpers - secp256k1 (Schnorr) + Kaspa address encoding
// ============================================================

let secp;
const NETWORK_PREFIX = 'kaspatest';

// BIP-39 / BIP-32 modules
let bip39, bip32, hmacMod, sha512Mod;

async function loadSecp256k1() {
    const mod = await import('https://esm.sh/@noble/secp256k1@2.1.0');
    secp = mod;
    const hashes = await import('https://esm.sh/@noble/hashes@1.6.1/sha256');
    const utils = await import('https://esm.sh/@noble/hashes@1.6.1/utils');
    return { secp: mod, sha256: hashes.sha256, bytesToHex: utils.bytesToHex, hexToBytes: utils.hexToBytes };
}

async function loadBip39Bip32() {
    // Load scure-bip39 and scure-bip32 (from same author as noble-secp256k1)
    const [bip39Mod, bip32Mod, wordlistMod, hmac, sha512] = await Promise.all([
        import('https://esm.sh/@scure/bip39@1.4.0'),
        import('https://esm.sh/@scure/bip32@1.5.0'),
        import('https://esm.sh/@scure/bip39@1.4.0/wordlists/english'),
        import('https://esm.sh/@noble/hashes@1.6.1/hmac'),
        import('https://esm.sh/@noble/hashes@1.6.1/sha512'),
    ]);
    bip39 = { ...bip39Mod, wordlist: wordlistMod.wordlist };
    bip32 = bip32Mod;
    hmacMod = hmac;
    sha512Mod = sha512;
}

let cryptoLib;

async function init() {
    cryptoLib = await loadSecp256k1();
    await loadBip39Bip32();
}

// ============================================================
// BIP-39 Mnemonic + BIP-32 Key Derivation
// ============================================================

// Kaspa derivation path: m/44'/111111'/0'/0/0
const KASPA_DERIVATION_PATH = "m/44'/111111'/0'/0/0";

function generateMnemonic() {
    return bip39.generateMnemonic(bip39.wordlist, 128); // 128 bits = 12 words
}

function validateMnemonic(mnemonic) {
    return bip39.validateMnemonic(mnemonic, bip39.wordlist);
}

function derivePrivateKeyFromMnemonic(mnemonic) {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const hdKey = bip32.HDKey.fromMasterSeed(seed);
    const child = hdKey.derive(KASPA_DERIVATION_PATH);
    return cryptoLib.bytesToHex(child.privateKey);
}

// Generate a random 32-byte private key (fallback, used for raw import)
function generatePrivateKey() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return cryptoLib.bytesToHex(bytes);
}

// Get public key (x-only for schnorr, 32 bytes)
function getPublicKey(privKeyHex) {
    const pubKey = secp.getPublicKey(privKeyHex, true); // compressed 33 bytes
    return pubKey.slice(1); // remove 02/03 prefix → x-only 32 bytes
}

// ============================================================
// Kaspa Address encoding (cashaddr variant)
// ============================================================

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(values) {
    let c = 1n;
    for (const v of values) {
        const c0 = c >> 35n;
        c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(v);
        if (c0 & 1n) c ^= 0x98f2bc8e61n;
        if (c0 & 2n) c ^= 0x79b76d99e2n;
        if (c0 & 4n) c ^= 0xf33e5fb3c4n;
        if (c0 & 8n) c ^= 0xae2eabe2a8n;
        if (c0 & 16n) c ^= 0x1e4f43e470n;
    }
    return c ^ 1n;
}

function prefixExpand(prefix) {
    const result = [];
    for (let i = 0; i < prefix.length; i++) {
        result.push(prefix.charCodeAt(i) & 0x1f);
    }
    result.push(0);
    return result;
}

function convertBits(data, fromBits, toBits, pad) {
    let acc = 0, bits = 0;
    const result = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
        acc = (acc << fromBits) | value;
        bits += fromBits;
        while (bits >= toBits) {
            bits -= toBits;
            result.push((acc >> bits) & maxv);
        }
    }
    if (pad && bits > 0) {
        result.push((acc << (toBits - bits)) & maxv);
    }
    return result;
}

function createChecksum(prefix, payload) {
    const values = [...prefixExpand(prefix), ...payload, 0, 0, 0, 0, 0, 0, 0, 0];
    const poly = polymod(values);
    const result = [];
    for (let i = 0; i < 8; i++) {
        result.push(Number((poly >> BigInt(5 * (7 - i))) & 0x1fn));
    }
    return result;
}

function decodeCashAddr(addrStr) {
    const parts = addrStr.split(':');
    if (parts.length !== 2) throw new Error('Invalid address format');
    const prefix = parts[0];
    const data5bit = [];
    for (const c of parts[1]) {
        const idx = CHARSET.indexOf(c);
        if (idx === -1) throw new Error('Invalid character in address');
        data5bit.push(idx);
    }
    const values = [...prefixExpand(prefix), ...data5bit];
    if (polymod(values) !== 0n) throw new Error('Invalid checksum');
    const payload5bit = data5bit.slice(0, -8);
    const payload8bit = convertBits(payload5bit, 5, 8, false);
    const versionByte = payload8bit[0];
    const hash = payload8bit.slice(1);
    return { prefix, version: versionByte >> 3, hash: new Uint8Array(hash) };
}

function pubkeyToAddress(pubkeyBytes, prefix = NETWORK_PREFIX) {
    // Schnorr x-only pubkey (32 bytes), type=0, size=3 (32 bytes)
    const versionByte = 0x03;
    const payload = [versionByte, ...pubkeyBytes];
    const payload5bit = convertBits(payload, 8, 5, true);
    const checksum = createChecksum(prefix, payload5bit);
    const combined = [...payload5bit, ...checksum];
    let addr = prefix + ':';
    for (const c of combined) {
        addr += CHARSET[c];
    }
    return addr;
}

// ============================================================
// PBKDF2 + AES-256-GCM encryption (Web Crypto API)
// ============================================================

async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptData(password, data) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(data)
    );
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);
    return cryptoLib.bytesToHex(result);
}

async function decryptData(password, hexData) {
    const data = cryptoLib.hexToBytes(hexData);
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const ciphertext = data.slice(28);
    const key = await deriveKey(password, salt);
    const dec = new TextDecoder();
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );
    return dec.decode(decrypted);
}

// ============================================================
// IndexedDB storage
// ============================================================

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('KaspaWallet', 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('wallet')) {
                db.createObjectStore('wallet');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('wallet', 'readonly');
        const req = tx.objectStore('wallet').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('wallet', 'readwrite');
        tx.objectStore('wallet').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbDelete(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('wallet', 'readwrite');
        tx.objectStore('wallet').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============================================================
// RPC - Talk to kaspad via API proxy
// ============================================================

const API_BASE = '/kaspa/api';

async function rpcCall(method, params = {}) {
    const res = await fetch(`${API_BASE}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!res.ok) throw new Error(`RPC error: ${res.status}`);
    return res.json();
}

async function getBalance(address) {
    try {
        const data = await rpcCall('getBalanceByAddress', { address });
        return data.balance || 0;
    } catch (e) {
        console.error('Balance fetch error:', e);
        return null;
    }
}

async function getUtxos(address) {
    try {
        const data = await rpcCall('getUtxosByAddresses', { addresses: [address] });
        return data.entries || [];
    } catch (e) {
        console.error('UTXO fetch error:', e);
        return [];
    }
}

async function submitTransaction(tx) {
    return rpcCall('submitTransaction', { transaction: tx });
}

// ============================================================
// ECIES Encryption/Decryption (browser-side)
// ============================================================

async function eciesEncrypt(recipientPubKeyHex, plaintext) {
    const recipientPubBytes = cryptoLib.hexToBytes(recipientPubKeyHex);
    const ephPrivKey = secp.utils.randomPrivateKey();
    const ephPubKey = secp.getPublicKey(ephPrivKey, false);
    const sharedPoint = secp.getSharedSecret(ephPrivKey, recipientPubBytes, false);
    const sharedX = sharedPoint.slice(1, 33);
    const aesKey = await crypto.subtle.digest('SHA-256', sharedX);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['encrypt']);
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        enc.encode(plaintext)
    );
    const encArray = new Uint8Array(encrypted);
    const ciphertext = encArray.slice(0, -16);
    const tag = encArray.slice(-16);
    const result = new Uint8Array(65 + 16 + 16 + ciphertext.length);
    result.set(ephPubKey, 0);
    result.set(iv, 65);
    result.set(tag, 65 + 16);
    result.set(ciphertext, 65 + 16 + 16);
    return cryptoLib.bytesToHex(result);
}

async function eciesDecrypt(privKeyHex, ciphertextHex) {
    const data = cryptoLib.hexToBytes(ciphertextHex);
    const ephPubKey = data.slice(0, 65);
    const iv = data.slice(65, 81);
    const tag = data.slice(81, 97);
    const ciphertext = data.slice(97);
    const sharedPoint = secp.getSharedSecret(privKeyHex, ephPubKey, false);
    const sharedX = sharedPoint.slice(1, 33);
    const aesKeyBuf = await crypto.subtle.digest('SHA-256', sharedX);
    const key = await crypto.subtle.importKey('raw', aesKeyBuf, 'AES-GCM', false, ['decrypt']);
    const encData = new Uint8Array(ciphertext.length + 16);
    encData.set(ciphertext, 0);
    encData.set(tag, ciphertext.length);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        encData
    );
    return new TextDecoder().decode(decrypted);
}

async function eciesDecryptWithRetry(privKeyHex, ciphertextHex) {
    try {
        return await eciesDecrypt(privKeyHex, ciphertextHex);
    } catch (e) {
        const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
        const privBigInt = BigInt('0x' + privKeyHex);
        const negated = (n - privBigInt).toString(16).padStart(64, '0');
        return await eciesDecrypt(negated, ciphertextHex);
    }
}

// ============================================================
// Whisper API
// ============================================================

const WHISPER_API = '/whisper';

async function whisperInbox(address) {
    try {
        const res = await fetch(`${WHISPER_API}/api/inbox?address=${encodeURIComponent(address)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    } catch (e) {
        console.error('Inbox error:', e);
        return { messages: [], error: e.message };
    }
}

async function whisperGetInfo(txId) {
    const res = await fetch(`${WHISPER_API}/api/whisper/${txId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function whisperSend(toAddress, encryptedDataHex, senderPrivKeyHex) {
    const res = await fetch(`${WHISPER_API}/api/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Whisper-Key': 'whisper-testnet-poc-key'
        },
        body: JSON.stringify({
            to: toAddress,
            message: encryptedDataHex,
            sender_key: senderPrivKeyHex,
            type: 'whisper',
            pre_encrypted: true
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ============================================================
// App State & UI
// ============================================================

let currentAddress = null;
let currentPubKey = null;
let currentImportMethod = 'mnemonic';
let pendingMnemonic = null; // temp store during create flow

const $ = (id) => document.getElementById(id);
const show = (el) => { if (typeof el === 'string') el = $(el); el.style.display = ''; };
const hide = (el) => { if (typeof el === 'string') el = $(el); el.style.display = 'none'; };

function showError(msg) {
    const el = $('auth-error');
    el.textContent = msg;
    show(el);
    setTimeout(() => hide(el), 5000);
}

function showAuthForm(formId) {
    ['no-wallet', 'has-wallet', 'create-form', 'import-form', 'mnemonic-display'].forEach(id => hide(id));
    show(formId);
    hide('auth-error');
}

async function checkWalletExists() {
    const data = await dbGet('encryptedKey');
    return !!data;
}

async function showAuthScreen() {
    hide('wallet-screen');
    const authScreen = $('auth-screen');
    authScreen.classList.add('active');
    show(authScreen);

    if (await checkWalletExists()) {
        showAuthForm('has-wallet');
    } else {
        showAuthForm('no-wallet');
    }
}

// Display mnemonic words in a numbered grid
function displayMnemonicGrid(mnemonic) {
    const words = mnemonic.split(' ');
    const grid = $('mnemonic-grid');
    grid.innerHTML = words.map((word, i) =>
        `<div class="mnemonic-word"><span class="mnemonic-num">${i + 1}</span><span class="mnemonic-text">${word}</span></div>`
    ).join('');
}

async function createWallet(password) {
    const mnemonic = generateMnemonic();
    const privKey = derivePrivateKeyFromMnemonic(mnemonic);
    const pubKey = getPublicKey(privKey);
    const address = pubkeyToAddress(pubKey);

    // Encrypt and store the derived private key (NOT the mnemonic)
    const encrypted = await encryptData(password, privKey);
    await dbSet('encryptedKey', encrypted);
    await dbSet('address', address);
    await dbSet('pubkey', cryptoLib.bytesToHex(pubKey));

    return { mnemonic, address };
}

async function importWalletFromMnemonic(mnemonic, password) {
    const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(normalized)) {
        throw new Error('Invalid mnemonic phrase. Please check your words.');
    }

    const privKey = derivePrivateKeyFromMnemonic(normalized);
    const pubKey = getPublicKey(privKey);
    const address = pubkeyToAddress(pubKey);

    const encrypted = await encryptData(password, privKey);
    await dbSet('encryptedKey', encrypted);
    await dbSet('address', address);
    await dbSet('pubkey', cryptoLib.bytesToHex(pubKey));

    return { address };
}

async function importWalletFromPrivKey(privKeyHex, password) {
    if (!/^[0-9a-fA-F]{64}$/.test(privKeyHex)) {
        throw new Error('Invalid private key (must be 64 hex characters)');
    }

    const pubKey = getPublicKey(privKeyHex);
    const address = pubkeyToAddress(pubKey);

    const encrypted = await encryptData(password, privKeyHex);
    await dbSet('encryptedKey', encrypted);
    await dbSet('address', address);
    await dbSet('pubkey', cryptoLib.bytesToHex(pubKey));

    return { address };
}

async function unlockWallet(password) {
    const encrypted = await dbGet('encryptedKey');
    if (!encrypted) throw new Error('No wallet found');

    try {
        const privKey = await decryptData(password, encrypted);
        const pubKey = getPublicKey(privKey);
        const address = pubkeyToAddress(pubKey);
        return { address, pubKey: cryptoLib.bytesToHex(pubKey) };
    } catch (e) {
        throw new Error('Wrong password');
    }
}

async function showWalletScreen(address) {
    currentAddress = address;

    hide('auth-screen');
    $('auth-screen').classList.remove('active');
    const walletScreen = $('wallet-screen');
    walletScreen.classList.add('active');
    show(walletScreen);

    $('address-display').textContent = address;

    const qr = qrcode(0, 'M');
    qr.addData(address);
    qr.make();
    $('qr-container').innerHTML = qr.createSvgTag(5, 0);
    const svg = $('qr-container').querySelector('svg');
    if (svg) {
        svg.style.borderRadius = '8px';
        svg.style.background = 'white';
        svg.style.padding = '12px';
    }

    refreshBalance();
}

async function refreshBalance() {
    const btn = $('btn-refresh');
    btn.classList.add('spinning');

    try {
        const sompi = await getBalance(currentAddress);
        if (sompi !== null) {
            const kas = sompi / 100000000;
            $('balance-value').textContent = kas.toFixed(8);
        } else {
            $('balance-value').textContent = 'Error';
            $('balance-usd').textContent = 'Could not connect to node';
        }
    } catch (e) {
        $('balance-value').textContent = '--';
        $('balance-usd').textContent = 'Connection error';
    }

    btn.classList.remove('spinning');
}

// ============================================================
// Event listeners
// ============================================================

function setupEventListeners() {
    // Create wallet
    $('btn-create').addEventListener('click', () => showAuthForm('create-form'));
    $('btn-back-create').addEventListener('click', () => showAuthForm('no-wallet'));

    $('btn-do-create').addEventListener('click', async () => {
        const pw = $('create-password').value;
        const pw2 = $('create-password2').value;
        if (pw.length < 6) return showError('Password must be at least 6 characters');
        if (pw !== pw2) return showError('Passwords do not match');

        try {
            const { mnemonic, address } = await createWallet(pw);
            pendingMnemonic = mnemonic;
            displayMnemonicGrid(mnemonic);
            showAuthForm('mnemonic-display');
            currentAddress = address;
        } catch (e) {
            showError(e.message);
        }
    });

    $('saved-checkbox').addEventListener('change', (e) => {
        $('btn-continue').disabled = !e.target.checked;
    });

    $('btn-continue').addEventListener('click', () => {
        // Clear mnemonic from memory and DOM
        pendingMnemonic = null;
        $('mnemonic-grid').innerHTML = '';
        showWalletScreen(currentAddress);
    });

    // Import wallet
    $('btn-import').addEventListener('click', () => showAuthForm('import-form'));
    $('btn-back-import').addEventListener('click', () => showAuthForm('no-wallet'));

    // Import method tabs
    document.querySelectorAll('.import-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentImportMethod = tab.dataset.import;
            if (currentImportMethod === 'mnemonic') {
                show('import-mnemonic-panel');
                hide('import-privkey-panel');
            } else {
                hide('import-mnemonic-panel');
                show('import-privkey-panel');
            }
        });
    });

    $('btn-do-import').addEventListener('click', async () => {
        const pw = $('import-password').value;
        const pw2 = $('import-password2').value;
        if (pw.length < 6) return showError('Password must be at least 6 characters');
        if (pw !== pw2) return showError('Passwords do not match');

        try {
            let result;
            if (currentImportMethod === 'mnemonic') {
                const mnemonic = $('import-mnemonic').value.trim();
                if (!mnemonic) return showError('Enter your mnemonic phrase');
                result = await importWalletFromMnemonic(mnemonic, pw);
                $('import-mnemonic').value = '';
            } else {
                const privKey = $('import-privkey').value.trim();
                if (!privKey) return showError('Enter your private key');
                result = await importWalletFromPrivKey(privKey, pw);
                $('import-privkey').value = '';
            }
            showWalletScreen(result.address);
        } catch (e) {
            showError(e.message);
        }
    });

    // Login
    $('btn-login').addEventListener('click', async () => {
        const pw = $('login-password').value;
        if (!pw) return showError('Enter your password');

        try {
            const { address } = await unlockWallet(pw);
            $('login-password').value = '';
            showWalletScreen(address);
        } catch (e) {
            showError(e.message);
        }
    });

    $('login-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') $('btn-login').click();
    });

    // Reset wallet
    $('btn-reset').addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm('This will delete your wallet from this browser. Make sure you have your recovery phrase or private key backed up!')) {
            await dbDelete('encryptedKey');
            await dbDelete('address');
            await dbDelete('pubkey');
            showAuthForm('no-wallet');
        }
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            $(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // Refresh balance
    $('btn-refresh').addEventListener('click', refreshBalance);

    // Copy address
    $('btn-copy-addr').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(currentAddress);
            $('btn-copy-addr').textContent = '✅ Copied!';
            setTimeout(() => $('btn-copy-addr').textContent = '📋 Copy Address', 2000);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = currentAddress;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            $('btn-copy-addr').textContent = '✅ Copied!';
            setTimeout(() => $('btn-copy-addr').textContent = '📋 Copy Address', 2000);
        }
    });

    // Send
    $('btn-send').addEventListener('click', async () => {
        const addr = $('send-address').value.trim();
        const amount = parseFloat($('send-amount').value);
        const pw = $('send-password').value;

        if (!addr.startsWith('kaspatest:')) return showSendResult('Invalid address (must start with kaspatest:)', true);
        if (!amount || amount <= 0) return showSendResult('Invalid amount', true);
        if (!pw) return showSendResult('Enter your password', true);

        try {
            const encrypted = await dbGet('encryptedKey');
            const privKey = await decryptData(pw, encrypted);
            const utxos = await getUtxos(currentAddress);
            if (!utxos.length) {
                showSendResult('No UTXOs available', true);
                return;
            }

            const sompiAmount = Math.round(amount * 100000000);
            const result = await rpcCall('createAndSubmitTransaction', {
                privateKey: privKey,
                toAddress: addr,
                amount: sompiAmount,
                fromAddress: currentAddress
            });

            showSendResult(`✅ Transaction sent! TX: ${result.transactionId || 'submitted'}`, false);
            $('send-password').value = '';
            setTimeout(refreshBalance, 3000);
        } catch (e) {
            showSendResult(`Error: ${e.message}`, true);
        }
    });

    function showSendResult(msg, isError) {
        const el = $('send-result');
        el.className = isError ? 'error-msg' : 'success-msg';
        el.textContent = msg;
        show(el);
        setTimeout(() => hide(el), 8000);
    }

    // Export
    $('btn-export').addEventListener('click', () => {
        show('export-modal');
        $('export-password').value = '';
        hide('export-result');
    });

    $('btn-do-export').addEventListener('click', async () => {
        const pw = $('export-password').value;
        try {
            const encrypted = await dbGet('encryptedKey');
            const privKey = await decryptData(pw, encrypted);
            $('export-result').textContent = privKey;
            $('export-result').style.color = '';
            show('export-result');
        } catch {
            $('export-result').textContent = 'Wrong password';
            $('export-result').style.color = 'var(--danger)';
            show('export-result');
        }
    });

    $('btn-close-export').addEventListener('click', () => {
        $('export-result').textContent = '';
        hide('export-modal');
    });

    // Logout
    $('btn-logout').addEventListener('click', () => {
        currentAddress = null;
        currentPubKey = null;
        showAuthScreen();
    });

    // Delete wallet
    $('btn-delete').addEventListener('click', async () => {
        if (confirm('⚠️ DELETE WALLET?\n\nThis permanently removes your encrypted key from this browser.\nMake sure you have backed up your recovery phrase or private key!')) {
            await dbDelete('encryptedKey');
            await dbDelete('address');
            await dbDelete('pubkey');
            currentAddress = null;
            showAuthScreen();
        }
    });

    // ── Whisper ──────────────────────────────────────────────

    document.querySelectorAll('.whisper-subtab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.whisper-subtab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.subtab;
            hide('whisper-inbox');
            hide('whisper-compose');
            hide('whisper-read');
            if (target === 'inbox') show('whisper-inbox');
            else show('whisper-compose');
        });
    });

    $('btn-refresh-inbox').addEventListener('click', loadInbox);
    document.querySelector('[data-tab="whisper"]').addEventListener('click', loadInbox);

    $('btn-send-whisper').addEventListener('click', async () => {
        const toAddr = $('whisper-to').value.trim();
        const message = $('whisper-message').value.trim();
        const password = $('whisper-password').value;

        if (!toAddr.startsWith('kaspatest:')) return showWhisperResult('Invalid address', true);
        if (!message) return showWhisperResult('Enter a message', true);
        if (!password) return showWhisperResult('Enter your wallet password', true);

        const btn = $('btn-send-whisper');
        btn.disabled = true;
        btn.textContent = '🔐 Encrypting & Sending...';

        try {
            const encrypted = await dbGet('encryptedKey');
            const privKey = await decryptData(password, encrypted);

            const decoded = decodeCashAddr(toAddr);
            const recipientPubHex = '02' + cryptoLib.bytesToHex(decoded.hash);

            const ciphertextHex = await eciesEncrypt(recipientPubHex, message);
            const result = await whisperSend(toAddr, ciphertextHex, privKey);

            showWhisperResult(`✅ Whisper sent!\nTX: ${result.tx_id || 'submitted'}\nDeposit: 0.2 tKAS (refunded when read)`, false);
            $('whisper-message').value = '';
            $('whisper-password').value = '';
            setTimeout(refreshBalance, 3000);
        } catch (e) {
            showWhisperResult(`Error: ${e.message}`, true);
        } finally {
            btn.disabled = false;
            btn.textContent = '🌊 Send Whisper';
        }
    });

    $('btn-close-whisper').addEventListener('click', () => {
        hide('whisper-read');
        show('whisper-inbox');
    });
}

// ── Whisper helper functions ─────────────────────────────────

async function loadInbox() {
    if (!currentAddress) return;

    const btn = $('btn-refresh-inbox');
    btn.classList.add('spinning');

    try {
        const data = await whisperInbox(currentAddress);
        const messages = data.messages || data || [];
        const list = $('inbox-list');

        if (!messages.length) {
            list.innerHTML = '<div class="inbox-empty">No whispers yet. Share your address to receive encrypted messages!</div>';
        } else {
            list.innerHTML = messages.map(msg => `
                <div class="inbox-item" data-txid="${msg.tx_id}">
                    <div class="inbox-item-icon">🌊</div>
                    <div class="inbox-item-details">
                        <div class="inbox-item-sender">From: ${msg.sender || 'unknown'}</div>
                        <div class="inbox-item-deposit">${(msg.deposit || 0) / 1e8} tKAS locked</div>
                    </div>
                    <div class="inbox-item-arrow">→</div>
                </div>
            `).join('');

            list.querySelectorAll('.inbox-item').forEach(item => {
                item.addEventListener('click', () => readWhisper(item.dataset.txid));
            });
        }
    } catch (e) {
        $('inbox-list').innerHTML = `<div class="inbox-empty">Error loading inbox: ${e.message}</div>`;
    }

    btn.classList.remove('spinning');
}

async function readWhisper(txId) {
    hide('whisper-inbox');
    show('whisper-read');

    $('whisper-read-meta').innerHTML = `<strong>TX:</strong> ${txId}<br><div class="whisper-decrypting">🔐 Fetching & decrypting...</div>`;
    $('whisper-read-content').textContent = '';

    try {
        const info = await whisperGetInfo(txId);

        $('whisper-read-meta').innerHTML = `
            <strong>From:</strong> ${info.a_address || info.sender || 'unknown'}<br>
            <strong>TX:</strong> <span style="font-size:11px">${txId}</span><br>
            <strong>Type:</strong> ${info.type || 'whisper'}
        `;

        const msgType = info.type || info.t || 'message';
        const rawData = info.d || info.message || '';

        if (msgType === 'whisper' && rawData) {
            const password = prompt('Enter wallet password to decrypt this whisper:');
            if (!password) {
                $('whisper-read-content').textContent = '❌ Decryption cancelled';
                return;
            }

            try {
                const encrypted = await dbGet('encryptedKey');
                const privKey = await decryptData(password, encrypted);
                const plaintext = await eciesDecryptWithRetry(privKey, rawData);
                $('whisper-read-content').textContent = plaintext;
            } catch (e) {
                $('whisper-read-content').textContent = `❌ Decryption failed: ${e.message}`;
            }
        } else {
            $('whisper-read-content').textContent = rawData || '(empty message)';
        }
    } catch (e) {
        $('whisper-read-content').textContent = `❌ Error: ${e.message}`;
    }
}

function showWhisperResult(msg, isError) {
    const el = $('whisper-send-result');
    el.className = isError ? 'error-msg' : 'success-msg';
    el.textContent = msg;
    el.style.whiteSpace = 'pre-line';
    show(el);
    if (!isError) setTimeout(() => hide(el), 15000);
}

// ============================================================
// Boot
// ============================================================

(async () => {
    await init();
    setupEventListeners();
    showAuthScreen();
})();
