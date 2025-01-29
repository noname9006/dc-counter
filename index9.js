require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Debug and logging configuration
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log(`[DEBUG ${getTimestamp()}]`, ...args);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel],
    cache: {
        members: { maxSize: 200000 },
        channels: { maxSize: 100 },
        roles: { maxSize: 100 }
    }
});

// Environment variables
const token = process.env.DISCORD_TOKEN;
const allowedRoles = process.env.ALLOWED_ROLES.split(',');
const allowedChannels = process.env.ALLOWED_CHANNELS.split(',');
const ignoredRoleId = process.env.IGNORED_ROLE;
const verifiedRoleId = process.env.VERIFIED_ROLE;
const intervalMinutes = parseInt(process.env.INTERVAL_MINUTES, 10);
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID;
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT;

// Load configuration arrays
const scheduledRoles = [];
const scheduledChannels = [];
const scheduledChannelNames = [];
const countRoles = [];

// Load roles and channels from environment
for (let i = 1; i <= 6; i++) {
    const roleId = process.env[`SCHEDULED_ROLE_${i}`];
    const channelId = process.env[`SCHEDULED_CHANNEL_${i}`];
    const channelName = process.env[`SCHEDULED_CHANNEL_NAME_${i}`];
    const countRole = process.env[`COUNT_ROLE_${i}`];
    
    if (roleId && channelId && channelName) {
        scheduledRoles.push(roleId);
        scheduledChannels.push(channelId);
        scheduledChannelNames.push(channelName);
    }
    
    if (countRole) {
        countRoles.push(countRole);
    }
}

function countMembersWithHighestRole(members, roleId, debugMode = false) {
    let count = 0;
    const countedMembers = new Set();

    members.forEach(member => {
        if (member.user.bot) return;

        // Get all member's roles except @everyone
        const memberRoles = member.roles.cache
            .filter(role => role.name !== '@everyone')
            .sort((a, b) => b.position - a.position);

        if (memberRoles.size === 0) return;

        // Get highest non-ignored role
        let highestRole = memberRoles.first();
        if (highestRole && highestRole.id === ignoredRoleId) {
            highestRole = memberRoles
                .filter(r => r.id !== ignoredRoleId)
                .first();
        }

        // Only count if this role is their highest
        if (highestRole && highestRole.id === roleId) {
            count++;
            if (debugMode) {
                countedMembers.add(member.id);
                debugLog(`Counted ${member.user.tag} for ${highestRole.name}`);
                debugLog(`Their roles: ${memberRoles.map(r => r.name).join(', ')}`);
            }
        }
    });

    return count;
}

client.once('ready', () => {
    debugLog('Bot initialized and ready');
    debugLog('Configuration loaded:', {
        scheduledRoles: scheduledRoles.length,
        countRoles: countRoles.length,
        allowedChannels: allowedChannels.length,
        updateInterval: intervalMinutes
    });
    scheduleUpdates();
});

async function updateChannels() {
    debugLog('Starting channel update process');
    const guild = client.guilds.cache.first();
    
    if (!guild) {
        debugLog('No guild found, aborting update');
        return;
    }

    try {
        const members = await guild.members.fetch();
        const totalMembers = members.filter(member => !member.user.bot).size;
        debugLog(`Total non-bot members: ${totalMembers}`);
        
        // Update total member count channel
        const totalChannel = guild.channels.cache.get(totalMemberCountChannelId);
        if (totalChannel) {
            const newName = totalMemberCountNameFormat.replace('{count}', totalMembers);
            await totalChannel.setName(newName);
            debugLog(`Updated total member count: ${newName}`);
        }

        // Update role-specific channels
        for (let i = 0; i < scheduledRoles.length; i++) {
            const roleId = scheduledRoles[i];
            const channelId = scheduledChannels[i];
            const nameFormat = scheduledChannelNames[i];

            const role = guild.roles.cache.get(roleId);
            const channel = guild.channels.cache.get(channelId);

            if (!role || !channel) {
                debugLog(`Missing role or channel for index ${i}`, { roleId, channelId });
                continue;
            }

            const count = countMembersWithHighestRole(members, roleId);
            const newName = nameFormat.replace('{count}', count);
            await channel.setName(newName);
            debugLog(`Updated ${role.name} channel: ${newName}`);
        }
    } catch (error) {
        debugLog('Error in updateChannels:', error);
    }
}

function scheduleUpdates() {
    const intervalMs = intervalMinutes * 60 * 1000;
    debugLog(`Setting up interval updates every ${intervalMinutes} minutes (${intervalMs}ms)`);
    
    updateChannels();
    setInterval(updateChannels, intervalMs);
}

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
        const members = await guild.members.fetch();
        let response = '';

        // Count total non-bot members
        const totalMembers = members.filter(member => !member.user.bot).size;
        
        // Get unverified members count
        const unverifiedMembers = members.filter(member => 
            !member.user.bot && !member.roles.cache.has(verifiedRoleId)
        ).size;

        const unverifiedPercentage = ((unverifiedMembers / totalMembers) * 100).toFixed(2);
        response += `Total Members: **${totalMembers}** members.\n`;
        response += `Unverified: **${unverifiedMembers}** members (${unverifiedPercentage}%) without the verified role.\n\n`;

        // Track all counted members for verification
        const processedMembers = new Set();
        let totalRoleCount = 0;

        // Count members by role
        for (const roleId of countRoles) {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            const count = countMembersWithHighestRole(members, roleId, DEBUG_MODE);
            totalRoleCount += count;
            const percentage = ((count / totalMembers) * 100).toFixed(3);
            response += `${role.name}: **${count}** members (${percentage}%) with it as their highest role.\n`;
            debugLog(`${role.name} count: ${count}`);
        }

        if (DEBUG_MODE) {
            debugLog('\n=== Final Count Verification ===');
            debugLog(`Total members: ${totalMembers}`);
            debugLog(`Unverified members: ${unverifiedMembers}`);
            debugLog(`Role-counted members: ${totalRoleCount}`);
            debugLog(`Total accounted for: ${unverifiedMembers + totalRoleCount}`);
            debugLog(`Difference: ${totalMembers - (unverifiedMembers + totalRoleCount)}`);
        }

        await message.channel.send(response);
        debugLog('Count command completed successfully');

    } catch (error) {
        debugLog('Error in count command:', error);
        await message.channel.send('An error occurred while counting members.');
    }
});

client.login(token);