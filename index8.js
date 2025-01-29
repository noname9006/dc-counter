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

async function getHighestRoleFromSet(member, roleSet) {
    const memberRoles = member.roles.cache
        .filter(role => roleSet.includes(role.id))
        .sort((a, b) => b.position - a.position);
    
    return memberRoles.first();
}

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

            const count = members.filter(member => 
                !member.user.bot && member.roles.cache.has(roleId)
            ).size;

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
        
        // Initialize counters
        const processedMembers = new Set();
        const roleCounts = new Map();
        countRoles.forEach(roleId => roleCounts.set(roleId, 0));
        
        // Count total non-bot members
        const totalMembers = members.filter(member => !member.user.bot).size;
        
        // Count unverified members first
        const unverifiedMembers = members.filter(member => {
            if (member.user.bot) return false;
            const isUnverified = !member.roles.cache.has(verifiedRoleId);
            if (isUnverified) {
                processedMembers.add(member.id);
            }
            return isUnverified;
        });

        // Process remaining members for role counts
        members.forEach(member => {
            if (member.user.bot || processedMembers.has(member.id)) return;

            // Get member's highest role from countRoles
            const memberCountRoles = member.roles.cache
                .filter(role => countRoles.includes(role.id))
                .sort((a, b) => b.position - a.position);

            const highestCountRole = memberCountRoles.first();
            if (highestCountRole) {
                roleCounts.set(highestCountRole.id, roleCounts.get(highestCountRole.id) + 1);
                processedMembers.add(member.id);
            }
        });

        // Build response
        let response = `Total Members: **${totalMembers}** members.\n`;
        response += `Unverified: **${unverifiedMembers.size}** members (${((unverifiedMembers.size / totalMembers) * 100).toFixed(2)}%) without the verified role.\n\n`;

        // Add role counts to response
        for (const roleId of countRoles) {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            const count = roleCounts.get(roleId);
            const percentage = ((count / totalMembers) * 100).toFixed(3);
            response += `${role.name}: **${count}** members (${percentage}%) with it as their highest role.\n`;
            debugLog(`${role.name} count: ${count}`);
        }

        // Verification
        if (DEBUG_MODE) {
            const totalCounted = unverifiedMembers.size + 
                Array.from(roleCounts.values()).reduce((sum, count) => sum + count, 0);
            
            debugLog('\n=== Member Count Verification ===');
            debugLog(`Total members: ${totalMembers}`);
            debugLog(`Processed members: ${processedMembers.size}`);
            debugLog(`Unverified members: ${unverifiedMembers.size}`);
            debugLog(`Role-counted members: ${totalCounted - unverifiedMembers.size}`);
            debugLog(`Total counted: ${totalCounted}`);
            debugLog(`Difference: ${totalMembers - totalCounted}`);

            if (totalMembers !== totalCounted) {
                debugLog('\n=== Uncounted Members ===');
                members.forEach(member => {
                    if (!member.user.bot && !processedMembers.has(member.id)) {
                        debugLog(`Member: ${member.user.tag}`);
                        debugLog(`Roles: ${member.roles.cache.map(r => r.name).join(', ')}`);
                    }
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