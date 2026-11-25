import axios from 'axios';
import { sendFakeQuoted } from '../../lib/fakequoted.js';
import { getUser, saveUser, addXP, formatMoney } from '../../lib/rpg.js';

if (!global.caklontongGames) global.caklontongGames = {};
if (!global.caklontongWrongCd) global.caklontongWrongCd = {};

const normalize = (text) => {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const extractAnswer = (data) => {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return data.map(String);
    if (typeof data === 'object') {
        return data.value || data.text || data.jawaban || data.answer || '';
    }
    return String(data);
};

export default {
    command: ['caklontong'],
    category: 'game',
    execute: async (denn, m) => {
        const chatId = m.chat;

        if (global.caklontongGames[chatId]) {
            return sendFakeQuoted(denn, m, 
                `⚠️ Masih ada game Cak Lontong yang belum dijawab di chat ini!\nSelesaikan atau ketik *nyerah* terlebih dahulu.`, 
                { title: 'Game Sedang Berjalan', body: 'Selesaikan game sebelumnya' }
            );
        }

        await denn.sendMessage(m.chat, { react: { text: "⏳", key: m.key } });

        try {
            const apiUrl = `${global.jereBaseUrl}/api/game/caklontong?apikey=${global.jereApiKey}`;
            const res = await axios.get(apiUrl, { timeout: 15000 });
            const json = res.data;

            if (!json.status || !json.result) {
                throw new Error(json.error || json.message || "Gagal mengambil soal game dari server");
            }

            let p = json.result;
            if (Array.isArray(p)) p = p[0] || {};
            if (typeof p !== 'object') throw new Error('Format response API tidak valid');

            const soalText = p.soal || p.pertanyaan || p.str || p.deskripsi || p.caption || "Tebak jawaban dari petunjuk berikut:";
            const clueText = p.bantuan || p.clue || p.tipe || '';
            
            let rawAnswer = extractAnswer(p.jawaban !== undefined ? p.jawaban : (p.result !== undefined ? p.result : (p.nama || p.name || p.title)));
            
            if (!rawAnswer || (Array.isArray(rawAnswer) && rawAnswer.length === 0) || (typeof rawAnswer === 'string' && rawAnswer.trim() === '')) {
                throw new Error('API tidak mengembalikan jawaban yang valid. Coba lagi.');
            }

            const answerArray = Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer];

            let text = `🎮 *KUIS CAK LONTONG*\n\n`;
            text += `📝 *Soal:* ${soalText}\n`;
            if (clueText) text += `💡 *Petunjuk:* ${clueText}\n`;
            text += `\n⏰ *Waktu:* 60 detik\n`;
            text += `🎁 *Hadiah:* +500 XP & +10 Koin\n\n`;
            text += `💡 *Cara Jawab:* Balas (reply) pesan soal ini dengan jawabanmu.\n`;
            text += `Ketik *nyerah* untuk menyerah.`;

            // Kirim Soal dan Simpan ID Pesannya
            const sentQuestion = await sendFakeQuoted(denn, m, text.trim(), {
                title: 'Kuis Cak Lontong',
                body: 'Balas pesan ini untuk menjawab!'
            });
            
            // Ambil ID pesan soal yang baru saja dikirim bot
            const questionMsgId = sentQuestion?.key?.id;

            const listener = async (socket, msg, body) => {
                if (msg.key.fromMe) return false;

                const userAnswer = normalize(body);
                const quotedId = msg.quoted?.key?.id;
                
                // ─── CEK APAKAH USER ME-REPLY PESAN SOAL BOT ───
                const isReplyingToQuestion = quotedId === questionMsgId;

                // Cek nyerah (boleh tanpa nge-reply)
                if (userAnswer === 'nyerah') {
                    clearTimeout(global.caklontongGames[chatId]?.timeout);
                    delete global.caklontongGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    const ansDisplay = answerArray.join(' / ');
                    await sendFakeQuoted(socket, msg, `🏳️ Kamu menyerah!\n\nJawabannya adalah: *${ansDisplay}*`, {
                        title: 'Game Berakhir', body: 'Kamu menyerah'
                    });
                    return true;
                }

                // Jika bukan balasan ke pesan soal, biarkan pesan lewat (dianggap chat biasa)
                if (!isReplyingToQuestion) {
                    return false; 
                }

                // Jika user me-reply pesan soal, cek jawabannya
                const isCorrect = answerArray.some(ans => normalize(ans) === userAnswer);

                if (isCorrect) {
                    clearTimeout(global.caklontongGames[chatId]?.timeout);
                    delete global.caklontongGames[chatId];
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
                    const lastWrong = global.caklontongWrongCd[wrongKey] || 0;
                    
                    if (now - lastWrong > 3000) {
                        global.caklontongWrongCd[wrongKey] = now;
                        await socket.sendMessage(msg.chat, { 
                            text: `❌ Jawaban salah, coba lagi!` 
                        }, { quoted: msg }).catch(() => {});
                    }
                    return true;
                }
            };

            global.passiveListeners.set(chatId, listener);

            const timeout = setTimeout(async () => {
                if (global.caklontongGames[chatId]) {
                    delete global.caklontongGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    const ansDisplay = answerArray.join(' / ');
                    await sendFakeQuoted(denn, m, `⏳ *WAKTU HABIS!*\n\nJawabannya adalah: *${ansDisplay}*`, {
                        title: 'Waktu Habis', body: 'Game berakhir'
                    });
                }
            }, 60000);

            global.caklontongGames[chatId] = { 
                answer: answerArray, 
                timeout,
                msgId: questionMsgId 
            };

            await denn.sendMessage(m.chat, { react: { text: "✅", key: m.key } });

        } catch (e) {
            global.passiveListeners.delete(chatId);
            await denn.sendMessage(m.chat, { react: { text: "❌", key: m.key } }).catch(() => {});
            console.error('[Game CakLontong Error]', e.message);
            sendFakeQuoted(denn, m, `❌ Error: ${e.message || "Gagal memulai game"}`, {
                title: 'Game Error', body: 'Terjadi kesalahan pada server'
            });
        }
    }
};