import axios from 'axios';
import { sendFakeQuoted } from '../../lib/fakequoted.js';
import { getUser, saveUser, addXP, formatMoney } from '../../lib/rpg.js';

// Tempat menyimpan status game yang sedang berjalan
if (!global.mathsGames) global.mathsGames = {};

export default {
    command: ['math'],
    category: 'game',
    execute: async (denn, m, { prefix }) => {
        const chatId = m.chat;

        // Cek jika masih ada game berjalan di chat ini
        if (global.mathsGames[chatId]) {
            return sendFakeQuoted(denn, m, 
                `⚠️ Masih ada game matematika yang belum dijawab di chat ini!\nSelesaikan atau ketik *nyerah* terlebih dahulu.`, 
                { title: 'Game Sedang Berjalan', body: 'Selesaikan game sebelumnya' }
            );
        }

        await denn.sendMessage(m.chat, { react: { text: "⏳", key: m.key } });

        try {
            const apiUrl = `${global.jereBaseUrl}/api/game/maths?apikey=${global.jereApiKey}`;
            const res = await axios.get(apiUrl, { timeout: 15000 });
            const json = res.data;

            if (!json.status || !json.result) {
                throw new Error(json.error || json.message || "Gagal mengambil soal game dari server");
            }

            const p = json.result;
            const soalText = p.soal || p.pertanyaan || p.str || p.deskripsi || p.caption || "Tebak jawaban dari petunjuk berikut:";
            const answerData = p.jawaban !== undefined ? p.jawaban : (p.result !== undefined ? p.result : (p.nama || p.name || p.title || ''));
            const clueText = p.bantuan || p.clue || p.tipe || '';

            let text = `🎮 *TANTANGAN MATEMATIKA*\n\n`;
            text += `📝 *Soal:* ${soalText}\n`;
            if (clueText) text += `💡 *Petunjuk:* ${clueText}\n`;
            text += `\n⏰ *Waktu:* 60 detik\n`;
            text += `🎁 *Hadiah:* +500 XP & +10 Koin\n\n`;
            text += `Balas (reply) pesan ini untuk menjawab!\n`;
            text += `Ketik *nyerah* untuk menyerah.`;

            await sendFakeQuoted(denn, m, text.trim(), {
                title: 'Tantangan Matematika',
                body: 'Jawab soal ini untuk mendapat hadiah!'
            });

            // ─── FUNGSI PASSIVE LISTENER UNTUK MENJAWAB ───
            const listener = async (socket, msg, body) => {
                const lowerBody = body.toLowerCase().trim();
                
                // Jika user menyerah
                if (lowerBody === 'nyerah') {
                    clearTimeout(global.mathsGames[chatId].timeout);
                    delete global.mathsGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    const ansDisplay = Array.isArray(answerData) ? answerData.join(' / ') : answerData;
                    await sendFakeQuoted(socket, msg, `🏳️ Kamu menyerah!\n\nJawabannya adalah: *${ansDisplay}*`, {
                        title: 'Game Berakhir',
                        body: 'Kamu menyerah'
                    });
                    return true;
                }

                // Cek apakah jawaban benar
                let isCorrect = false;
                if (Array.isArray(answerData)) {
                    isCorrect = answerData.map(a => String(a).toLowerCase().trim()).includes(lowerBody);
                } else {
                    isCorrect = String(answerData).toLowerCase().trim() === lowerBody;
                }

                if (isCorrect) {
                    clearTimeout(global.mathsGames[chatId].timeout);
                    delete global.mathsGames[chatId];
                    global.passiveListeners.delete(chatId);

                    // Berikan hadiah RPG
                    const user = getUser(msg.sender);
                    user.money = (user.money || 0) + 10;
                    saveUser(msg.sender, user);
                    addXP(msg.sender, 500);
                    const updated = getUser(msg.sender);

                    await sendFakeQuoted(socket, msg, 
                        `🎉 *BENAR!*\n\nJawaban kamu tepat!\n\n` +
                        `🎁 *Hadiah:*\n` +
                        `💰 Uang: +${formatMoney(10)}\n` +
                        `⭐ XP: +500\n\n` +
                        `💵 Dompet sekarang: ${formatMoney(updated.money)}`, 
                        { title: 'Jawaban Benar!', body: 'Kamu mendapatkan hadiah' }
                    );
                    return true;
                }
                return false;
            };

            // Daftarkan listener
            global.passiveListeners.set(chatId, listener);

            // Timer waktu habis (60 detik)
            const timeout = setTimeout(async () => {
                if (global.mathsGames[chatId]) {
                    delete global.mathsGames[chatId];
                    global.passiveListeners.delete(chatId);
                    
                    const ansDisplay = Array.isArray(answerData) ? answerData.join(' / ') : answerData;
                    await sendFakeQuoted(denn, m, `⏳ *WAKTU HABIS!*\n\nJawabannya adalah: *${ansDisplay}*`, {
                        title: 'Waktu Habis',
                        body: 'Game berakhir'
                    });
                }
            }, 60000);

            // Simpan state game
            global.mathsGames[chatId] = {
                answer: answerData,
                timeout
            };

            await denn.sendMessage(m.chat, { react: { text: "✅", key: m.key } });

        } catch (e) {
            await denn.sendMessage(m.chat, { react: { text: "❌", key: m.key } }).catch(() => {});
            console.error('[Game Maths Error]', e.message);
            sendFakeQuoted(denn, m, `❌ Error: ${e.message || "Gagal memulai game"}`, {
                title: 'Game Error',
                body: 'Terjadi kesalahan pada server'
            });
        }
    }
};