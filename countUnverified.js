const { EmbedBuilder } = require('discord.js');

function setupCountUnverifiedCommand(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog }) {
    client.on('messageCreate', async message => {
        if (message.content.trim() !== '!count unverified') return;
        
        debugLog('Count unverified command received', {
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
            debugLog('Fetched all guild members for unverified count command');

            // Get unverified members
            const unverifiedMembers = guild.members.cache
                .filter(member => !member.user.bot && !member.roles.cache.has(verifiedRoleId))
                .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);

            if (unverifiedMembers.size === 0) {
                await message.channel.send('No unverified members found.');
                return;
            }

            // Create the list with numbered entries
            let currentMessage = `Total Unverified Members: ${unverifiedMembers.size}\n\n`;
            let messageNumber = 1;
            let counter = 1;

            for (const member of unverifiedMembers.values()) {
                // Create a proper user mention using the member's ID
                const entry = `${counter}. <@${member.user.id}>\n`;
                
                // Discord message length limit is 2000 characters
                if (currentMessage.length + entry.length > 1900) {
                    // Send current message and start a new one
                    await message.channel.send(currentMessage);
                    currentMessage = '';
                    messageNumber++;
                }
                
                currentMessage += entry;
                counter++;
            }

            // Send any remaining content
            if (currentMessage.length > 0) {
                await message.channel.send(currentMessage);
            }

            guild.members.cache.clear();
            debugLog(`Unverified count command completed - ${unverifiedMembers.size} members listed in ${messageNumber} messages`);

        } catch (error) {
            debugLog('Error in count unverified command:', error);
            await message.channel.send('An error occurred while counting unverified members.');
        }
    });
}

module.exports = setupCountUnverifiedCommand;