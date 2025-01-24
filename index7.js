require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Logger Class
class Logger {
    constructor() {
        this.logDir = path.join(__dirname, 'logs');
        this.currentDate = this.formatDate(new Date());
        this.logFile = path.join(this.logDir, `bot-${this.currentDate}.log`);
        
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir);
        }
    }

    formatDate(date) {
        return date.toISOString().split('T')[0];
    }

    formatTimestamp(date) {
        const pad = (num) => num.toString().padStart(2, '0');
        
        const year = date.getUTCFullYear();
        const month = pad(date.getUTCMonth() + 1);
        const day = pad(date.getUTCDate());
        const hours = pad(date.getUTCHours());
        const minutes = pad(date.getUTCMinutes());
        const seconds = pad(date.getUTCSeconds());

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    formatMessage(level, message, context = {}) {
        const timestamp = this.formatTimestamp(new Date());
        const contextStr = Object.keys(context).length ? JSON.stringify(context) : '';
        return `[${timestamp}] [${level}] ${message} ${contextStr}\n`;
    }

    writeToFile(message) {
        const today = this.formatDate(new Date());
        if (today !== this.currentDate) {
            this.currentDate = today;
            this.logFile = path.join(this.logDir, `bot-${this.currentDate}.log`);
        }
        fs.appendFileSync(this.logFile, message);
    }

    info(message, context = {}) {
        const logMessage = this.formatMessage('INFO', message, context);
        console.log(logMessage.trim());
        this.writeToFile(logMessage);
    }

    warn(message, context = {}) {
        const logMessage = this.formatMessage('WARN', message, context);
        console.warn(logMessage.trim());
        this.writeToFile(logMessage);
    }

    error(message, error = null, context = {}) {
        if (error) {
            context.error = {
                message: error.message,
                stack: error.stack,
                name: error.name
            };
        }
        const logMessage = this.formatMessage('ERROR', message, context);
        console.error(logMessage.trim());
        this.writeToFile(logMessage);
    }

    debug(message, context = {}) {
        if (process.env.DEBUG === 'true') {
            const logMessage = this.formatMessage('DEBUG', message, context);
            console.debug(logMessage.trim());
            this.writeToFile(logMessage);
        }
    }
}

// Initialize logger
const logger = new Logger();

// Custom error class
class BotError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'BotError';
        this.context = context;
        this.timestamp = new Date().toISOString();
    }
}

// Rate Limiter Class
class RateLimiter {
    constructor(timeWindow = 60000, maxRequests = 10) {
        this.timeWindow = timeWindow;
        this.maxRequests = maxRequests;
        this.requests = new Map();
    }

    async canMakeRequest(key) {
        const now = Date.now();
        const timestamps = this.requests.get(key) || [];
        const validTimestamps = timestamps.filter(time => now - time < this.timeWindow);
        
        if (validTimestamps.length >= this.maxRequests) {
            return false;
        }

        validTimestamps.push(now);
        this.requests.set(key, validTimestamps);
        return true;
    }
}

// Command Handler Class
class CommandHandler {
    constructor() {
        this.commands = new Map();
        this.rateLimiter = new RateLimiter();
    }

    register(name, {
        execute,
        permissions = [],
        cooldown = 0
    }) {
        this.commands.set(name, {
            execute,
            permissions,
            cooldown,
            lastUsed: new Map()
        });
    }

