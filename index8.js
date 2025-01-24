require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

// Logger Class
class Logger {
    constructor() {
        this.logDir = path.join(__dirname, 'logs');
        this.currentDate = this.formatDate(new Date());
        this.logFile = path.join(this.logDir, `bot-${this.currentDate}.log`);
        this.writeQueue = [];
        this.isWriting = false;
        
        this.initializeLogDir();
        this.cleanOldLogs();
    }

    async initializeLogDir() {
        try {
            await fs.access(this.logDir);
        } catch {
            await fs.mkdir(this.logDir);
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

    async cleanOldLogs() {
        const MAX_LOG_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
        try {
            const files = await fs.readdir(this.logDir);
            const now = Date.now();
            
            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtime.getTime() > MAX_LOG_AGE) {
                    await fs.unlink(filePath);
                }
            }
        } catch (error) {
            console.error('Failed to clean old logs:', error);
        }
    }

    async writeToFile(message) {
        this.writeQueue.push(message);
        if (!this.isWriting) {
            this.isWriting = true;
            await this.processWriteQueue();
        }
    }

    async processWriteQueue() {
        while (this.writeQueue.length > 0) {
            const batch = this.writeQueue.splice(0, 10).join('');
            try {
                await fs.appendFile(this.logFile, batch);
            } catch (error) {
                console.error('Failed to write to log file:', error);
            }
        }
        this.isWriting = false;
    }

    async info(message, context = {}) {
        const logMessage = this.formatMessage('INFO', message, context);
        console.log(logMessage.trim());
        await this.writeToFile(logMessage);
    }

    async warn(message, context = {}) {
        const logMessage = this.formatMessage('WARN', message, context);
        console.warn(logMessage.trim());
        await this.writeToFile(logMessage);
    }

    async error(message, error = null, context = {}) {
        if (error) {
            context.error = {
                message: error.message,
                stack: error.stack,
                name: error.name
            };
        }
        const logMessage = this.formatMessage('ERROR', message, context);
        console.error(logMessage.trim());
        await this.writeToFile(logMessage);
    }

    async debug(message, context = {}) {
        if (process.env.DEBUG === 'true') {
            const logMessage = this.formatMessage('DEBUG', message, context);
            console.debug(logMessage.trim());
            await this.writeToFile(logMessage);
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

    cleanup() {
        const now = Date.now();
        this.requests.forEach((timestamps, key) => {
            const validTimestamps = timestamps.filter(time => now - time < this.timeWindow);
            if (validTimestamps.length === 0) {
                this.requests.delete(key);
            } else {
                this.requests.set(key, validTimestamps);
            }
        });
    }
}

// Command Handler Class
class CommandHandler {
    constructor() {
        this.commands = new Map();
        this.rateLimiter = new RateLimiter();
        this.cooldowns = new Map();
    }

    register(name, {
        execute,
        permissions = [],
        cooldown = 0
    }) {
        this.commands.set(name, {
            execute,
            permissions,
            cooldown
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
        const timestamps = this.cooldowns.get(userId) || [];
        const validTimestamps = timestamps.filter(time => now - time < command.cooldown);

        if (validTimestamps.length > 0) return false;
        
        validTimestamps.push(now);
        this.cooldowns.set(userId, validTimestamps);
        return true;
    }

    cleanup() {
        const now = Date.now();
        this.cooldowns.forEach((timestamps, userId) => {
            const filtered = timestamps.filter(time => now - time < 3600000);
            if (filtered.length === 0) {
                this.cooldowns.delete(userId);
            } else {
                this.cooldowns.set(userId, filtered);
            }
        });
        this.rateLimiter.cleanup();
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

// Initialize Discord client with optimized settings
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel],
    makeCache: Options.cacheWithLimits({
        ApplicationCommandManager: 0,
        BaseGuildEmojiManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildStickerManager: 0,
        MessageManager: 10,
        PresenceManager: 0,
        VoiceStateManager: 0,
        ThreadManager: 0,
    }),
    sweepers: {
        messages: {
            interval: 300,
            lifetime: 600
        }
    }
});

// Optimized Cache Management
const cache = {
    members: new Map(),
    roles: new Map(),
    lastUpdate: null,
    maxAge: 3600000,
    maxCacheSize: 1000,

    async refresh(guild) {
        try {
            logger.debug('Refreshing member cache', { guildId: guild.id });
            
            const members = await guild.members.fetch({
                withPresences: false,
                time: 15000
            });

            const simplifiedMembers = new Map();
            members.forEach((member) => {
                simplifiedMembers.set(member.id, {
                    id: member.id,
                    roles: Array.from(member.roles.cache.keys()),
                    isBot: member.user.bot
                });
            });

            this.members.set(guild.id, simplifiedMembers);
            this.lastUpdate = Date.now();
            
            if (simplifiedMembers.size > this.maxCacheSize) {
                this.cleanup();
            }

            return simplifiedMembers;
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
            roleMap.set(role.id, {
                id: role.id,
                name: role.name,
                position: role.position
            });
        });
        this.roles.set(guild.id, roleMap);
    },

    cleanup() {
        const entries = Array.from(this.members.entries());
        if (entries.length > this.maxCacheSize) {
            const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
            toRemove.forEach(([key]) => this.members.delete(key));
        }
    },

    isStale(guildId) {
        return !this.lastUpdate || Date.now() - this.lastUpdate > this.maxAge;
    },

    invalidate(guildId) {
        this.members.delete(guildId);
        this.roles.delete(guildId);
        this.lastUpdate = null;
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

// Memory usage monitoring
function logMemoryUsage() {
    const used = process.memoryUsage();
    logger.debug('Memory usage', {
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
        rss: `${Math.round(used.rss / 1024 / 1024)} MB`
    });
}

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

        const humanMembers = new Map([...members].filter(([, member]) => !member.isBot));
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

        for (let i = 0; i < config.roles.length; i++) {
            const roleId = config.roles[i];
            const channelId = config.channels[i];
            const channelBaseName = config.channelBaseNames[i];

            const channel = guild.channels.cache.get(channelId);
            if (!channel) continue;

            const membersWithRole = new Map(
                [...members].filter(([, member]) => 
                    member.roles.includes(roleId) &&
                    !member.roles.includes(config.ignoredRoleId)
                )
            );

            channelUpdates.push({
                channel,
                newName: channelBaseName.replace('{count}', membersWithRole.size)
            });
        }

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
            logger.info('Count command executed', {
                userId: message.author.id,
                channelId: message.channel.id
            });
        } catch (error) {
            logger.error('Count command failed', error, {
                userId: message.author.id,
                channelId: message.channel.id
            });
            await message.reply('An error occurred while processing the command.');
        }
    },
    cooldown: 5000
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

    updateChannelNames().catch(error => 
        logger.error('Initial channel update failed', error));
}

// Memory cleanup interval
setInterval(() => {
    if (global.gc) {
        global.gc();
    }
    commandHandler.cleanup();
    cache.cleanup();
}, 3600000);

// Memory usage logging
setInterval(logMemoryUsage, 300000);

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