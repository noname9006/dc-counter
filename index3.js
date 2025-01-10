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
    ]
});

const token = process.env.DISCORD_BOT_TOKEN; // Access the token from the environment variable
const allowedRoles = process.env.ALLOWED_ROLES.split(','); // Get the allowed roles from the environment variable
const countRoleIds = process.env.COUNT_ROLES.split(','); // Get the role IDs for counting from the environment variable
const channelIds = process.env.CHANNEL_IDS.split(','); // Get the channel IDs from the environment variable
const channelBaseNames = process.env.CHANNEL_BASE_NAMES.split(','); // Get the custom base names for the channels from the environment variable
const ignoredRoleId = process.env.IGNORED_ROLE; // Get the ignored role ID from the environment variable
const cronSchedule = process.env.CRON_SCHEDULE; // Get the cron schedule from the environment variable
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID; // Get the total member count channel ID from the environment variable
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT; // Get the total member count name format from the environment variable

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
    
    await guild.members.fetch(); // Fetch all members in the guild

    // Update the total member count channel
    const humanMembers = guild.members.cache.filter(member => !member.user.bot);
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

        const membersWithRole = guild.members.cache.filter(member => {
            const highestRole = member.roles.highest;
            if (highestRole.id === roleId) {
                return true;
            }
            if (highestRole.id === ignoredRoleId) {
                // If the highest role is the ignored role, find the next highest role
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

        // Update the channel name with the count
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
    // Schedule the updateChannelNames function to run based on the cron schedule
    cron.schedule(cronSchedule, () => {
        updateChannelNames();
    }, {
        scheduled: true
    });
}

client.on('messageCreate', async message => {
    if (message.content.startsWith('!count')) {
        // Check if the user has one of the allowed roles
        const memberRoles = message.member.roles.cache.map(role => role.name);
        const hasAllowedRole = allowedRoles.some(role => memberRoles.includes(role));

        if (!hasAllowedRole) {
            // Do not send any message if the user does not have the required roles
            return;
        }

        const guild = message.guild;
        await guild.members.fetch(); // Fetch all members in the guild

        let response = '';

        for (const roleId of countRoleIds) {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                response += `Role with ID "${roleId}" not found.\n`;
                continue;
            }

            let count = 0;
            let hasIgnoredRole = false;

            const membersWithRole = guild.members.cache.filter(member => {
                const highestRole = member.roles.highest;
                if (highestRole.id === roleId) {
                    return true;
                }
                if (highestRole.id === ignoredRoleId) {
                    // If the highest role is the ignored role, find the next highest role
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