    async handle(message) {
        if (!message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = this.commands.get(commandName);
        if (!command) return;

        // Rate limit check
        if (!(await this.rateLimiter.canMakeRequest(message.author.id))) {
            await message.reply('You are being rate limited. Please try again later.');
            return;
        }

        // Permission check
        if (!this.checkPermissions(message.member, command.permissions)) {
            await message.reply('You do not have permission to use this command.');
            return;
        }

        // Cooldown check
        if (!this.checkCooldown(message.author.id, command)) {
            await message.reply('Please wait before using this command again.');
            return;
        }

        try {
            await command.execute(message, args);
        } catch (error) {
            logger.error('Command execution failed', error, {
                command: commandName,
                userId: message.author.id
            });
            await message.reply('An error occurred while executing the command.');
        }
    }

    checkPermissions(member, requiredPermissions) {
        return requiredPermissions.every(permission => 
            member.permissions.has(permission));
    }

    checkCooldown(userId, command) {
        if (command.cooldown === 0) return true;

        const now = Date.now();
        const lastUsed = command.lastUsed.get(userId) || 0;
        
        if (now - lastUsed < command.cooldown) return false;
        
        command.lastUsed.set(userId, now);
        return true;
    }
}

// Configuration validation
function validateConfig() {
    const requiredEnvVars = [
        'DISCORD_BOT_TOKEN',
        'ALLOWED_ROLES',
        'IGNORED_ROLE',
        'CRON_SCHEDULE',
        'TOTAL_MEMBER_COUNT_CHANNEL_ID',
        'TOTAL_MEMBER_COUNT_NAME_FORMAT',
        'VERIFIED_ROLE'
    ];

    const missing = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missing.length > 0) {
        throw new BotError('Missing required environment variables', { missing });
    }
}

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// Enhanced Cache Management
const cache = {
    members: new Map(),
    roles: new Map(),
    lastUpdate: null,
    maxAge: 3600000, // 1 hour in milliseconds

    async refresh(guild) {
        try {
            logger.debug('Refreshing member cache', { guildId: guild.id });
            const members = await guild.members.fetch({
                withPresences: false
            });
            this.members.set(guild.id, members);
            this.lastUpdate = Date.now();
            logger.info('Member cache refreshed', {
                guildId: guild.id,
                memberCount: members.size,
                timestamp: this.lastUpdate
            });
            return members;
        } catch (error) {
            logger.error('Failed to refresh member cache', error, { guildId: guild.id });
            throw error;
        }
    },

    async getMembers(guild) {
        const cached = this.members.get(guild.id);
        if (!cached || this.isStale(guild.id)) {
            return await this.refresh(guild);
        }
        return cached;
    },

    updateRoles(guild) {
        const roleMap = new Map();
        guild.roles.cache.forEach(role => {
            roleMap.set(role.id, role);
        });
        this.roles.set(guild.id, roleMap);
        logger.debug('Roles cache updated', { guildId: guild.id });
    },

    invalidate(guildId) {
        this.members.delete(guildId);
        this.roles.delete(guildId);
        this.lastUpdate = null;
        logger.debug('Cache invalidated', { guildId });
    },

    isStale(guildId) {
        return !this.lastUpdate || Date.now() - this.lastUpdate > this.maxAge;
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
            logger.info('Channel updated', {
                channelId: channel.id,
                newName: newName
            });
        } catch (error) {
            logger.error('Failed to update channel name', error, {
                channelId: channel.id,
                newName: newName
            });
            throw new BotError('Failed to update channel name', {
                channelId: channel.id,
                newName: newName,
                error: error.message
            });
        }
    },

    getEffectiveRole(member, ignoredRoleId) {
        const highestRole = member.roles.highest;
        if (highestRole.id === ignoredRoleId) {
            return member.roles.cache
                .filter(r => r.id !== ignoredRoleId)
                .sort((a, b) => b.position - a.position)
                .first();
        }
        return highestRole;
    },

    calculatePercentage(part, total) {
        return ((part / total) * 100).toFixed(3);
    }
};

// Channel update functionality
async function updateChannelNames() {
    const guild = client.guilds.cache.first();
    if (!guild) {
        logger.error('No guild found');
        return;
    }

    try {
        const members = await cache.getMembers(guild);
        const channelUpdates = [];

        // Update total member count
        const humanMembers = members.filter(member => !member.user.bot);
        const totalMemberCount = humanMembers.size;
        
        logger.debug('Member statistics', {
            total: members.size,
            humans: totalMemberCount,
            bots: members.size - totalMemberCount
        });

        const totalMemberCountChannel = guild.channels.cache.get(config.totalMemberCountChannelId);
        if (totalMemberCountChannel) {
            channelUpdates.push({
                channel: totalMemberCountChannel,
                newName: config.totalMemberCountNameFormat.replace('{count}', totalMemberCount)
            });
        }

        // Update role-based channels
        for (let i = 0; i < config.roles.length; i++) {
            const roleId = config.roles[i];
            const channelId = config.channels[i];
            const channelBaseName = config.channelBaseNames[i];

            const role = guild.roles.cache.get(roleId);
            const channel = guild.channels.cache.get(channelId);

            if (!role || !channel) continue;

            const membersWithRole = members.filter(member => {
                const effectiveRole = utils.getEffectiveRole(member, config.ignoredRoleId);
                return effectiveRole.id === roleId;
            });

            channelUpdates.push({
                channel,
                newName: channelBaseName.replace('{count}', membersWithRole.size)
            });
        }

        // Execute updates with rate limiting
        for (const update of channelUpdates) {
            try {
                await utils.updateChannel(update.channel, update.newName);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                logger.error('Channel update failed', error, {
                    channelId: update.channel.id,
                    newName: update.newName
                });
            }
        }
    } catch (error) {
        logger.error('Error in updateChannelNames', error, { guildId: guild.id });
    }
}

