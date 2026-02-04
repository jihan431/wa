const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');

// --- KONFIGURASI UTAMA ---
// GANTI NOMOR INI DENGAN NOMOR WA KAMU!
// Format: KodeNegara+Nomor (tanpa 0/+) + @c.us
const ownerNumber = '6285123248618@c.us'; 

let isAutoReplyActive = false;
let autoReplyMessage = "[AUTO REPLY] sabar boss";

// Daftar Command Valid (Untuk Log Server)
const validCommands = [
    '/stiker', '/sticker', '/toimg', '/tag', '/tagall', '/screen', 
    '/auto', '/stop auto', '/github', '/ig', '/tele', '/linkwa', '/help'
];

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome-stable', 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('>>> Scan QR Code sekarang!');
});

client.on('ready', () => {
    console.log('>>> Bot SIAP di VPS! 🚀');
    console.log(`>>> Mode Owner-Only Aktif untuk: ${ownerNumber}`);
});

client.on('message_create', async (msg) => {
    const text = msg.body || '';
    const textLower = text.toLowerCase(); 
    const target = msg.fromMe ? msg.to : msg.from;

    // --- 0. CEK OWNER (HANYA KAMU YANG BISA PAKAI COMMAND) ---
    // Identifikasi pengirim asli
    let senderId;
    if (msg.fromMe) {
        senderId = client.info.wid._serialized; 
    } else if (msg.from.endsWith('@g.us')) {
        senderId = msg.author; 
    } else {
        senderId = msg.from; 
    }

    // Jika pesan diawali '/' (Command) DAN pengirim bukan Owner -> ABAIKAN
    if (text.startsWith('/') && senderId !== ownerNumber) {
        return; 
    }

    // --- 1. LOGIKA AUTO REPLY (Bisa merespon orang lain jika diaktifkan Owner) ---
    if (isAutoReplyActive && !msg.fromMe && msg.from !== 'status@broadcast') {
        const chat = await msg.getChat();
        if (!chat.isGroup) {
            await client.sendMessage(msg.from, `🤖 [Auto]: ${autoReplyMessage}`);
        }
    }

    // --- 2. LOGIKA COMMAND ---
    if (text.startsWith('/')) {
        
        // [LOG SERVER]
        const isCommandValid = validCommands.some(cmd => textLower.startsWith(cmd));
        if (isCommandValid) {
            try {
                const contactLog = await msg.getContact();
                console.log(`[EXEC] "${text}" | Oleh: ${contactLog.pushname || contactLog.number}`);
            } catch (e) {}
        } else { return; }

        // A. /stiker (Gambar/Video -> Stiker)
        if (textLower === '/stiker' || textLower === '/sticker') {
            try {
                if (msg.hasMedia) {
                    const media = await msg.downloadMedia();
                    await client.sendMessage(target, media, { sendMediaAsSticker: true, stickerAuthor: 'Lyon Bot', stickerName: 'Sticker' });
                } else if (msg.hasQuotedMsg) {
                    const quotedMsg = await msg.getQuotedMessage();
                    if (quotedMsg.hasMedia) {
                        const media = await quotedMsg.downloadMedia();
                        await client.sendMessage(target, media, { sendMediaAsSticker: true, stickerAuthor: 'Lyon Bot', stickerName: 'Sticker' });
                    }
                }
            } catch (error) {
                console.error(error);
                await client.sendMessage(target, '❌ Gagal membuat stiker.');
            }
            return;
        }

        // B. /toimg (Stiker -> Gambar) - MENGGUNAKAN IMAGEMAGICK
        if (textLower === '/toimg') {
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg.hasMedia) {
                    try {
                        const media = await quotedMsg.downloadMedia();
                        // Simpan di folder sementara Linux (/tmp)
                        const rand = Math.floor(Math.random() * 10000);
                        const inpFile = `/tmp/stick_${rand}.webp`;
                        const outFile = `/tmp/img_${rand}.png`;

                        fs.writeFileSync(inpFile, media.data, 'base64');

                        // Jalankan 'convert' (ImageMagick)
                        // [0] = Ambil frame pertama saja (solusi stiker gerak)
                        exec(`convert "${inpFile}[0]" "${outFile}"`, async (err, stdout, stderr) => {
                            if (err) {
                                console.error(`[CONVERT ERROR]: ${err.message}`);
                                await client.sendMessage(target, '❌ Gagal konversi (Cek Log VPS).');
                            } else {
                                const mediaData = fs.readFileSync(outFile, { encoding: 'base64' });
                                const newMedia = new MessageMedia('image/png', mediaData);
                                await client.sendMessage(target, newMedia);
                            }
                            
                            // Bersihkan file sampah
                            try {
                                if (fs.existsSync(inpFile)) fs.unlinkSync(inpFile);
                                if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
                            } catch (e) {}
                        });
                    } catch (e) {
                        console.error(e);
                        msg.reply('❌ Gagal download media stiker.');
                    }
                } else {
                    msg.reply('❌ Reply stikernya dengan perintah /toimg');
                }
            }
            return;
        }

        // C. /screen (Screenshot Website)
        if (textLower.startsWith('/screen')) {
            const url = text.slice(7).trim();
            if (!url) return client.sendMessage(target, '❌ Masukkan URL. Contoh: /screen google.com');

            await client.sendMessage(target, '⏳ Proses screenshot...');
            try {
                const browser = await puppeteer.launch({
                    executablePath: '/usr/bin/google-chrome-stable',
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
                });
                const page = await browser.newPage();
                await page.setViewport({ width: 1280, height: 720 });
                
                const targetUrl = url.startsWith('http') ? url : `https://${url}`;
                await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                
                const screenshotBase64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
                await browser.close();
                
                const media = new MessageMedia('image/jpeg', screenshotBase64);
                await client.sendMessage(target, media, { caption: `📸 Screenshot: ${targetUrl}` });
            } catch (error) {
                console.error(error);
                await client.sendMessage(target, '❌ Gagal screenshot (Web berat/Timeout).');
            }
            return;
        }

        // D. /tag & /tagall
        if (textLower === '/tag' || textLower === '/tagall') {
            const chat = await msg.getChat();
            if (chat.isGroup) {
                let text = `📢 *TAG ALL*\n\n`;
                let mentions = [];
                for (let participant of chat.participants) {
                    const contact = await client.getContactById(participant.id._serialized);
                    mentions.push(contact);
                    text += `@${participant.id.user} `;
                }
                await chat.sendMessage(text, { mentions });
            } else {
                await client.sendMessage(target, '❌ Hanya untuk grup.');
            }
            return;
        }

        // E. Settings & Sosmed
        if (textLower.startsWith('/auto')) {
            const newMsg = text.slice(5).trim(); 
            if (newMsg) autoReplyMessage = newMsg;
            isAutoReplyActive = true;
            await client.sendMessage(target, `✅ *Auto Reply ON*\nPesan: "${autoReplyMessage}"`);
            return;
        }
        if (textLower === '/stop auto') {
            isAutoReplyActive = false;
            await client.sendMessage(target, '🛑 *Auto Reply OFF*');
            return;
        }

        switch (textLower) {
            case '/github': await client.sendMessage(target, '🐙 *GitHub:* https://github.com/jihan431'); break;
            case '/ig': await client.sendMessage(target, '📸 *Instagram:* https://instagram.com/jhnngrhaa'); break;
            case '/tele': await client.sendMessage(target, '✈️ *Telegram:* https://t.me/Myflexxd'); break;
            case '/linkwa': await client.sendMessage(target, `📱 *WhatsApp:* https://wa.me/${client.info.wid.user}`); break;
        }
    }
});

client.initialize();
