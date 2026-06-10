const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    REST, 
    Routes, 
    SlashCommandBuilder 
} = require('discord.js');
const express = require('express');
const fs = require('fs');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember] 
});

const app = express();
app.get('/', (req, res) => res.send('Guess The Location & Counting Engines Active.'));

// ⚙️ GAME CHANNEL & ROLE CONFIGURATIONS
const locationChannelId = '1506139329536327765'; 
const countingChannelId = '1513457479042990100'; 
const staffRoleId = '1514130861568819242'; 

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
let lastPickedCountry = ''; // Prevents the same country from appearing twice in a row

let currentRound = {
    id: 0, 
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
let countState = loadJSON('./counting.json', { currentCount: 29, lastCounterId: null });
let countingLock = false; 

// Track automated bot deletions to prevent the ghost detector from firing on rule breakers
const botDeletedMessageIds = new Set();

// Safely delete messages without crashing on missing message objects
async function safeDelete(channel, messageId) {
    if (!channel || !messageId) return;
    try {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
    } catch (e) {}
}

// ────────────────────────────────────────────────────────
// LOCATION GAME ENGINE: ROUND MANAGER
// ────────────────────────────────────────────────────────
async function startNewRound(channel) {
    if (!channel) return;
    try {
       let selection;
do {
    selection = pool[Math.floor(Math.random() * pool.length)];
} while (selection.country === lastPickedCountry && pool.length > 1);

lastPickedCountry = selection.country; // Update the history tracker

        currentRound.id = Date.now(); 
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
    } catch (err) {
        console.error('Failed to spin up a new round:', err);
    }
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
                .setDescription('View the top 10 players on the Location Leaderboard'),
            new SlashCommandBuilder()
                .setName('restart_game')
                .setDescription('Force-skips the current location round (Staff Only)')
        ].map(command => command.toJSON());

        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Global slash commands deployed safely.');
    } catch (cmdErr) {
        console.error('Failed to register slash commands:', cmdErr);
    }
    
    try {
        const locationChannel = await client.channels.fetch(locationChannelId).catch(() => null);
        if (locationChannel && locationChannel.isTextBased()) {
            const messages = await locationChannel.messages.fetch({ limit: 15 }).catch(() => []);
            if (messages.size > 0) {
                const botMessages = messages.filter(m => m.author.id === client.user.id);
                for (const m of botMessages.values()) {
                    if (Date.now() - m.createdTimestamp < 1209600000) {
                        await m.delete().catch(() => {});
                    }
                }
            }
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
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'check_leaderboard') {
                const scores = loadJSON('./leaderboard.json');
                
                const sorted = Object.entries(scores)
                    .map(([userId, pts]) => ({ userId, pts: Number(pts) }))
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

            if (interaction.commandName === 'restart_game') {
                if (!interaction.member.roles.cache.has(staffRoleId)) {
                    return interaction.reply({ content: '⚠️ You do not have the required staff role to run this command.', ephemeral: true });
                }

                // FIX: Complete state release on forceful engine clear
                currentRound.active = false;
                currentRound.processingPayout = false;
                const interactionChannel = interaction.channel;
                
                await safeDelete(interactionChannel, currentRound.mainMessageId);
                await safeDelete(interactionChannel, currentRound.hintMessageId);
                
                await interaction.reply({ content: '🔄 Staff member forced a round restart. Spinning up a new location...', ephemeral: true });
                await startNewRound(interactionChannel);
                return;
            }
        }

        if (!interaction.isButton()) return;
        
        const interactionChannel = interaction.channel;
        if (!interactionChannel || interactionChannel.id !== locationChannelId) return;

        if (interaction.customId === 'game_hint') {
            if (!currentRound.active || currentRound.processingPayout) {
                return interaction.deferUpdate().catch(() => {});
            }
            
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

            const hintMsg = await interactionChannel.send({ 
                content: `## *<@${interaction.user.id}> requested a hint!* \n**${currentRound.country.charAt(0)}...**`, 
                allowedMentions: { parse: [] } 
            }).catch(() => null);
            
            if (hintMsg) currentRound.hintMessageId = hintMsg.id;
            return;
        }

        if (interaction.customId === 'game_skip') {
            if (!currentRound.active || currentRound.processingPayout) {
                return interaction.deferUpdate().catch(() => {});
            }

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
            
            await safeDelete(interactionChannel, targetMainId);
            await safeDelete(interactionChannel, targetHintId);
            
            await startNewRound(interactionChannel);
            return;
        }
    } catch (interErr) {
        console.error('Handled Interaction Error gracefully:', interErr);
    }
});

