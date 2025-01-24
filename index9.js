require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const cron = require('node-cron');

// Simplified logging
function log(level, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
    if (error) {
        console.error(error);
    }
}

// Initialize Discord client with optimized settings
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel],
    cache: {
        members: { maxSize: 1000 },
        channels: { maxSize: 100 },
        roles: { maxSize: 100 }
    }
});

// Simplified cache management
const cache = {
    members: new Map(),
    roles: new Map(),
    lastUpdate: null,
    maxAge: 3600000, // 1 hour

    async refresh(guild) {
        try {
            const members = await guild.members.fetch({
                withPresences: false,
                time: 15000
            });

            // Store simplified member data
            const simplifiedMembers = new Map();
            members.forEach(member => {
                simplifiedMembers.set(member.id, {
                    id: member.id,
                    roles: Array.from(member.roles.cache.keys()),
                    isBot: member.user.bot
                });
            });

            this.members.set(guild.id, simplifiedMembers);
            this.lastUpdate = Date.now();
            this.cleanup();

            return simplifiedMembers;
        } catch (error) {
            log('ERROR', 'Failed to refresh member cache', error);
            throw error;
        }
    },

    async getMembers(guild) {
        const cached = this.members.get(guild.id);
        if (!cached || !this.lastUpdate || Date.now() - this.lastUpdate > this.maxAge) {
            return await this.refresh(guild);
        }
        return cached;
    },

    cleanup() {
        if (this.members.size > 1000) {
            const entries = Array.from(this.members.entries());
            const toRemove = entries.slice(0, entries.length - 1000);
            toRemove.forEach(([key]) => this.members.delete(key));
        }
    }
};

