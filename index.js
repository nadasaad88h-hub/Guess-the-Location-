const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const app = express();
app.get('/', (req, res) => res.send('Guess The Location Game Engine Active.'));
app.listen(process.env.PORT || 3000);

// ⚙️ GAME CONFIGURATIONS
const targetChannelId = '1506139329536327765'; 

// 🌎 ALL UNIQUE, VALIDATED IMAGE URLS
const pool = [
    { country: 'France', url: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800' },     // Eiffel Tower
    { country: 'China', url: 'https://images.unsplash.com/photo-1508672019048-805c876b67e2?w=800' },      // Great Wall
    { country: 'Japan', url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800' },      // Pagoda & Mt. Fuji
    { country: 'Egypt', url: 'https://images.unsplash.com/photo-1539650116574-8efeb43e2750?w=800' },      // Giza Pyramids
    { country: 'America', url: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800' },    // New York Times Square
    { country: 'Russia', url: 'https://images.unsplash.com/photo-1512495039889-52a3b799c9bc?w=800' },      // St. Basil's Cathedral
    { country: 'Mexico', url: 'https://images.unsplash.com/photo-1512813583145-baaa340ef29f?w=800' },      // Chichen Itza Pyramid
    { country: 'Morocco', url: 'https://images.unsplash.com/photo-1489749798305-4fea3ae63d43?w=800' }     // Unique Ait Benhaddou Kasbah
];

// 🎮 STATE CONTROLLERS
let currentRound = {
    country: '',
    url: '',
    pointsValue: 2,
    active: false,
    mainMessageId: null,
    hintMessageId: null,
    processingPayout: false 
};

let skipTrackers = {}; 

// 📦 Helper: Database File Handlers
function loadJSON(file, defaultData = {}) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData));
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 4));
}

// ────────────────────────────────────────────────────────
// CORE GAME ENGINE: ROUND MANAGER
// ────────────────────────────────────────────────────────
async function startNewRound(channel) {
    const selection = pool[Math.floor(Math.random() * pool.length)];
    
    currentRound.country = selection.country;
    currentRound.url = selection.url;
    currentRound.pointsValue = 2;
    currentRound.active = true;
    currentRound.hintMessageId = null;
    currentRound.processingPayout = false; 

    const gameEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🌎 Guess the place!')
        .setDescription('First person to guess correctly gets **2 Points!**')
        .setImage(selection.url);

    const interactiveRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('game_hint').setLabel('Hint').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('game_skip').setLabel('Skip').setStyle(ButtonStyle.Danger)
    );

    const msg = await channel.send({ embeds: [gameEmbed], components: [interactiveRow] });
    currentRound.mainMessageId = msg.id;
}

// ────────────────────────────────────────────────────────
// APP BOOTSTRAP INITIALIZATION LOOP
// ────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`🤖 Game engine connected as ${client.user.tag}`);
    
    // Auto-Register the slash command natively on boot
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        const commands = [
            new SlashCommandBuilder()
                .setName('check_leaderboard')
                .setDescription('View the top 10 players on the Location Leaderboard')
        ].map(command => command.toJSON());

        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Global slash commands deployed safely.');
    } catch (cmdErr) {
        console.error('Failed to register application slash commands:', cmdErr);
    }
    
    try {
        const channel = await client.channels.fetch(targetChannelId);
        if (channel) {
            const messages = await channel.messages.fetch({ limit: 15 });
            const botMessages = messages.filter(m => m.author.id === client.user.id);
            
            for (const m of botMessages.values()) {
                if (Date.now() - m.createdTimestamp < 1209600000) {
                    await m.delete().catch(() => {});
                }
            }
            
            await startNewRound(channel);
        }
    } catch (e) {
        console.error('Error initiating game boot sequence:', e);
    }
});

