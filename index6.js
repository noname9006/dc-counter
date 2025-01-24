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
const ignoredRoleId = process.env.IGNORED_ROLE;
const cronSchedule = process.env.CRON_SCHEDULE;
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID;
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT;
const verifiedRoleId = process.env.VERIFIED_ROLE; // Fetch the verified role from environment variables

// Load roles, channels, and channel names for scheduled updates from environment variables
const scheduledRoles = [];
const scheduledChannels = [];
const scheduledChannelBaseNames = [];
for (let i = 1; process.env[`SCHEDULED_ROLE_${i}`]; i++) {
    scheduledRoles.push(process.env[`SCHEDULED_ROLE_${i}`]);
    scheduledChannels.push(process.env[`SCHEDULED_CHANNEL_${i}`]);
    scheduledChannelBaseNames.push(process.env[`SCHEDULED_CHANNEL_NAME_${i}`]);
}

// Load roles for !count command from environment variables
const countRoles = [];
for (let i = 1; process.env[`COUNT_ROLE_${i}`]; i++) {
    countRoles.push(process.env[`COUNT_ROLE_${i}`]);
}

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

    for (let i = 0; i < scheduledRoles.length; i++) {
        const roleId = scheduledRoles[i];
        const channelId = scheduledChannels[i];
        const channelBaseName = scheduledChannelBaseNames[i];

        const role = guild.roles.cache.get(roleId);
        if (!role) {
            console.log(`Role with ID ${roleId} not found.`);
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
            console.error(`Channel with ID ${channelId} not found.`);
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
        const args = message.content.split(' ');
        const n = parseInt(args[1], 10); // Parse the second argument as a number
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

        for (let i = 0; i < rolesToProcess; i++) {
            const roleId = countRoles[i];
            const role = guild.roles.cache.get(roleId);
            if (!role) {
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
            // Display three decimal places for all roles
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

        message.channel.send(response);
    }
});

client.login(token);