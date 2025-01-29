require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Helper function to get formatted timestamp in UTC
function getTimestamp() {
    return new Date().toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [
        Partials.Channel
    ],
    cache: {
        members: { maxSize: 1000 },
        channels: { maxSize: 100 },
        roles: { maxSize: 100 }
    }
});

const token = process.env.DISCORD_BOT_TOKEN;
const allowedRoles = process.env.ALLOWED_ROLES.split(',');
const ignoredRoleId = process.env.IGNORED_ROLE;
const intervalMinutes = parseInt(process.env.INTERVAL_MINUTES, 10);
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID;
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT;
const verifiedRoleId = process.env.VERIFIED_ROLE;

// Load roles, channels, and channel names from environment variables
const roles = [];
const channels = [];
const channelBaseNames = [];
for (let i = 1; process.env[`ROLE_${i}`]; i++) {
    roles.push(process.env[`ROLE_${i}`]);
    channels.push(process.env[`CHANNEL_${i}`]);
    channelBaseNames.push(process.env[`CHANNEL_NAME_${i}`]);
}

// Load count roles from environment variables
const countRoles = [];
for (let i = 1; process.env[`COUNT_ROLE_${i}`]; i++) {
    countRoles.push(process.env[`COUNT_ROLE_${i}`]);
}

client.once('ready', () => {
    console.log(`[${getTimestamp()}] Bot is ready!`);
    scheduleChannelUpdate();
});

async function updateChannelNames() {
    console.log(`[${getTimestamp()}] Running updateChannelNames function`);
    const guild = client.guilds.cache.first();
    
    if (!guild) {
        console.error(`[${getTimestamp()}] No guild found.`);
        return;
    }
    
    console.log(`[${getTimestamp()}] Fetching members for guild ${guild.name}`);
    const members = await guild.members.fetch({
        withPresences: false,
        user: { limit: 10000 }
    });
    console.log(`[${getTimestamp()}] Successfully fetched ${members.size} members`);

    // Update the total member count channel
    const humanMembers = members.filter(member => !member.user.bot);
    const totalMemberCount = humanMembers.size;
    const totalMemberCountChannel = guild.channels.cache.get(totalMemberCountChannelId);
    if (totalMemberCountChannel) {
        const newChannelName = totalMemberCountNameFormat.replace('{count}', totalMemberCount);
        await totalMemberCountChannel.setName(newChannelName);
        console.log(`[${getTimestamp()}] Updated total member count channel name to: ${newChannelName}`);
    } else {
        console.error(`[${getTimestamp()}] Channel with ID "${totalMemberCountChannelId}" not found.`);
    }

    for (let i = 0; i < roles.length; i++) {
        const roleId = roles[i];
        const channelId = channels[i];
        const channelBaseName = channelBaseNames[i];

        const role = guild.roles.cache.get(roleId);
        if (!role) {
            console.log(`[${getTimestamp()}] Role with ID ${roleId} not found.`);
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
            console.log(`[${getTimestamp()}] Updated channel name to: ${newChannelName}`);
        } else {
            console.error(`[${getTimestamp()}] Channel with ID ${channelId} not found.`);
        }
    }
}

function scheduleChannelUpdate() {
    console.log(`[${getTimestamp()}] Scheduling channel updates every ${intervalMinutes} minutes`);
    setInterval(() => {
        console.log(`[${getTimestamp()}] Running scheduled channel update`);
        updateChannelNames();
    }, intervalMinutes * 60000); // Convert minutes to milliseconds
}

client.on('messageCreate', async message => {
    if (message.content.startsWith('!count')) {
        console.log(`[${getTimestamp()}] Command "!count" used by ${message.author.tag}`);
        
        const args = message.content.split(' ');
        const n = parseInt(args[1], 10);
        const memberRoles = message.member.roles.cache.map(role => role.name);
        const hasAllowedRole = allowedRoles.some(role => memberRoles.includes(role));

        if (!hasAllowedRole) {
            console.log(`[${getTimestamp()}] Command access denied - user lacks required role`);
            return;
        }

        const guild = message.guild;
        console.log(`[${getTimestamp()}] Fetching member data for guild ${guild.name}`);
        
        const members = await guild.members.fetch({
            withPresences: false,
            user: { limit: 10000 }
        });

        console.log(`[${getTimestamp()}] Successfully fetched ${members.size} members`);

        let response = '';

        // Calculate total members count excluding bots
        const totalMembersCount = members.filter(member => !member.user.bot).size;
        response += `Total Members: **${totalMembersCount}** members.\n`;

        // Filter unverified members
        const unverifiedMembers = members.filter(member => {
            return !member.roles.cache.has(verifiedRoleId) && !member.user.bot;
        });

        // Calculate percentage for unverified members
        const unverifiedPercentage = ((unverifiedMembers.size / totalMembersCount) * 100).toFixed(2);

        // Add unverified members count to the response
        response += `Unverified: **${unverifiedMembers.size}** members (${unverifiedPercentage}%) without the verified role.\n\n`;

        // Determine the number of roles to process based on the command argument
        const rolesToProcess = isNaN(n) ? countRoles.length : Math.min(n, countRoles.length);
        console.log(`[${getTimestamp()}] Processing ${rolesToProcess} roles for counting`);

        for (let i = 0; i < rolesToProcess; i++) {
            const roleId = countRoles[i];
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                console.log(`[${getTimestamp()}] Role not found: ${roleId}`);
                response += `Role with ID ${roleId} not found.\n`;
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
            const percentage = ((count / totalMembersCount) * 100).toFixed(3);

            if (count > 0) {
                response += `${role.name}: **${count}** members (${percentage}%) with it as their highest role`;
                if (hasIgnoredRole) {
                    const ignoredRole = guild.roles.cache.get(ignoredRoleId);
                    response += ` (including one with ${ignoredRole ? ignoredRole.name : 'ignored role'})`;
                }
                response += '.\n';
            } else {
                response += `${role.name}: **0** members (${percentage}%) with it as their highest role.\n`;
            }
        }

        console.log(`[${getTimestamp()}] Sending response message to channel ${message.channel.name}`);
        await message.channel.send(response);
        console.log(`[${getTimestamp()}] Response message sent successfully`);
    }
});

client.login(token);