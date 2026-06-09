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
app.get('/', (req, res) => res.send('Guess The Location & Counting Engines Active.'));
app.listen(process.env.PORT || 3000);

// ⚙️ GAME CHANNEL CONFIGURATIONS
const locationChannelId = '1506139329536327765'; 
const countingChannelId = '1513457479042990100'; 

// 🌎 LOCATION GAME POOL
const pool = [
    { country: 'France', url: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800' },
    { country: 'China', url: 'https://images.unsplash.com/photo-1508672019048-805c876b67e2?w=800' },
    { country: 'Japan', url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800' },
    { country: 'Egypt', url: 'https://images.unsplash.com/photo-1539650116574-8efeb43e2750?w=800' },
    { country: 'America', url: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800' },
    { country: 'Russia', url: 'https://images.unsplash.com/photo-1512495039889-52a3b799c9bc?w=800' },
    { country: 'Mexico', url: 'https://images.unsplash.com/photo-1512813583145-baaa340ef29f?w=800' },
    { country: 'Morocco', url: 'https://images.unsplash.com/photo-1489749798305-4fea3ae63d43?w=800' }
];

// 🎮 LOCATION STATE CONTROLLERS
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

// 📦 Helper: Database File Handlers with Race Protection
const writeQueues = {};
function loadJSON(file, defaultData = {}) {
    try {
        if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData));
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return defaultData;
    }
}

function saveJSON(file, data) {
    if (!writeQueues[file]) writeQueues[file] = Promise.resolve();
    writeQueues[file] = writeQueues[file].then(() => {
        return fs.promises.writeFile(file, JSON.stringify(data, null, 4), 'utf8').catch(() => {});
    });
}

// 🔢 COUNTING STATE CONTROLLERS
let countState = loadJSON('./counting.json', { currentCount: 0, lastCounterId: null });
let countingLock = false; 

// ────────────────────────────────────────────────────────
// LOCATION GAME ENGINE: ROUND MANAGER
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
    console.log(`🤖 Unified Game Engine connected as ${client.user.tag}`);
    
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
        console.error('Failed to register slash commands:', cmdErr);
    }
    
    try {
        const locationChannel = await client.channels.fetch(locationChannelId);
        if (locationChannel) {
            const messages = await locationChannel.messages.fetch({ limit: 15 });
            const botMessages = messages.filter(m => m.author.id === client.user.id);
            const purgeQueue = [];
            
            for (const m of botMessages.values()) {
                if (Date.now() - m.createdTimestamp < 1209600000) {
                    purgeQueue.push(m.delete().catch(() => {}));
                }
            }
            await Promise.all(purgeQueue);
            await startNewRound(locationChannel);
        }
    } catch (e) {
        console.error('Error initiating location engine:', e);
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
            return interaction.reply({ content: '🏜️ The leaderboard is currently empty!', ephemeral: false });
        }

        const leaderboardEmbed = new EmbedBuilder().setColor('#FEE75C').setTitle('🏆 Guess the Location Leaderboard');
        let rowsText = '';
        const medals = ['🏆1', '🥈2', '🥉3', '4', '5', '6', '7', '8', '9', '10'];
        sorted.forEach((player, index) => {
            rowsText += `**${medals[index]}.** <@${player.userId}> — \`${player.pts} Points\`\n`;
        });
        leaderboardEmbed.setDescription(rowsText);
        return interaction.reply({ embeds: [leaderboardEmbed] });
    }

    if (!interaction.isButton()) return;
    const interactionChannel = interaction.channel;
    if (interactionChannel.id !== locationChannelId) return;

    if (interaction.customId === 'game_hint') {
        if (!currentRound.active || currentRound.processingPayout) return interaction.deferUpdate();
        
        await interaction.deferUpdate().catch(() => {});
        currentRound.pointsValue = 1; 

        const msg = await interactionChannel.messages.fetch(currentRound.mainMessageId).catch(() => null);
        if (msg) {
            const updatedEmbed = EmbedBuilder.from(msg.embeds[0]).setDescription('First person to guess correctly gets **1 Point!**');
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('game_hint_given').setLabel('Hint Given').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('game_skip').setLabel('Skip').setStyle(ButtonStyle.Danger)
            );
            await msg.edit({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => {});
        }

        const hintMsg = await interactionChannel.send({ content: `## *<@${interaction.user.id}> requested a hint!*\n**${currentRound.country.charAt(0)}**`, allowedMentions: { parse: [] } });
        currentRound.hintMessageId = hintMsg.id;
        return;
    }

    if (interaction.customId === 'game_skip') {
        const uId = interaction.user.id;
        const now = Date.now();
        if (!skipTrackers[uId]) skipTrackers[uId] = [];
        skipTrackers[uId] = skipTrackers[uId].filter(t => now - t < 3600000);

        if (skipTrackers[uId].length >= 3) {
            return interaction.reply({ content: `⚠️ Skip limit reached! Try again <t:${Math.floor((skipTrackers[uId][0] + 3600000) / 1000)}:R>.`, ephemeral: true });
        }

        await interaction.deferUpdate().catch(() => {});
        skipTrackers[uId].push(now);
        currentRound.active = false;
        
        const targetMainId = currentRound.mainMessageId;
        const targetHintId = currentRound.hintMessageId;
        
        if (targetMainId) await interactionChannel.messages.delete(targetMainId).catch(() => {});
        if (targetHintId) await interactionChannel.messages.delete(targetHintId).catch(() => {});
        await startNewRound(interactionChannel);
        return;
    }
});