// Initialize command handler
const commandHandler = new CommandHandler();

// Register commands
commandHandler.register('count', {
    execute: async (message, args) => {
        const memberRoles = message.member.roles.cache.map(role => role.name);
        if (!config.allowedRoles.some(role => memberRoles.includes(role))) {
            logger.warn('Unauthorized command attempt', {
                userId: message.author.id,
                command: 'count'
            });
            return;
        }

        try {
            const guild = message.guild;
            const members = await cache.getMembers(guild);
            const n = parseInt(args[0], 10);

            let response = '';

            // Calculate total members
            const totalMembersCount = members.filter(member => !member.user.bot).size;
            response += `Total Members: **${totalMembersCount}** members.\n`;

            // Calculate unverified members
            const unverifiedMembers = members.filter(member => 
                !member.roles.cache.has(config.verifiedRoleId) && !member.user.bot
            );
            const unverifiedPercentage = utils.calculatePercentage(unverifiedMembers.size, totalMembersCount);
            response += `Unverified: **${unverifiedMembers.size}** members (${unverifiedPercentage}%) without the verified role.\n\n`;

            // Process roles
            const rolesToProcess = isNaN(n) ? config.roles.length : Math.min(n, config.roles.length);
            
            for (let i = 0; i < rolesToProcess; i++) {
                const role = guild.roles.cache.get(config.roles[i]);
                if (!role) continue;

                const membersWithRole = members.filter(member => {
                    const effectiveRole = utils.getEffectiveRole(member, config.ignoredRoleId);
                    return effectiveRole.id === role.id;
                });

                const count = membersWithRole.size;
                const percentage = utils.calculatePercentage(count, totalMembersCount);
				response += `${role.name}: **${count}** members (${percentage}%) with it as their highest role`;
                if (membersWithRole.some(m => m.roles.cache.has(config.ignoredRoleId))) {
                    const ignoredRole = guild.roles.cache.get(config.ignoredRoleId);
                    response += ` (including members with ${ignoredRole ? ignoredRole.name : 'ignored role'})`;
                }
                response += '.\n';
            }

            await message.channel.send(response);
            logger.info('Count command executed', {
                userId: message.author.id,
                channelId: message.channel.id
            });
        } catch (error) {
            logger.error('Count command failed', error, {
                userId: message.author.id,
                channelId: message.channel.id
            });
            await message.channel.send('An error occurred while processing the command.');
        }
    },
    permissions: [PermissionsBitField.Flags.ViewChannel],
    cooldown: 5000 // 5 seconds cooldown
});

// Schedule channel updates
function scheduleChannelUpdate() {
    if (!cron.validate(config.cronSchedule)) {
        throw new BotError('Invalid cron schedule', { schedule: config.cronSchedule });
    }

    cron.schedule(config.cronSchedule, async () => {
        logger.debug('Running scheduled channel update');
        try {
            await updateChannelNames();
        } catch (error) {
            logger.error('Scheduled channel update failed', error);
        }
    });

    // Run initial update
    updateChannelNames().catch(error => 
        logger.error('Initial channel update failed', error));
}

// Event handlers
client.on('ready', () => {
    try {
        validateConfig();
        logger.info('Bot is ready!', {
            username: client.user.username,
            id: client.user.id,
            guildCount: client.guilds.cache.size
        });
        cache.updateRoles(client.guilds.cache.first());
        scheduleChannelUpdate();
    } catch (error) {
        logger.error('Failed to initialize bot', error);
        process.exit(1);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    try {
        await commandHandler.handle(message);
    } catch (error) {
        logger.error('Message handling failed', error, {
            messageId: message.id,
            channelId: message.channel.id
        });
    }
});

// Error handling
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection', error);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal. Shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

// Start the bot
client.login(config.token).catch(error => {
    logger.error('Failed to login', error);
    process.exit(1);
});