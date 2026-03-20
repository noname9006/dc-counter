require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder, Options } = require('discord.js');
const setupCountUnverifiedCommand = require('./countUnverified');
const { setupExtractCommands } = require('./unverified');
const { setupPurgeCommands } = require('./purge');
const { getUserMessageCount, ExportProgress } = require('./export');
const fs = require('fs');
const path = require('path');

// Debug mode and logging
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Helper function to get formatted timestamp in UTC
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Helper function to get the date in DD Month YYYY format
function getFullDateFormat() {
    const now = new Date();
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const day = now.getDate().toString().padStart(2, '0');
    const month = months[now.getMonth()];
    const year = now.getFullYear();
    
    return `${day} ${month} ${year}`;
}

// Custom logging function
function debugLog(message, isMemberInfo = false, ...args) {
    if (DEBUG_MODE || !isMemberInfo) {
        const logPrefix = DEBUG_MODE ? `[DEBUG ${getTimestamp()}]` : `[${getTimestamp()}]`;
        console.log(logPrefix, message, ...args);
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
    sweepers: {
        guildMembers: {
            interval: 1800,      // sweep every 30 minutes
            filter: () => member => !member.user.bot
        },
        users: {
            interval: 3600,
            filter: () => user => user.id !== client.user?.id
        },
        messages: {
            interval: 1800,
            lifetime: 900        // evict messages older than 15 minutes
        }
    }
});

// Environment variables
const token = process.env.DISCORD_TOKEN;
const allowedRoles = process.env.ALLOWED_ROLES.split(',');
const allowedChannels = process.env.ALLOWED_CHANNELS.split(',');
const ignoredRoleIds = process.env.IGNORED_ROLE
    ? process.env.IGNORED_ROLE.split(',').map(r => r.trim()).filter(Boolean)
    : [];
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



/**
 * Check if member has any ignored role
 */
function memberHasIgnoredRole(member, ignoredRoleIds) {
    return member.roles.cache.some(r => ignoredRoleIds.includes(r.id));
}

/**
 * Get the highest count role for a member
 * Only considers roles in countRoleIds, ignores roles in ignoredRoleIds
 * Returns null if member has any ignored role
 */
function getHighestCountRole(member, countRoleIds, ignoredRoleIds, guild) {
    // If member has any ignored role, exclude from counting
    if (memberHasIgnoredRole(member, ignoredRoleIds)) return null;
    // Filter member's roles to only roles in countRoleIds
    const countRolesArr = member.roles.cache.filter(r => countRoleIds.includes(r.id));
    if (countRolesArr.size === 0) return null;
    // Get the highest one by position (Discord role position descending)
    return countRolesArr.sort((a, b) => b.position - a.position).first();
}

/**
 * Count members whose highest role (among countRoleIds) is roleId
 * Excludes members with any ignored role
 */
function countMembersWithCountRole(members, roleId, countRoleIds, verifiedRoleId, ignoredRoleIds, countedMembers = new Set()) {
    let count = 0;

    members.forEach(member => {
        // Skip bots and already counted members
        if (member.user.bot || countedMembers.has(member.id)) return;
        // Skip unverified members
        if (!member.roles.cache.has(verifiedRoleId)) return;
        // Skip members with any ignored role
        if (memberHasIgnoredRole(member, ignoredRoleIds)) return;

        const highestCountRole = getHighestCountRole(member, countRoleIds, ignoredRoleIds, member.guild);

        if (highestCountRole && highestCountRole.id === roleId) {
            count++;
            countedMembers.add(member.id);
            debugLog(`Counted member ${member.user.tag} for role ${roleId}`, true);
        }
    });

    return { count };
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

            const { count } = countMembersWithCountRole(
                guild.members.cache,
                roleId,
                countRoles,
                verifiedRoleId,
                ignoredRoleIds,
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
    debugLog(`Start time: ${getTimestamp()}`);
    scheduleUpdates();
});

setupExtractCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });
setupPurgeCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });
setupCountUnverifiedCommand(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });

