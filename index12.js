require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Debug mode and logging
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const startTime = new Date().toISOString();

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

// Channel configurations
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID;
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT;

// Role configurations
const scheduledRoles = Array.from({ length: 6 }, (_, i) => process.env[`SCHEDULED_ROLE_${i + 1}`]).filter(Boolean);
const scheduledChannels = Array.from({ length: 6 }, (_, i) => process.env[`SCHEDULED_CHANNEL_${i + 1}`]).filter(Boolean);
const scheduledChannelNames = Array.from({ length: 6 }, (_, i) => process.env[`SCHEDULED_CHANNEL_NAME_${i + 1}`]).filter(Boolean);
const countRoles = Array.from({ length: 6 }, (_, i) => process.env[`COUNT_ROLE_${i + 1}`]).filter(Boolean);

function countMembersWithHighestRole(members, roleId, verifiedRoleId, countedMembers = new Set()) {
    let count = 0;
    let roleMemberIds = new Set();

    members.forEach(member => {
        // Skip bots and already counted members
        if (member.user.bot || countedMembers.has(member.id)) return;
        
        // Skip unverified members
        if (!member.roles.cache.has(verifiedRoleId)) return;

        const memberRoles = member.roles.cache;
        const highestRole = member.roles.highest;

        // Handle ignored role case
        if (highestRole.id === ignoredRoleId) {
            const nextHighestRole = memberRoles
                .filter(r => r.id !== ignoredRoleId && !r.managed)
                .sort((a, b) => b.position - a.position)
                .first();

            if (nextHighestRole && nextHighestRole.id === roleId) {
                count++;
                roleMemberIds.add(member.id);
                countedMembers.add(member.id);
                if (DEBUG_MODE) {
                    debugLog(`Counted member ${member.user.tag} for role ${roleId} (ignored role)`);
                }
            }
        }
        // Handle normal case
        else if (highestRole.id === roleId) {
            count++;
            roleMemberIds.add(member.id);
            countedMembers.add(member.id);
            if (DEBUG_MODE) {
                debugLog(`Counted member ${member.user.tag} for role ${roleId}`);
            }
        }
    });

    return { count, memberIds: roleMemberIds };
}

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

        // Update total member count
        const totalMembers = guild.members.cache.filter(member => !member.user.bot).size;
        const totalMemberChannel = guild.channels.cache.get(totalMemberCountChannelId);
        if (totalMemberChannel) {
            const newName = totalMemberCountNameFormat.replace('{count}', totalMembers);
            await totalMemberChannel.setName(newName);
            debugLog(`Updated total member count channel: ${newName}`);
        }

        // Update role-specific channels
        let countedMembers = new Set();
        
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

            const { count } = countMembersWithHighestRole(
                guild.members.cache,
                roleId,
                verifiedRoleId,
                countedMembers
            );

            const newName = channelNameFormat.replace('{count}', count);
            await channel.setName(newName);
            debugLog(`Updated ${role.name} channel: ${newName}`);
        }
    } catch (error) {
        debugLog('Error in updateChannelNames:', error);
    }
}

function scheduleUpdates() {
    const intervalMs = intervalMinutes * 60 * 1000;
    debugLog(`Setting up interval updates every ${intervalMinutes} minutes`);
    
    updateChannelNames();
    setInterval(updateChannelNames, intervalMs);
}

client.once('ready', () => {
    debugLog('Bot is ready!');
    debugLog(`Start time: ${startTime}`);
    scheduleUpdates();
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith('!count')) return;
    
    debugLog('Count command received', {
        channel: message.channel.id,
        user: message.author.tag
    });

    // Check channel permission
    if (!allowedChannels.includes(message.channel.id)) {
        debugLog('Command used in unauthorized channel');
        return;
    }

    // Check role permission
    const memberRoles = message.member.roles.cache.map(role => role.name);
    if (!allowedRoles.some(role => memberRoles.includes(role))) {
        debugLog('Command used by unauthorized user');
        return;
    }

    try {
        const guild = message.guild;
        await guild.members.fetch();
        debugLog('Fetched all guild members');

        // Count total and verified members
        const totalMembers = guild.members.cache.filter(member => !member.user.bot).size;
        const unverifiedMembers = guild.members.cache.filter(member => 
            !member.user.bot && !member.roles.cache.has(verifiedRoleId)
        ).size;
        const verifiedCount = totalMembers - unverifiedMembers;

        let response = '';
        response += `Total Members: **${totalMembers}** members\n`;
        response += `Verified: **${verifiedCount}** members (${((verifiedCount/totalMembers)*100).toFixed(2)}%)\n`;
        response += `Unverified: **${unverifiedMembers}** members (${((unverifiedMembers/totalMembers)*100).toFixed(2)}%)\n\n`;

        // Count role members
        let totalRoleCount = 0;
        let globalCountedMembers = new Set();

        for (const roleId of countRoles) {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            const { count, memberIds } = countMembersWithHighestRole(
                guild.members.cache,
                roleId,
                verifiedRoleId,
                globalCountedMembers
            );

            totalRoleCount += count;
            memberIds.forEach(id => globalCountedMembers.add(id));

            const percentage = ((count / totalMembers) * 100).toFixed(3);
            response += `${role.name}: **${count}** members (${percentage}%) with it as their highest role.\n`;
        }

        // Verify counts
        if (DEBUG_MODE) {
            debugLog('\n=== Final Count Verification ===');
            debugLog(`Total members: ${totalMembers}`);
            debugLog(`Verified members: ${verifiedCount}`);
            debugLog(`Total role count: ${totalRoleCount}`);
            debugLog(`Counted unique members: ${globalCountedMembers.size}`);
            debugLog(`Unaccounted verified members: ${verifiedCount - globalCountedMembers.size}`);

            // List unaccounted verified members
            const unaccountedMembers = guild.members.cache
                .filter(m => 
                    m.roles.cache.has(verifiedRoleId) && 
                    !globalCountedMembers.has(m.id)
                );

            if (unaccountedMembers.size > 0) {
                debugLog('\nUnaccounted verified members:');
                unaccountedMembers.forEach(member => {
                    const roles = member.roles.cache
                        .filter(r => !r.managed)
                        .map(r => r.name)
                        .join(', ');
                    debugLog(`${member.user.tag} - Roles: ${roles}`);
                });
            }
        }

        await message.channel.send(response);
        debugLog('Count command completed successfully');

    } catch (error) {
        debugLog('Error in count command:', error);
        await message.channel.send('An error occurred while counting members.');
    }
});

client.login(token);