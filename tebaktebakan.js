import axios from 'axios';
import { sendFakeQuoted } from '../../lib/fakequoted.js';
import { getUser, saveUser, addXP, formatMoney } from '../../lib/rpg.js';

if (!global.tebaktebakanGames) global.tebaktebakanGames = {};
if (!global.tebaktebakanWrongCd) global.tebaktebakanWrongCd = {};

const normalize = (text) => {
    return String(text || '').toLowerCase().replace(/[^\w\s]/gi, '').replace(/\s+/g, ' ').trim();
};

// ─── SKIP FIELD METADATA ───
const SKIP_KEYS = ['status', 'creator', 'author', 'apikey', 'api_key', 'message', 'error', 'code', 'success', 'ok'];

// ─── EKSTRAK SOAL (Cari String Terpanjang) ───
const extractSoal = (p) => {
    const soalKeys = ['soal', 'pertanyaan', 'question', 'str', 'deskripsi', 'description', 'caption', 'teks', 'text', 'tanya'];
    for (const k of soalKeys) {
        if (p[k] && typeof p[k] === 'string' && p[k].trim()) return p[k].trim();
    }
    // Fallback: cari string terpanjang
    let longest = '';
    for (const [key, val] of Object.entries(p)) {
        if (SKIP_KEYS.includes(key.toLowerCase())) continue;
        if (typeof val === 'string' && val.length > longest.length && val.length > 5) {
            longest = val;
        }
    }
    return longest;
};

// ─── EKSTRAK JAWABAN ───
const extractAnswer = (data) => {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return data.map(String);
    if (typeof data === 'object') {
        const keys = ['jawaban', 'answer', 'hasil', 'jawab', 'kunci', 'correct', 'value', 'text', 'nama', 'name'];
        for (const k of keys) {
            if (data[k] !== undefined && data[k] !== null && data[k] !== '') {
                return data[k];
            }
        }
    }
    return '';
};

// ─── EKSTRAK CLUE ───
const extractClue = (p) => {
    const clueKeys = ['bantuan', 'clue', 'hint', 'tipe', 'kategori', 'category', 'petunjuk'];
    for (const k of clueKeys) {
        if (p[k] && typeof p[k] === 'string' && p[k].trim()) return p[k].trim();
    }
    return '';
};