client.on('messageCreate', async message => {
    // First check if it starts with !count
    if (!message.content.startsWith('!count')) return;
    
    // Get the full command
    const fullCommand = message.content.trim();
    
    // List of valid commands
    const validCommands = ['!count', '!count export', '!count unverified'];
    
    // If it's not a valid command, ignore it
    if (!validCommands.includes(fullCommand)) {
        debugLog('Invalid count command received:', fullCommand);
        return;
    }
    
    debugLog('Count command received', {
        channel: message.channel.id,
        user: message.author.tag,
        command: fullCommand
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

    // Handle export command
    if (fullCommand === '!count export') {
        try {
            await message.channel.send('Generating CSV export... This might take a few moments.');
            
            const guild = message.guild;
            await guild.members.fetch();
            
            // Create a progress tracker for message counting
            const progress = new ExportProgress(guild.id);
            
            // Prepare CSV header
            const csvHeader = 'UserID,Username,Highest Role,Server Join Date,Discord Join Date,Messages Number\n';

            // Create temporary file using a write stream
            const tempFilePath = path.join(__dirname, 'user_export.csv');
            const writeStream = fs.createWriteStream(tempFilePath, { encoding: 'utf8' });
            writeStream.write(csvHeader);

            // Process each member
            for (const [id, member] of guild.members.cache) {
                if (member.user.bot) continue;  // Skip bots

                const userId = member.user.id;
                const username = member.user.tag.replace(/,/g, '');  // Remove commas to avoid CSV issues
                // Use the highest count role for CSV (can be blank if has none)
                const highestRoleObj = getHighestCountRole(member, countRoles, ignoredRoleIds, guild);
                const highestRole = highestRoleObj ? highestRoleObj.name.replace(/,/g, '') : '';
                const serverJoinDate = member.joinedAt ? member.joinedAt.toISOString().slice(0, 19).replace('T', ' ') : '';
                const discordJoinDate = member.user.createdAt ? member.user.createdAt.toISOString().slice(0, 19).replace('T', ' ') : '';
                
                // Fetch message count using historical message fetching
                const messagesNumber = await getUserMessageCount(guild, userId, progress);

                // Write row to stream
                writeStream.write(`${userId},"${username}","${highestRole}","${serverJoinDate}","${discordJoinDate}",${messagesNumber}\n`);
            }

            // Close stream and wait for finish
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                writeStream.end();
            });
            
            // Create attachment and send file
            const attachment = new AttachmentBuilder(tempFilePath, {
                name: `user_export_${getTimestamp().replace(/[: ]/g, '-')}.csv`
            });
            
            await message.channel.send({
                content: 'Here is your requested user export:',
                files: [attachment]
            });
            
            // Clean up temporary file
            fs.unlinkSync(tempFilePath);
            
            debugLog('Export command completed successfully');
            return;
        } catch (error) {
            debugLog('Error in export command:', error);
            await message.channel.send('An error occurred while generating the export.');
            return;
        }
    }

    // If not export command, must be !count or !count unverified
    try {
        const guild = message.guild;
        await guild.members.fetch();
        debugLog('Fetched all guild members');

        // Count total and verified members
        const totalMembers = guild.members.cache.filter(member => !member.user.bot).size;
        const unverifiedMembers = guild.members.cache.filter(member => 
            !member.user.bot && !member.roles.cache.has(verifiedRoleId)
        ).size;
        const unverifiedPercentage = ((unverifiedMembers / totalMembers) * 100).toFixed(1);

        if (fullCommand === '!count unverified') {
            // Don't do anything here as it's handled by the countUnverifiedCommand module
            return;
        }

        // Regular !count command - use the same embed styling as index13m.js
        const embed = new EmbedBuilder()
            .setTitle(`Total members: ${totalMembers}`)
            .setDescription('Members with highest roles:')
            .setColor(0xF2B518)
            .setFooter({
                text: `Botanix Labs                                                                        ${getFullDateFormat()}`,
                iconURL: 'https://a-us.storyblok.com/f/1014909/512x512/026e26392f/dark_512-1.png'
            });

        let totalRoleCount = 0;
        let globalCountedMembers = new Set();

        for (let i = 0; i < countRoles.length; i++) {
            const roleId = countRoles[i];
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            const { count } = countMembersWithCountRole(
                guild.members.cache,
                roleId,
                countRoles,
                verifiedRoleId,
                ignoredRoleIds,
                globalCountedMembers
            );

            totalRoleCount += count;

            let percentage;
            if (i === 0 || i === 1) {
                percentage = ((count / totalMembers) * 100).toFixed(1);
            } else if (i === 2 || i === 3) {
                percentage = ((count / totalMembers) * 100).toFixed(2);
            } else {
                percentage = ((count / totalMembers) * 100).toFixed(3);
            }

            // Remove "ambassador" from role name
            const displayName = role.name.replace(/\bambassador\b/gi, '').trim();

            // Add emoji based on index
            let emojiPrefix = '';
            switch(i) {
                case 1:
                    emojiPrefix = '🌱  ';  // 2nd role
                    break;
                case 2:
                    emojiPrefix = '🌼  ';  // 3rd role
                    break;
                case 3:
                    emojiPrefix = '🌲  ';  // 4th role
                    break;
                case 4:
                    emojiPrefix = '🌳  ';  // 5th role
                    break;
                case 5:
                    emojiPrefix = '🥼  ';  // 6th role
                    break;
            }

            embed.addFields({ 
                name: `${emojiPrefix}${displayName}`, 
                value: `${count} (${percentage}%)`, 
                inline: true 
            });
        }

        // Add unverified members as the last field
        embed.addFields({ 
            name: 'Unverified Members', 
            value: `${unverifiedMembers} (${unverifiedPercentage}%)`, 
            inline: false 
        });

         // Verify counts
        if (DEBUG_MODE) {
            debugLog('\n=== Final Count Verification ===');
            debugLog(`Total members: ${totalMembers}`);
            debugLog(`Total role count: ${totalRoleCount}`);
            debugLog(`Counted unique members: ${globalCountedMembers.size}`);
            debugLog(`Unaccounted verified members: ${totalMembers - unverifiedMembers - globalCountedMembers.size}`);

            // List unaccounted verified members
            const unaccountedMembers = guild.members.cache
                .filter(m => 
                    m.roles.cache.has(verifiedRoleId) && 
                    !globalCountedMembers.has(m.id) &&
                    !memberHasIgnoredRole(m, ignoredRoleIds)
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

        await message.channel.send({ embeds: [embed] });
        debugLog('Count command completed successfully');

    } catch (error) {
        debugLog('Error in count command:', error);
        debugLog(`Error stack: ${error.stack}`);
        await message.channel.send('An error occurred while counting members.');
    }
});

client.login(token);