// ────────────────────────────────────────────────────────
// GHOST-DELETE DETECTOR: CALLS OUT ONLY THE LATEST NUMBER
// ────────────────────────────────────────────────────────
client.on('messageDelete', async (message) => {
    if (message.channelId !== countingChannelId) return;

    try {
        if (message.partial) return;

        if (botDeletedMessageIds.has(message.id)) {
            botDeletedMessageIds.delete(message.id);
            return;
        }

        if (message.author?.bot) return;

        const inputString = message.content?.trim();
        
        if (inputString && /^\d+$/.test(inputString)) {
            const targetChannel = await client.channels.fetch(countingChannelId).catch(() => null);
            if (!targetChannel) return;

            const recentMessages = await targetChannel.messages.fetch({ limit: 5 }).catch(() => null);
            if (recentMessages && recentMessages.size > 0) {
                const absoluteLatestMessage = recentMessages.first();
                
                if (absoluteLatestMessage && absoluteLatestMessage.createdTimestamp > message.createdTimestamp) {
                    return; 
                }
            }

            const userPing = message.author ? `<@${message.author.id}>` : 'Someone';

            await targetChannel.send({
                content: `${userPing}: ${inputString}`,
                allowedMentions: { parse: ['users'] }
            });
        }
    } catch (e) {
        console.error('Error handling smart ghost-delete detector:', e);
    }
});

// ────────────────────────────────────────────────────────
// ANTI-CHEAT CONTROLLER: WATCHES FOR EDITED MESSAGES
// ────────────────────────────────────────────────────────
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.channelId !== countingChannelId) return;
    try {
        if (newMessage.partial) return;
        if (newMessage.author?.bot) return;
        
        botDeletedMessageIds.add(newMessage.id);
        await newMessage.delete().catch(() => {
            botDeletedMessageIds.delete(newMessage.id);
        });
    } catch (e) {}
});

// ────────────────────────────────────────────────────────
// CORE ROUTER: ROUTE MESSAGES TO CORRECT GAME LISTENER
// ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;
    
    // FIX: Allow Default messages (0) and Inline Replies (19) to feed through game listeners
    if (message.type !== 0 && message.type !== 19) return; 

    // PATHWAY A: LOCATION CHANNEL
    if (message.channelId === locationChannelId) {
        if (message.author.bot) {
            return message.delete().catch(() => {});
        }

        if (!currentRound.active || currentRound.processingPayout) {
            return setTimeout(() => message.delete().catch(() => {}), 500);
        }
         
        const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
        const guess = cleanContent.toLowerCase();
        const solution = currentRound.country.toLowerCase();

        if (guess === solution) {
            const capturedRoundId = currentRound.id;
            currentRound.active = false; 
            currentRound.processingPayout = true; 
            try {
                await message.react('✅').catch(() => {});
                const leaderboard = loadJSON('./leaderboard.json');
                
                const userCurrentScore = leaderboard[message.author.id] ? Number(leaderboard[message.author.id]) : 0;
                leaderboard[message.author.id] = userCurrentScore + currentRound.pointsValue;
                saveJSON('./leaderboard.json', leaderboard);

                const targetMainId = currentRound.mainMessageId;
                const targetHintId = currentRound.hintMessageId;

                setTimeout(async () => {
                    if (currentRound.id !== capturedRoundId) return;
                    await message.delete().catch(() => {});
                    await safeDelete(message.channel, targetMainId);
                    await safeDelete(message.channel, targetHintId);
                    await startNewRound(message.channel);
                }, 1500);
            } catch (err) {}
            return;
        }

               try {
            await message.react('❌').catch(() => {});
            setTimeout(() => message.delete().catch(() => {}), 3000);
        } catch (e) {}
        return; // Stops the event handler early since the wrong guess was already managed
    }


    // PATHWAY B: COUNTING CHANNEL
    if (message.channelId === countingChannelId) {
        if (message.author.bot) {
            return message.delete().catch(() => {});
        }

        if (countingLock) {
            return message.delete().catch(() => {}); 
        }

        countingLock = true; 

        try {
            const inputString = message.content.trim();
            
            if (!/^\d+$/.test(inputString)) {
                await message.react('❌').catch(() => {});
                botDeletedMessageIds.add(message.id);
                setTimeout(() => {
                    message.delete().catch(() => botDeletedMessageIds.delete(message.id));
                }, 3000);
                return;
            }

            const parsedNumber = parseInt(inputString, 10);
            const nextTargetNumber = Number(countState.currentCount) + 1;

            if (message.author.id === countState.lastCounterId) {
                await message.react('⚠️').catch(() => {});
                botDeletedMessageIds.add(message.id);
                setTimeout(() => {
                    message.delete().catch(() => botDeletedMessageIds.delete(message.id));
                }, 3000);
                return;
            }

            if (parsedNumber === nextTargetNumber) {
                countState.currentCount = nextTargetNumber;
                countState.lastCounterId = message.author.id;
                saveJSON('./counting.json', countState);

                const reaction = await message.react('✅').catch(() => {});
                if (reaction) {
                    setTimeout(async () => {
                        await reaction.users.remove(client.user.id).catch(() => {});
                    }, 3000); 
                }
                return;
            }

            await message.react('❌').catch(() => {});
            botDeletedMessageIds.add(message.id);
            setTimeout(() => {
                message.delete().catch(() => botDeletedMessageIds.delete(message.id));
            }, 3000);
            return;

        } catch (e) {
            console.error('Error handling counting system sequence:', e);
        } finally {
            countingLock = false; 
        }
    }
});

const server = app.listen(process.env.PORT || 3000, () => {
    console.log('🌐 Web Dashboard server online.');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log('⚠️ Web port busy. Proceeding to connect Discord engines regardless...');
    } else {
        console.error('Web server unexpected event:', err);
    }
});

client.login(process.env.TOKEN);