export default {
    command: ['tebaktebakan'],
    category: 'game',
    execute: async (denn, m) => {
        const chatId = m.chat;

        if (global.tebaktebakanGames[chatId]) {
            return sendFakeQuoted(denn, m, 
                `⚠️ Masih ada game Tebak-tebakan yang belum dijawab di chat ini!\nSelesaikan atau ketik *nyerah* terlebih dahulu.`, 
                { title: 'Game Sedang Berjalan', body: 'Selesaikan game sebelumnya' }
            );
        }

        await denn.sendMessage(m.chat, { react: { text: "⏳", key: m.key } });

        try {
            const apiUrl = `${global.jereBaseUrl}/api/game/tebaktebakan?apikey=${global.jereApiKey}`;
            const res = await axios.get(apiUrl, { timeout: 15000 });
            const json = res.data;

            if (!json.status || !json.result) {
                throw new Error(json.error || json.message || "Gagal mengambil soal game dari server");
            }

            let p = json.result;
            if (Array.isArray(p)) p = p[0] || {};
            
            // Debug log
            console.log('[TebakTebakan] Full Response:', JSON.stringify(json, null, 2));

            const soalText = extractSoal(p);
            const clueText = extractClue(p);
            const rawAnswer = extractAnswer(p);
            
            // ─── VALIDASI & DEBUG MODE ───
            if (!soalText || !rawAnswer) {
                const preview = JSON.stringify(p, null, 2).slice(0, 800);
                
                return sendFakeQuoted(denn, m, 
                    `⚠️ *API TEBAK-TEBAKAN BERUBAH*\n\n` +
                    `Struktur JSON tidak dikenali oleh bot.\n\n` +
                    `📋 *Preview Response:*\n\`\`\`json\n${preview}\n\`\`\`\n\n` +
                    `_Kirim pesan ini ke Owner agar bot diperbaiki._`, 
                    { title: 'Debug API', body: 'Struktur JSON tidak valid' }
                );
            }

            const answerArray = Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer];

            let text = `🎮 *TEBAK-TEBAKAN*\n\n`;
            text += `📝 *Soal:* ${soalText}\n`;
            if (clueText) text += `💡 *Petunjuk:* ${clueText}\n`;
            text += `\n⏰ *Waktu:* 60 detik\n`;
            text += `🎁 *Hadiah:* +500 XP & +10 Koin\n\n`;
            text += `💡 *Cara Jawab:* Balas (reply) pesan soal ini dengan jawabanmu.\n`;
            text += `Ketik *nyerah* untuk menyerah.`;

            const sentQuestion = await sendFakeQuoted(denn, m, text.trim(), {
                title: 'Tebak-tebakan',
                body: 'Balas pesan ini untuk menjawab!'
            });
            
            const questionMsgId = sentQuestion?.key?.id;

            const listener = async (socket, msg, body) => {
                if (msg.key.fromMe) return false;

                const userAnswer = normalize(body);
                const quotedId = msg.quoted?.key?.id;

                if (userAnswer === 'nyerah') {
                    clearTimeout(global.tebaktebakanGames[chatId]?.timeout);
                    delete global.tebaktebakanGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    const ansDisplay = answerArray.join(' / ');
                    await sendFakeQuoted(socket, msg, `🏳️ Kamu menyerah!\n\nJawabannya adalah: *${ansDisplay}*`, {
                        title: 'Game Berakhir', body: 'Kamu menyerah'
                    });
                    return true;
                }

                if (quotedId !== questionMsgId) return false;

                const isCorrect = answerArray.some(ans => normalize(ans) === userAnswer);

                if (isCorrect) {
                    clearTimeout(global.tebaktebakanGames[chatId]?.timeout);
                    delete global.tebaktebakanGames[chatId];
                    global.passiveListeners.delete(chatId);

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
                    await socket.sendMessage(msg.chat, { react: { text: '❌', key: msg.key } }).catch(() => {});
                    
                    const wrongKey = `${chatId}_${msg.sender}`;
                    const now = Date.now();
                    const lastWrong = global.tebaktebakanWrongCd[wrongKey] || 0;
                    
                    if (now - lastWrong > 3000) {
                        global.tebaktebakanWrongCd[wrongKey] = now;
                        await socket.sendMessage(msg.chat, { 
                            text: `❌ Jawaban salah, coba lagi!` 
                        }, { quoted: msg }).catch(() => {});
                    }
                    return true;
                }
            };

            global.passiveListeners.set(chatId, listener);

            const timeout = setTimeout(async () => {
                if (global.tebaktebakanGames[chatId]) {
                    delete global.tebaktebakanGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    const ansDisplay = answerArray.join(' / ');
                    await sendFakeQuoted(denn, m, `⏳ *WAKTU HABIS!*\n\nJawabannya adalah: *${ansDisplay}*`, {
                        title: 'Waktu Habis', body: 'Game berakhir'
                    });
                }
            }, 60000);

            global.tebaktebakanGames[chatId] = { answer: answerArray, timeout, msgId: questionMsgId };

            await denn.sendMessage(m.chat, { react: { text: "✅", key: m.key } });

        } catch (e) {
            global.passiveListeners.delete(chatId);
            await denn.sendMessage(m.chat, { react: { text: "❌", key: m.key } }).catch(() => {});
            console.error('[Game TebakTebakan Error]', e.message);
            sendFakeQuoted(denn, m, `❌ Error: ${e.message || "Gagal memulai game"}`, {
                title: 'Game Error', body: 'Terjadi kesalahan pada server'
            });
        }
    }
};