// ────────────────────────────────────────────────────────
// ANTI-CHEAT CONTROLLER: WATCHES FOR EDITED MESSAGES
// ────────────────────────────────────────────────────────
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.channel.id !== countingChannelId) return;

    // Instantly vaporize edited messages inside the counting channel
    try {
        await newMessage.delete().catch(() => {});
    } catch (e) {}
});

// ────────────────────────────────────────────────────────
// CORE ROUTER: ROUTE MESSAGES TO CORRECT GAME LISTENER
// ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
    // If your own bot sent it, ignore completely to prevent recursion loops
    if (message.author.id === client.user.id) return;

    // PATHWAY A: LOCATION CHANNEL
    if (message.channel.id === locationChannelId) {
        // Prevent other bots from cluttering the guessing stream
        if (message.author.bot) {
            return message.delete().catch(() => {});
        }

        if (!currentRound.active || currentRound.processingPayout) {
            return setTimeout(() => message.delete().catch(() => {}), 500);
        }
         
        const guess = message.content.trim().toLowerCase();
        const solution = currentRound.country.toLowerCase();

        if (guess === solution) {
            currentRound.active = false; 
            currentRound.processingPayout = true; 
            try {
                await message.react('✅').catch(() => {});
                const leaderboard = loadJSON('./leaderboard.json');
                leaderboard[message.author.id] = (leaderboard[message.author.id] || 0) + currentRound.pointsValue;
                saveJSON('./leaderboard.json', leaderboard);

                const targetMainId = currentRound.mainMessageId;
                const targetHintId = currentRound.hintMessageId;

                setTimeout(async () => {
                    const cleanup = [message.delete().catch(() => {})];
                    if (targetMainId) {
                        cleanup.push(message.channel.messages.fetch(targetMainId).then(m => m.delete()).catch(() => {}));
                    }
                    if (targetHintId) {
                        cleanup.push(message.channel.messages.fetch(targetHintId).then(m => m.delete()).catch(() => {}));
                    }
                    await Promise.all(cleanup);
                    await startNewRound(message.channel);
                }, 1500);
            } catch (err) {}
            return;
        }

        try {
            await message.react('❌').catch(() => {});
            setTimeout(() => message.delete().catch(() => {}), 3000);
        } catch (e) {}
    }

    // PATHWAY B: COUNTING CHANNEL
    if (message.channel.id === countingChannelId) {
        // Goodbye, automated hourly spam bots!
        if (message.author.bot) {
            return message.delete().catch(() => {});
        }

        if (countingLock) {
            return message.delete().catch(() => {}); 
        }

        countingLock = true; 

        try {
            const inputString = message.content.trim();
            
            // RULE 1: Pure digits check
            if (!/^\d+$/.test(inputString)) {
                await message.react('❌').catch(() => {});
                setTimeout(() => message.delete().catch(() => {}), 3000);
                countingLock = false; 
                return;
            }

            const parsedNumber = parseInt(inputString, 10);
            const nextTargetNumber = countState.currentCount + 1;

            // RULE 2: Double-Count Violation
            if (message.author.id === countState.lastCounterId) {
                await message.react('⚠️').catch(() => {});
                setTimeout(() => message.delete().catch(() => {}), 3000);
                countingLock = false; 
                return;
            }

            // RULE 3: Valid Sequential Count Entry
            if (parsedNumber === nextTargetNumber) {
                countState.currentCount = nextTargetNumber;
                countState.lastCounterId = message.author.id;
                saveJSON('./counting.json', countState);

                const reaction = await message.react('✅').catch(() => {});
                if (reaction && reaction.users) {
                    setTimeout(async () => {
                        await reaction.users.remove(client.user.id).catch(() => {});
                    }, 3000); 
                }
                countingLock = false; 
                return;
            }

            // RULE 4: Incorrect Number Choice (No Reset)
            await message.react('❌').catch(() => {});
            setTimeout(() => message.delete().catch(() => {}), 3000);

        } catch (e) {
            console.error('Error handling counting system sequence:', e);
        } finally {
            countingLock = false; 
        }
    }
});

client.login(process.env.TOKEN);