// ────────────────────────────────────────────────────────
// INTERACTION CONTROLLER (BUTTONS & LEADERBOARDS)
// ────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    
    if (interaction.isChatInputCommand() && interaction.commandName === 'check_leaderboard') {
        const scores = loadJSON('./leaderboard.json');
        
        const sorted = Object.entries(scores)
            .map(([userId, pts]) => ({ userId, pts }))
            .sort((a, b) => b.pts - a.pts)
            .slice(0, 10);

        if (sorted.length === 0) {
            return interaction.reply({ content: '🏜️ The leaderboard is currently empty! Be the first to guess right!', ephemeral: false });
        }

        const leaderboardEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('🏆 Guess the Location Leaderboard');

        let rowsText = '';
        const medals = ['🏆1', '🥈2', '🥉3', '4', '5', '6', '7', '8', '9', '10'];

        sorted.forEach((player, index) => {
            rowsText += `**${medals[index]}.** <@${player.userId}> — \`${player.pts} Points\`\n`;
        });

        leaderboardEmbed.setDescription(rowsText);
        return interaction.reply({ embeds: [leaderboardEmbed] });
    }

    if (!interaction.isButton()) return;

    const channel = interaction.channel;
    if (channel.id !== targetChannelId) return;

    // HINT PROCESSOR
    if (interaction.customId === 'game_hint') {
        if (!currentRound.active) return interaction.deferUpdate();

        currentRound.pointsValue = 1; 

        const msg = await channel.messages.fetch(currentRound.mainMessageId).catch(() => null);
        if (msg) {
            const oldEmbed = msg.embeds[0];
            const updatedEmbed = EmbedBuilder.from(oldEmbed).setDescription('First person to guess correctly gets **1 Point!**');
            
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('game_hint_given').setLabel('Hint Given').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('game_skip').setLabel('Skip').setStyle(ButtonStyle.Danger)
            );
            await msg.edit({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => {});
        }

        const firstLetter = currentRound.country.charAt(0);
        const hintMsg = await channel.send({
            content: `## *<@${interaction.user.id}> has Requested for a hint!*\n**${firstLetter}**`,
            allowedMentions: { parse: [] }
        });
        currentRound.hintMessageId = hintMsg.id;
        
        return interaction.deferUpdate();
    }

    // SKIP PROCESSOR
    if (interaction.customId === 'game_skip') {
        const uId = interaction.user.id;
        const now = Date.now();
        const oneHourMs = 3600000;

        if (!skipTrackers[uId]) skipTrackers[uId] = [];
        skipTrackers[uId] = skipTrackers[uId].filter(timestamp => now - timestamp < oneHourMs);

        if (skipTrackers[uId].length >= 3) {
            const oldestValidSkip = skipTrackers[uId][0];
            const expiryTime = oldestValidSkip + oneHourMs;
            const minutesLeft = Math.ceil((expiryTime - now) / 60000);

            return interaction.reply({
                content: `⚠️ You have reached your skip limit! You may retry again at <t:${Math.floor(expiryTime / 1000)}:R> (${minutesLeft} minutes left).`,
                ephemeral: true
            });
        }

        skipTrackers[uId].push(now);
        currentRound.active = false;

        if (currentRound.mainMessageId) await channel.messages.delete(currentRound.mainMessageId).catch(() => {});
        if (currentRound.hintMessageId) await channel.messages.delete(currentRound.hintMessageId).catch(() => {});

        await startNewRound(channel);
        return interaction.deferUpdate();
    }
});

// ────────────────────────────────────────────────────────
// LIVE CHAT GUESS VALIDATION PATTERN
// ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== targetChannelId) return;
    if (!currentRound.active || currentRound.processingPayout) return; 

    const guess = message.content.trim().toLowerCase();
    const solution = currentRound.country.toLowerCase();

    // MATCH FOUND (CORRECT ANSWER)
    if (guess === solution) {
        currentRound.active = false; 
        currentRound.processingPayout = true; 

        try {
            await message.react('✅');

            const leaderboard = loadJSON('./leaderboard.json');
            leaderboard[message.author.id] = (leaderboard[message.author.id] || 0) + currentRound.pointsValue;
            saveJSON('./leaderboard.json', leaderboard);

            setTimeout(async () => {
                // Clear all elements concurrently to prevent promise blockages
                const cleanupPromises = [message.delete().catch(() => {})];
                
                if (currentRound.mainMessageId) {
                    cleanupPromises.push(
                        message.channel.messages.fetch(currentRound.mainMessageId)
                            .then(m => m.delete())
                            .catch(() => {})
                    );
                }
                if (currentRound.hintMessageId) {
                    cleanupPromises.push(
                        message.channel.messages.fetch(currentRound.hintMessageId)
                            .then(m => m.delete())
                            .catch(() => {})
                    );
                }
                
                await Promise.all(cleanupPromises);
                await startNewRound(message.channel);
            }, 1500);

        } catch (err) {
            console.error('Anti-race handling encounter:', err);
        }
        return;
    }

    // WRONG GUESS HANDLING (Cleans up invalid guesses smoothly)
    try {
        await message.react('❌');
        setTimeout(async () => {
            await message.delete().catch(() => {});
        }, 3000);
    } catch (e) {}
});

client.login(process.env.TOKEN);
