require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Debug and logging configuration
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Utility function for timestamp
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

// Member counting statistics class
class MemberStats {
    constructor() {
        this.totalMembers = 0;
        this.unverifiedMembers = 0;
        this.countedMembers = new Set();
        this.roleStats = new Map();
        this.botCount = 0;
    }

    clear() {
        this.countedMembers.clear();
        this.roleStats.clear();
    }
}

const stats = new MemberStats();

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
        stats.totalMembers = members.filter(member => !member.user.bot).size;
        debugLog(`Total non-bot members: ${stats.totalMembers}`);
        
        // Update total member count channel
        const totalChannel = guild.channels.cache.get(totalMemberCountChannelId);
        if (totalChannel) {
            const newName = totalMemberCountNameFormat.replace('{count}', stats.totalMembers);
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

            const count = await getRoleMemberCount(members, role);
            const newName = nameFormat.replace('{count}', count);
            await channel.setName(newName);
            debugLog(`Updated ${role.name} channel: ${newName}`);
        }
    } catch (error) {
        debugLog('Error in updateChannels:', error);
    }
}

async function getRoleMemberCount(members, role) {
    return members.filter(member => {
        if (member.user.bot) return false;
        
        const highestRole = member.roles.highest;
        if (highestRole.id === role.id) return true;
        
        if (highestRole.id === ignoredRoleId) {
            const nextHighestRole = member.roles.cache
                .filter(r => r.id !== ignoredRoleId)
                .sort((a, b) => b.position - a.position)
                .first();
            return nextHighestRole && nextHighestRole.id === role.id;
        }
        return false;
    }).size;
}

function scheduleUpdates() {
    const intervalMs = intervalMinutes * 60 * 1000;
    debugLog(`Setting up interval updates every ${intervalMinutes} minutes (${intervalMs}ms)`);
    
    updateChannels(); // Initial update
    setInterval(updateChannels, intervalMs);
}

client.on('messageCreate', async message => {
    if (!message.content.startsWith('!count')) return;
    
    debugLog('Count command received', {
        timestamp: getTimestamp(),
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
        
        stats.clear();
        let response = '';

        // Count total and unverified members
        stats.totalMembers = members.filter(member => !member.user.bot).size;
        const unverifiedMembers = members.filter(member => 
            !member.user.bot && !member.roles.cache.has(verifiedRoleId)
        );
        const unverifiedPercentage = ((unverifiedMembers.size / stats.totalMembers) * 100).toFixed(2);

        response += `Total Members: **${stats.totalMembers}** members.\n`;
        response += `Unverified: **${unverifiedMembers.size}** members (${unverifiedPercentage}%) without the verified role.\n\n`;

        // Count members by role
        for (const roleId of countRoles) {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                debugLog(`Role not found: ${roleId}`);
                continue;
            }

            const membersWithRole = members.filter(member => {
                if (member.user.bot || stats.countedMembers.has(member.id)) return false;

                const highestRole = member.roles.highest;
                let shouldCount = false;

                if (highestRole.id === roleId) {
                    shouldCount = true;
                } else if (highestRole.id === ignoredRoleId) {
                    const nextHighestRole = member.roles.cache
                        .filter(r => r.id !== ignoredRoleId)
                        .sort((a, b) => b.position - a.position)
                        .first();
                    if (nextHighestRole && nextHighestRole.id === roleId) {
                        shouldCount = true;
                    }
                }

                if (shouldCount) {
                    stats.countedMembers.add(member.id);
                    stats.roleStats.set(member.id, role.name);
                }

                return shouldCount;
            });

            const count = membersWithRole.size;
            const percentage = ((count / stats.totalMembers) * 100).toFixed(3);
            response += `${role.name}: **${count}** members (${percentage}%) with it as their highest role.\n`;
            debugLog(`${role.name} count: ${count}`);
        }

        if (DEBUG_MODE) {
            const totalCounted = stats.countedMembers.size + unverifiedMembers.size;
            const difference = stats.totalMembers - totalCounted;
            
            debugLog('\n=== Member Count Verification ===');
            debugLog(`Total members: ${stats.totalMembers}`);
            debugLog(`Counted members: ${stats.countedMembers.size}`);
            debugLog(`Unverified members: ${unverifiedMembers.size}`);
            debugLog(`Total counted: ${totalCounted}`);
            debugLog(`Difference: ${difference}`);
            
            if (difference !== 0) {
                debugLog('\n=== Investigating Difference ===');
                members.forEach(member => {
                    if (!member.user.bot && 
                        !stats.countedMembers.has(member.id) && 
                        !unverifiedMembers.has(member.id)) {
                        debugLog(`Uncounted member: ${member.user.tag}`);
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