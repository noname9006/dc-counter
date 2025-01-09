require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent // Add this if you need to handle message content
    ],
    partials: [
        Partials.Channel // Add this if you need to handle DM channels or other partials
    ]
});

const token = process.env.DISCORD_BOT_TOKEN; // Access the token from the environment variable
const allowedRoles = process.env.ALLOWED_ROLES.split(','); // Get the allowed roles from the environment variable
const countRoleIds = process.env.COUNT_ROLES.split(','); // Get the role IDs for counting from the environment variable
const ignoredRoleId = process.env.IGNORED_ROLE; // Get the ignored role ID from the environment variable

client.once('ready', () => {
    console.log('Bot is ready!');
});

client.on('messageCreate', async message => {
    if (message.content.startsWith('!count')) {
        // Check if the user has one of the allowed roles
        const memberRoles = message.member.roles.cache.map(role => role.name);
        const hasAllowedRole = allowedRoles.some(role => memberRoles.includes(role));

        if (!hasAllowedRole) {
            // Do not send any message if the user does not have the required roles
            return;
        }

        const guild = message.guild;
        await guild.members.fetch(); // Fetch all members in the guild

        let response = '';

        for (const roleId of countRoleIds) {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                response += `Role with ID "${roleId}" not found.\n`;
                continue;
            }

            let count = 0;
            let hasIgnoredRole = false;

            const membersWithRole = guild.members.cache.filter(member => {
                const highestRole = member.roles.highest;
                if (highestRole.id === roleId) {
                    return true;
                }
                if (highestRole.id === ignoredRoleId) {
                    // If the highest role is the ignored role, find the next highest role
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

            if (count > 0) {
                response += `"${role.name}": **${count}** members with it as their highest role`;
                if (hasIgnoredRole) {
                    const ignoredRole = guild.roles.cache.get(ignoredRoleId);
                    response += ` (including one with "${ignoredRole ? ignoredRole.name : 'ignored role'}")`;
                }
                response += '.\n';
            } else {
                response += `"${role.name}": **0** members with it as their highest role.\n`;
            }
        }

        message.channel.send(response);
    }
});

client.login(token);