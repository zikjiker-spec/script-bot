import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendFakeQuoted } from '../../lib/fakequoted.js';
import { getUser, saveUser, addXP, formatMoney } from '../../lib/rpg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path absolut ke folder json/
const JSON_PATH = path.join(__dirname, '..', '..', 'json', 'susunkata.json');

if (!global.susunkataGames) global.susunkataGames = {};
if (!global.susunkataWrongCd) global.susunkataWrongCd = {};

// Normalisasi teks (hapus tanda baca & spasi ganda)
const normalize = (text) => {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
};

export default {
    command: ['susunkata'],
    category: 'game',
    execute: async (denn, m) => {
        const chatId = m.chat;

        // Cek jika masih ada game yang berjalan di chat ini
        if (global.susunkataGames[chatId]) {
            return sendFakeQuoted(denn, m, 
                `⚠️ Masih ada game Susun Kata yang belum dijawab di chat ini!\nSelesaikan atau ketik *nyerah* terlebih dahulu.`, 
                { title: 'Game Sedang Berjalan', body: 'Selesaikan game sebelumnya' }
            );
        }

        // Baca data dari JSON
        let data = [];
        try {
            if (!fs.existsSync(JSON_PATH)) {
                throw new Error('File susunkata.json tidak ditemukan di folder json/');
            }
            const raw = fs.readFileSync(JSON_PATH, 'utf-8');
            data = JSON.parse(raw);
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('Data soal susunkata.json kosong atau formatnya salah.');
            }
        } catch (e) {
            console.error('[SusunKata Error]', e.message);
            return sendFakeQuoted(denn, m, `❌ Error: ${e.message}`, {
                title: 'Gagal Memuat Game', body: 'Cek file JSON kamu'
            });
        }

        await denn.sendMessage(m.chat, { react: { text: "⏳", key: m.key } });

        try {
            // Ambil soal acak dari JSON
            const randomIndex = Math.floor(Math.random() * data.length);
            const p = data[randomIndex];
            
            const soalText = p.soal;
            const tipeText = p.tipe;
            const jawabanBenar = p.jawaban;

            let text = `🎮 *SUSUN KATA*\n\n`;
            text += `📝 *Soal:* ${soalText}\n`;
            text += `💡 *Tipe:* ${tipeText}\n`;
            text += `\n⏰ *Waktu:* 60 detik\n`;
            text += `🎁 *Hadiah:* +500 XP & +10 Koin\n\n`;
            text += `💡 *Cara Jawab:* Balas (reply) pesan soal ini dengan jawabanmu.\n`;
            text += `Ketik *nyerah* untuk menyerah.`;

            // Kirim soal dan simpan ID pesannya
            const sentQuestion = await sendFakeQuoted(denn, m, text.trim(), {
                title: 'Susun Kata',
                body: 'Balas pesan ini untuk menjawab!'
            });
            
            const questionMsgId = sentQuestion?.key?.id;

            const listener = async (socket, msg, body) => {
                if (msg.key.fromMe) return false;

                const userAnswer = normalize(body);
                const quotedId = msg.quoted?.key?.id;

                // Cek apakah user menyerah
                if (userAnswer === 'nyerah') {
                    clearTimeout(global.susunkataGames[chatId]?.timeout);
                    delete global.susunkataGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    await sendFakeQuoted(socket, msg, `🏳️ Kamu menyerah!\n\nJawaban yang benar adalah: *${jawabanBenar}*`, {
                        title: 'Game Berakhir', body: 'Kamu menyerah'
                    });
                    return true;
                }

                // Pastikan user me-reply pesan soal bot
                if (quotedId !== questionMsgId) {
                    return false;
                }

                // Cek jawaban
                const isCorrect = normalize(jawabanBenar) === userAnswer;

                if (isCorrect) {
                    clearTimeout(global.susunkataGames[chatId]?.timeout);
                    delete global.susunkataGames[chatId];
                    global.passiveListeners.delete(chatId);

                    // Berikan hadiah RPG
                    const user = getUser(msg.sender);
                    user.money = (user.money || 0) + 10;
                    saveUser(msg.sender, user);
                    addXP(msg.sender, 500);
                    const updated = getUser(msg.sender);

                    await sendFakeQuoted(socket, msg, 
                        `🎉 *BENAR!*\n\nJawaban kamu tepat!\n\n` +
                        `🎁 *Hadiah:*\n💰 Uang: +${formatMoney(10)}\n⭐ XP: +500\n\n` +
                        `💵 Dompet sekarang: ${formatMoney(updated.money)}`, 
                        { title: 'Jawaban Benar!', body: 'Kamu mendapatkan hadiah' }
                    );
                    return true;
                } else {
                    // Reaksi salah
                    await socket.sendMessage(msg.chat, { react: { text: '❌', key: msg.key } }).catch(() => {});
                    
                    // Batasi balasan salah maksimal 1x per 3 detik
                    const wrongKey = `${chatId}_${msg.sender}`;
                    const now = Date.now();
                    const lastWrong = global.susunkataWrongCd[wrongKey] || 0;
                    
                    if (now - lastWrong > 3000) {
                        global.susunkataWrongCd[wrongKey] = now;
                        await socket.sendMessage(msg.chat, { 
                            text: `❌ Jawaban salah, coba lagi!` 
                        }, { quoted: msg }).catch(() => {});
                    }
                    return true;
                }
            };

            // Daftarkan listener
            global.passiveListeners.set(chatId, listener);

            // Timer waktu habis (60 detik)
            const timeout = setTimeout(async () => {
                if (global.susunkataGames[chatId]) {
                    delete global.susunkataGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    await sendFakeQuoted(denn, m, `⏳ *WAKTU HABIS!*\n\nJawabannya adalah: *${jawabanBenar}*`, {
                        title: 'Waktu Habis', body: 'Game berakhir'
                    });
                }
            }, 60000);

            // Simpan state game
            global.susunkataGames[chatId] = { 
                answer: jawabanBenar, 
                timeout,
                msgId: questionMsgId 
            };

            await denn.sendMessage(m.chat, { react: { text: "✅", key: m.key } });

        } catch (e) {
            global.passiveListeners.delete(chatId);
            await denn.sendMessage(m.chat, { react: { text: "❌", key: m.key } }).catch(() => {});
            console.error('[SusunKata Error]', e.message);
            sendFakeQuoted(denn, m, `❌ Error: ${e.message || "Gagal memulai game"}`, {
                title: 'Game Error', body: 'Terjadi kesalahan pada server'
            });
        }
    }
};