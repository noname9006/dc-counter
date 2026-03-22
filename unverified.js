const { AttachmentBuilder } = require('discord.js');

function setupExtractCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog }) {
    client.on('messageCreate', async message => {
        if (!message.content.startsWith('!extract')) return;
        
        debugLog('Extract command received', {
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

        const command = message.content.toLowerCase().trim();
        
        if (command === '!extract unverified') {
            try {
                const guild = message.guild;
                await guild.members.fetch();
                debugLog('Fetched all guild members for extract command');

                // Get unverified members
                const unverifiedMembers = guild.members.cache
                    .filter(member => !member.user.bot && !member.roles.cache.has(verifiedRoleId))
                    .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);

                // Create CSV content with more detailed information
                let csvContent = 'User ID,Username,Display Name,Join Date (UTC),Account Created (UTC)\n';
                unverifiedMembers.forEach(member => {
                    const joinDate = new Date(member.joinedTimestamp).toISOString().replace('T', ' ').split('.')[0];
                    const createdDate = new Date(member.user.createdTimestamp).toISOString().replace('T', ' ').split('.')[0];
                    const username = member.user.username.replace(/,/g, ' '); // Remove commas to avoid CSV issues
                    const displayName = member.displayName.replace(/,/g, ' '); // Remove commas to avoid CSV issues
                    
                    csvContent += `${member.id},${username},${displayName},${joinDate},${createdDate}\n`;
                });

                if (unverifiedMembers.size === 0) {
                    await message.channel.send('No unverified members found.');
                    return;
                }

                // Create and send file
                const currentDate = new Date().toISOString().split('T')[0];
                const fileName = `unverified_members_${currentDate}.csv`;
                
                const attachment = new AttachmentBuilder(
                    Buffer.from(csvContent, 'utf-8'), 
                    { name: fileName }
                );

                await message.channel.send({
                    content: `Found ${unverifiedMembers.size} unverified members. Data includes:\n` +
                            '• User ID (for mentioning: <@user_id>)\n' +
                            '• Username\n' +
                            '• Display Name\n' +
                            '• Join Date (UTC)\n' +
                            '• Account Creation Date (UTC)',
                    files: [attachment]
                });

                guild.members.cache.clear();
                debugLog(`Extract command completed - ${unverifiedMembers.size} members exported to ${fileName}`);
            } catch (error) {
                debugLog('Error in extract command:', error);
                await message.channel.send('An error occurred while extracting member data.');
            }
        }
        
        else if (command === '!extract noroles') {
            try {
                const guild = message.guild;
                await guild.members.fetch();
                debugLog('Fetched all guild members for noroles extract command');

                // Get members with no roles (except @everyone)
                const noRoleMembers = guild.members.cache
                    .filter(member => {
                        // Filter out bots and count only users with exactly 1 role (@everyone)
                        return !member.user.bot && member.roles.cache.size === 1;
                    })
                    .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);

                // Create CSV content with detailed information
                let csvContent = 'User ID,Username,Display Name,Join Date (UTC),Account Created (UTC),Time Without Roles\n';
                noRoleMembers.forEach(member => {
                    const joinDate = new Date(member.joinedTimestamp).toISOString().replace('T', ' ').split('.')[0];
                    const createdDate = new Date(member.user.createdTimestamp).toISOString().replace('T', ' ').split('.')[0];
                    const username = member.user.username.replace(/,/g, ' ');
                    const displayName = member.displayName.replace(/,/g, ' ');
                    
                    // Calculate time without roles
                    const now = new Date();
                    const joinTime = new Date(member.joinedTimestamp);
                    const daysSinceJoin = Math.floor((now - joinTime) / (1000 * 60 * 60 * 24));
                    const timeWithoutRoles = `${daysSinceJoin} days`;
                    
                    csvContent += `${member.id},${username},${displayName},${joinDate},${createdDate},${timeWithoutRoles}\n`;
                });

                if (noRoleMembers.size === 0) {
                    await message.channel.send('No members without roles found.');
                    return;
                }

                // Create and send file
                const currentDate = new Date().toISOString().split('T')[0];
                const fileName = `norole_members_${currentDate}.csv`;
                
                const attachment = new AttachmentBuilder(
                    Buffer.from(csvContent, 'utf-8'), 
                    { name: fileName }
                );

                await message.channel.send({
                    content: `Found ${noRoleMembers.size} members without roles. Data includes:\n` +
                            '• User ID (for mentioning: <@user_id>)\n' +
                            '• Username\n' +
                            '• Display Name\n' +
                            '• Join Date (UTC)\n' +
                            '• Account Creation Date (UTC)\n' +
                            '• Time Without Roles',
                    files: [attachment]
                });

                guild.members.cache.clear();
                debugLog(`Extract noroles command completed - ${noRoleMembers.size} members exported to ${fileName}`);
            } catch (error) {
                debugLog('Error in extract noroles command:', error);
                await message.channel.send('An error occurred while extracting member data.');
            }
        }
    });
}

module.exports = { setupExtractCommands };