// Simple command handler with cooldowns
const commandHandler = {
    commands: new Map(),
    cooldowns: new Map(),
    
    register(name, handler, cooldown = 0) {
        this.commands.set(name, { handler, cooldown });
    },

    canExecute(userId, command) {
        if (!command.cooldown) return true;
        const now = Date.now();
        const userCooldowns = this.cooldowns.get(userId) || new Map();
        const lastUsed = userCooldowns.get(command) || 0;

        if (now - lastUsed < command.cooldown) {
            return false;
        }

        userCooldowns.set(command, now);
        this.cooldowns.set(userId, userCooldowns);
        return true;
    },

    async handle(message) {
        if (!message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = this.commands.get(commandName);

        if (!command) return;

        if (!this.canExecute(message.author.id, command)) {
            await message.reply('Please wait before using this command again.');
            return;
        }

        try {
            await command.handler(message, args);
        } catch (error) {
            log('ERROR', `Command execution failed: ${commandName}`, error);
            await message.reply('An error occurred while executing the command.');
        }
    }
};

// Load configuration
const config = {
    token: process.env.DISCORD_BOT_TOKEN,
    allowedRoles: process.env.ALLOWED_ROLES.split(','),
    ignoredRoleId: process.env.IGNORED_ROLE,
    cronSchedule: process.env.CRON_SCHEDULE,
    totalMemberCountChannelId: process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID,
    totalMemberCountNameFormat: process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT,
    verifiedRoleId: process.env.VERIFIED_ROLE,
    roles: [],
    channels: [],
    channelBaseNames: []
};

// Load role configurations
for (let i = 1; process.env[`ROLE_${i}`]; i++) {
    config.roles.push(process.env[`ROLE_${i}`]);
    config.channels.push(process.env[`CHANNEL_${i}`]);
    config.channelBaseNames.push(process.env[`CHANNEL_NAME_${i}`]);
}

// Utility functions
const utils = {
    async updateChannel(channel, newName) {
        try {
            await channel.setName(newName);
            log('INFO', `Channel updated: ${channel.id} -> ${newName}`);
        } catch (error) {
            log('ERROR', `Failed to update channel: ${channel.id}`, error);
            throw error;
        }
    },

    calculatePercentage(part, total) {
        return ((part / total) * 100).toFixed(3);
    }
};

// Channel update functionality
async function updateChannelNames() {
    const guild = client.guilds.cache.first();
    if (!guild) {
        log('ERROR', 'No guild found');
        return;
    }

    try {
        const members = await cache.getMembers(guild);
        const humanMembers = new Map([...members].filter(([, m]) => !m.isBot));
        const totalMemberCount = humanMembers.size;

        // Update total member count channel
        const totalMemberCountChannel = guild.channels.cache.get(config.totalMemberCountChannelId);
        if (totalMemberCountChannel) {
            await utils.updateChannel(
                totalMemberCountChannel,
                config.totalMemberCountNameFormat.replace('{count}', totalMemberCount)
            );
        }

        // Update role-based channels
        for (let i = 0; i < config.roles.length; i++) {
            const roleId = config.roles[i];
            const channelId = config.channels[i];
            const channelBaseName = config.channelBaseNames[i];

            const channel = guild.channels.cache.get(channelId);
            if (!channel) continue;

            const membersWithRole = new Map(
                [...members].filter(([, m]) => 
                    m.roles.includes(roleId) && !m.roles.includes(config.ignoredRoleId)
                )
            );

            await utils.updateChannel(
                channel,
                channelBaseName.replace('{count}', membersWithRole.size)
            );
            
            // Rate limit prevention
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        log('ERROR', 'Failed to update channel names', error);
    }
}

// Register count command
commandHandler.register('count', async (message, args) => {
    const memberRoles = message.member.roles.cache.map(role => role.name);
    if (!config.allowedRoles.some(role => memberRoles.includes(role))) {
        return;
    }

    try {
        const guild = message.guild;
        const members = await cache.getMembers(guild);
        const n = parseInt(args[0], 10);

        let response = '';

        const totalMembersCount = [...members.values()].filter(m => !m.isBot).length;
        response += `Total Members: **${totalMembersCount}** members.\n`;

        const unverifiedMembers = [...members.values()].filter(m => 
            !m.roles.includes(config.verifiedRoleId) && !m.isBot
        );
        const unverifiedPercentage = utils.calculatePercentage(unverifiedMembers.length, totalMembersCount);
        response += `Unverified: **${unverifiedMembers.length}** members (${unverifiedPercentage}%) without the verified role.\n\n`;

        const rolesToProcess = isNaN(n) ? config.roles.length : Math.min(n, config.roles.length);
        
        for (let i = 0; i < rolesToProcess; i++) {
            const roleId = config.roles[i];
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            const membersWithRole = [...members.values()].filter(m => 
                m.roles.includes(roleId) && !m.isBot
            );

            const count = membersWithRole.length;
            const percentage = utils.calculatePercentage(count, totalMembersCount);
            response += `${role.name}: **${count}** members (${percentage}%) with this role.\n`;
        }

        await message.channel.send(response);
        log('INFO', `Count command executed by ${message.author.id}`);
    } catch (error) {
        log('ERROR', 'Count command failed', error);
        await message.reply('An error occurred while processing the command.');
    }
}, 5000); // 5 seconds cooldown

// Schedule channel updates
function scheduleChannelUpdate() {
    if (!cron.validate(config.cronSchedule)) {
        log('ERROR', 'Invalid cron schedule');
        process.exit(1);
    }

    cron.schedule(config.cronSchedule, () => {
        updateChannelNames().catch(error => 
            log('ERROR', 'Scheduled update failed', error)
        );
    });

    // Run initial update
    updateChannelNames().catch(error => 
        log('ERROR', 'Initial update failed', error)
    );
}

// Event handlers
client.on('ready', () => {
    log('INFO', 'Bot is ready!');
    scheduleChannelUpdate();
});

client.on('messageCreate', message => {
    if (!message.author.bot) {
        commandHandler.handle(message).catch(error => 
            log('ERROR', 'Message handling failed', error)
        );
    }
});

// Error handling
process.on('unhandledRejection', error => {
    log('ERROR', 'Unhandled promise rejection', error);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

// Start the bot
client.login(config.token).catch(error => {
    log('ERROR', 'Failed to login', error);
    process.exit(1);
});