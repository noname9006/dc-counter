require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const cron = require('node-cron');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent // Add this if you need to handle message content
    ],
    partials: [
        Partials.Channel // Add this if you need to handle DM channels or other partials
    ],
    // Limit cache sizes to reduce memory usage
    cache: {
        members: { maxSize: 1000 },
        channels: { maxSize: 100 },
        roles: { maxSize: 100 }
    }
});

const token = process.env.DISCORD_BOT_TOKEN;
const allowedRoles = process.env.ALLOWED_ROLES.split(',');
const countRoleIds = process.env.COUNT_ROLES.split(',');
const channelIds = process.env.CHANNEL_IDS.split(',');
const channelBaseNames = process.env.CHANNEL_BASE_NAMES.split(',');
const ignoredRoleId = process.env.IGNORED_ROLE;
const cronSchedule = process.env.CRON_SCHEDULE;
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID;
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT;

client.once('ready', () => {
    console.log('Bot is ready!');
    scheduleChannelUpdate();
});

async function updateChannelNames() {
    console.log('Running updateChannelNames function'); // Debug logging
    const guild = client.guilds.cache.first();
    
    if (!guild) {
        console.error('No guild found.');
        return;
    }
    
    // Fetch only the necessary members with the required roles
    const members = await guild.members.fetch({
        withPresences: false, // Disable presence fetching to reduce memory usage
        user: { limit: 10000 } // Limit the number of members fetched
    });

    // Update the total member count channel
    const humanMembers = members.filter(member => !member.user.bot);
    const totalMemberCount = humanMembers.size;
    const totalMemberCountChannel = guild.channels.cache.get(totalMemberCountChannelId);
    if (totalMemberCountChannel) {
        const newChannelName = totalMemberCountNameFormat.replace('{count}', totalMemberCount);
        await totalMemberCountChannel.setName(newChannelName);
        console.log(`Updated total member count channel name to: ${newChannelName}`);
    } else {
        console.error(`Channel with ID "${totalMemberCountChannelId}" not found.`);
    }

    for (let i = 0; i < countRoleIds.length; i++) {
        const roleId = countRoleIds[i];
        const channelId = channelIds[i];
        const channelBaseName = channelBaseNames[i];

        const role = guild.roles.cache.get(roleId);
        if (!role) {
            console.log(`Role with ID "${roleId}" not found.`);
            continue;
        }

        let count = 0;
        let hasIgnoredRole = false;

        const membersWithRole = members.filter(member => {
            const highestRole = member.roles.highest;
            if (highestRole.id === roleId) {
                return true;
            }
            if (highestRole.id === ignoredRoleId) {
                const nextHighestRole = member.roles.cache
                    .filter(r => r.id !== ignoredRoleId)
                    .sort((a, b) => b.position - a.position)
                    .first();
                if (nextHighestRole && nextHighestRole.id === roleId) {
                    hasIgnoredRole = true;
                    return true;
                }
            }
            return false;
        });

        count = membersWithRole.size;

        const counterChannel = guild.channels.cache.get(channelId);
        if (counterChannel) {
            const newChannelName = channelBaseName.replace('{count}', count);
            await counterChannel.setName(newChannelName);
            console.log(`Updated channel name to: ${newChannelName}`);
        } else {
            console.error(`Channel with ID "${channelId}" not found.`);
        }
    }
}

function scheduleChannelUpdate() {
    cron.schedule(cronSchedule, () => {
        updateChannelNames();
    }, {
        scheduled: true
    });
}

client.on('messageCreate', async message => {
    if (message.content.startsWith('!count')) {
        const memberRoles = message.member.roles.cache.map(role => role.name);
        const hasAllowedRole = allowedRoles.some(role => memberRoles.includes(role));

        if (!hasAllowedRole) {
            return;
        }

        const guild = message.guild;
        const members = await guild.members.fetch({
            withPresences: false,
            user: { limit: 10000 }
        });

        let response = '';

        for (const roleId of countRoleIds) {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                response += `Role with ID "${roleId}" not found.\n`;
                continue;
            }

            let count = 0;
            let hasIgnoredRole = false;

            const membersWithRole = members.filter(member => {
                const highestRole = member.roles.highest;
                if (highestRole.id === roleId) {
                    return true;
                }
                if (highestRole.id === ignoredRoleId) {
                    const nextHighestRole = member.roles.cache
                        .filter(r => r.id !== ignoredRoleId)
                        .sort((a, b) => b.position - a.position)
                        .first();
                    if (nextHighestRole && nextHighestRole.id === roleId) {
                        hasIgnoredRole = true;
                        return true;
                    }
                }
                return false;
            });

            count = membersWithRole.size;

            if (count > 0) {
                response += `"${role.name}": **${count}** members with it as their highest role`;
                if (hasIgnoredRole) {
                    const ignoredRole = guild.roles.cache.get(ignoredRoleId);
                    response += ` (including one with "${ignoredRole ? ignoredRole.name : 'ignored role'}")`;
                }
                response += '.\n';
            } else {
                response += `"${role.name}": **0** members with it as their highest role.\n`;
            }
        }

        message.channel.send(response);
    }
});

client.login(token);