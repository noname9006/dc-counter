require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log(`[${new Date().toISOString()}]`, ...args);
    }
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
    ]
});

// Environment variables
const token = process.env.DISCORD_TOKEN;
const allowedRoles = process.env.ALLOWED_ROLES.split(',');
const allowedChannels = process.env.ALLOWED_CHANNELS.split(',');
const ignoredRoleId = process.env.IGNORED_ROLE;
const verifiedRoleId = process.env.VERIFIED_ROLE;
const intervalMinutes = parseInt(process.env.INTERVAL_MINUTES) || 5;
const targetChannelId = process.env.TARGET_CHANNEL_ID;
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID;
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT;

// Role counter configuration
const scheduledRoles = [
    process.env.SCHEDULED_ROLE_1,
    process.env.SCHEDULED_ROLE_2,
    process.env.SCHEDULED_ROLE_3,
    process.env.SCHEDULED_ROLE_4,
    process.env.SCHEDULED_ROLE_5,
    process.env.SCHEDULED_ROLE_6
].filter(Boolean);

const scheduledChannels = [
    process.env.SCHEDULED_CHANNEL_1,
    process.env.SCHEDULED_CHANNEL_2,
    process.env.SCHEDULED_CHANNEL_3,
    process.env.SCHEDULED_CHANNEL_4,
    process.env.SCHEDULED_CHANNEL_5,
    process.env.SCHEDULED_CHANNEL_6
].filter(Boolean);

const scheduledChannelNames = [
    process.env.SCHEDULED_CHANNEL_NAME_1,
    process.env.SCHEDULED_CHANNEL_NAME_2,
    process.env.SCHEDULED_CHANNEL_NAME_3,
    process.env.SCHEDULED_CHANNEL_NAME_4,
    process.env.SCHEDULED_CHANNEL_NAME_5,
    process.env.SCHEDULED_CHANNEL_NAME_6
].filter(Boolean);

const countRoles = [
    process.env.COUNT_ROLE_1,
    process.env.COUNT_ROLE_2,
    process.env.COUNT_ROLE_3,
    process.env.COUNT_ROLE_4,
    process.env.COUNT_ROLE_5,
    process.env.COUNT_ROLE_6
].filter(Boolean);

async function updateChannelNames() {
    debugLog('Starting channel name updates');
    const guild = client.guilds.cache.first();
    if (!guild) {
        debugLog('No guild found');
        return;
    }

    try {
        await guild.members.fetch();
        debugLog('Fetched all guild members');

        // Update total member count channel
        const totalMembers = guild.members.cache.filter(member => !member.user.bot).size;
        const totalMemberChannel = guild.channels.cache.get(totalMemberCountChannelId);
        if (totalMemberChannel) {
            const newName = totalMemberCountNameFormat.replace('{count}', totalMembers);
            await totalMemberChannel.setName(newName);
            debugLog(`Updated total member count channel: ${newName}`);
        }

        // Update role count channels
        for (let i = 0; i < scheduledRoles.length; i++) {
            const roleId = scheduledRoles[i];
            const channelId = scheduledChannels[i];
            const channelNameFormat = scheduledChannelNames[i];

            if (!roleId || !channelId || !channelNameFormat) continue;

            const role = guild.roles.cache.get(roleId);
            const channel = guild.channels.cache.get(channelId);

            if (!role || !channel) {
                debugLog(`Missing role or channel for index ${i}`);
                continue;
            }

            const count = countMembersWithHighestRole(guild.members.cache, roleId, verifiedRoleId);
            const newName = channelNameFormat.replace('{count}', count);
            await channel.setName(newName);
            debugLog(`Updated ${role.name} channel: ${newName}`);
        }
    } catch (error) {
        debugLog('Error in updateChannelNames:', error);
    }
}

function countMembersWithHighestRole(members, roleId, verifiedRoleId) {
    let count = 0;
    members.forEach(member => {
        if (member.user.bot) return;
        
        // First check if member is verified
        if (!member.roles.cache.has(verifiedRoleId)) {
            return;
        }

        const highestRole = member.roles.highest;
        if (highestRole.id === roleId) {
            count++;
            if (DEBUG_MODE) debugLog(`Counted member ${member.user.tag} for role ${roleId}`);
            return;
        }

        if (highestRole.id === ignoredRoleId) {
            const nextHighestRole = member.roles.cache
                .filter(r => r.id !== ignoredRoleId)
                .sort((a, b) => b.position - a.position)
                .first();
            if (nextHighestRole && nextHighestRole.id === roleId) {
                count++;
                if (DEBUG_MODE) debugLog(`Counted member ${member.user.tag} for role ${roleId} (ignored role)`);
            }
        }
    });
    return count;
}

function scheduleUpdates() {
    const intervalMs = intervalMinutes * 60 * 1000;
    debugLog(`Setting up interval updates every ${intervalMinutes} minutes (${intervalMs}ms)`);
    
    updateChannelNames();
    setInterval(updateChannelNames, intervalMs);
}

client.once('ready', () => {
    debugLog('Bot is ready!');
    scheduleUpdates();
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith('!count')) return;
    
    debugLog('Count command received', {
        channel: message.channel.id,
        user: message.author.tag
    });

    if (!allowedChannels.includes(message.channel.id)) {
        debugLog('Command used in unauthorized channel');
        return;
    }

    const memberRoles = message.member.roles.cache.map(role => role.name);
    if (!allowedRoles.some(role => memberRoles.includes(role))) {
        debugLog('Command used by unauthorized user');
        return;
    }

    try {
        const guild = message.guild;
        await guild.members.fetch();
        debugLog('Fetched all guild members');

        // Count total non-bot members
        const totalMembers = guild.members.cache.filter(member => !member.user.bot).size;
        
        // Get verified and unverified counts
        const unverifiedMembers = guild.members.cache.filter(member => 
            !member.user.bot && !member.roles.cache.has(verifiedRoleId)
        ).size;
        const verifiedCount = totalMembers - unverifiedMembers;

        let response = '';
        response += `Total Members: **${totalMembers}** members\n`;
        response += `Verified: **${verifiedCount}** members (${((verifiedCount/totalMembers)*100).toFixed(2)}%)\n`;
        response += `Unverified: **${unverifiedMembers}** members (${((unverifiedMembers/totalMembers)*100).toFixed(2)}%)\n\n`;

        let totalRoleCount = 0;

        // Count members by role
        for (const roleId of countRoles) {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            const count = countMembersWithHighestRole(guild.members.cache, roleId, verifiedRoleId);
            totalRoleCount += count;
            const percentage = ((count / totalMembers) * 100).toFixed(3);
            response += `${role.name}: **${count}** members (${percentage}%) with it as their highest role.\n`;
            debugLog(`${role.name} count: ${count}`);
        }

        if (DEBUG_MODE) {
            debugLog('\n=== Final Count Verification ===');
            debugLog(`Total members: ${totalMembers}`);
            debugLog(`Verified members: ${verifiedCount}`);
            debugLog(`Total role count: ${totalRoleCount}`);
            debugLog(`Difference (roles - verified): ${totalRoleCount - verifiedCount}`);
        }

        await message.channel.send(response);
        debugLog('Count command completed successfully');

    } catch (error) {
        debugLog('Error in count command:', error);
        await message.channel.send('An error occurred while counting members.');
    }
});

client.login(token);