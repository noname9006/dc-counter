const { EmbedBuilder } = require('discord.js');

class PurgeManager {
    constructor() {
        this.activeOperations = new Map();
    }

    getOperation(guildId, type) {
        const key = `${guildId}-${type}`;
        return this.activeOperations.get(key);
    }

    setOperation(guildId, type, operation) {
        const key = `${guildId}-${type}`;
        this.activeOperations.set(key, operation);
    }

    deleteOperation(guildId, type) {
        const key = `${guildId}-${type}`;
        this.activeOperations.delete(key);
    }
}

class PurgeOperation {
    constructor(guildId, client, type, rate, debugLog) {
        this.guildId = guildId;
        this.client = client;
        this.type = type;
        this.rate = rate;
        this.debugLog = debugLog;
        this.isRunning = false;
        this.startTime = null;
        this.processedCount = 0;
        this.skippedCount = 0;
        this.intervalId = null;
    }

    async start(verifiedRoleId) {
        if (this.isRunning) {
            return false;
        }

        this.isRunning = true;
        this.startTime = new Date();
        this.processedCount = 0;
        this.skippedCount = 0;

        this.log('START', {
            rate: this.rate,
            type: this.type,
            startTime: this.formatUTCDate(this.startTime)
        });

        // Start hourly processing
        this.intervalId = setInterval(() => this.processBatch(verifiedRoleId), 3600000);
        // Run first batch immediately
        await this.processBatch(verifiedRoleId);
        return true;
    }

    stop() {
        if (!this.isRunning) {
            return false;
        }

        clearInterval(this.intervalId);
        this.isRunning = false;
        
        this.log('STOP', {
            type: this.type,
            processedTotal: this.processedCount,
            skippedTotal: this.skippedCount,
            duration: this.formatDuration(Date.now() - this.startTime)
        });

        return true;
    }

    async processBatch(verifiedRoleId) {
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild) {
            this.log('ERROR', { reason: `Guild ${this.guildId} not found in cache` });
            return;
        }
        await guild.members.fetch();

        const now = new Date();
        const cutoffDate = new Date(now - 24 * 60 * 60 * 1000); // 24 hours ago

        const members = guild.members.cache
            .filter(member => {
                // Basic filters
                if (member.user.bot) return false;
                if (!member.joinedAt || member.joinedAt > cutoffDate) return false;

                // Type-specific filters
                if (this.type === 'noroles') {
                    return member.roles.cache.size === 1; // Only @everyone role
                } else {
                    return !member.roles.cache.has(verifiedRoleId);
                }
            })
            .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp)
            .first(this.rate);

        for (const member of members) {
            try {
                // Recheck conditions before kicking
                const shouldKick = this.type === 'noroles' ?
                    member.roles.cache.size === 1 :
                    !member.roles.cache.has(verifiedRoleId);

                if (shouldKick && member.joinedAt < cutoffDate) {
                    const timeInServer = Math.floor((now - member.joinedAt) / (60 * 60 * 1000));
                    const reason = `Automated purge: ${this.type === 'noroles' ? 'No roles' : 'Not verified'} (joined ${timeInServer}h ago)`;

                    await member.kick(reason);
                    this.processedCount++;

                    this.log('KICK', {
                        userId: member.id,
                        username: member.user.username,
                        joinDate: this.formatUTCDate(member.joinedAt),
                        hoursInServer: timeInServer,
                        reason: reason
                    });
                } else {
                    this.skippedCount++;
                    const skipReason = member.joinedAt > cutoffDate ? 
                        'Joined less than 24h ago' : 
                        'Conditions no longer met';
                    
                    this.log('SKIP', {
                        userId: member.id,
                        username: member.user.username,
                        joinDate: this.formatUTCDate(member.joinedAt),
                        reason: skipReason
                    });
                }
            } catch (error) {
                this.log('ERROR', {
                    userId: member.id,
                    username: member.user.username,
                    error: error.message
                });
            }

            // Delay between kicks to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    getStatus() {
        if (!this.isRunning) {
            return null;
        }

        return {
            type: this.type,
            rate: this.rate,
            runningTime: this.formatDuration(Date.now() - this.startTime),
            processedCount: this.processedCount,
            skippedCount: this.skippedCount
        };
    }

    formatUTCDate(date) {
        return date.toISOString()
            .replace('T', ' ')
            .split('.')[0];
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }

    log(action, data) {
        const timestamp = this.formatUTCDate(new Date());
        const logEntry = {
            timestamp,
            action,
            ...data
        };
        this.debugLog(`PURGE: ${JSON.stringify(logEntry)}`);
    }
}

function setupPurgeCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog }) {
    const purgeManager = new PurgeManager();

    client.on('messageCreate', async message => {
        if (!message.content.startsWith('!purge')) return;

        // Check channel permission
        if (!allowedChannels.includes(message.channel.id)) {
            debugLog('Purge command used in unauthorized channel');
            return;
        }

        // Check role permission
        const memberRoles = message.member.roles.cache.map(role => role.name);
        if (!allowedRoles.some(role => memberRoles.includes(role))) {
            debugLog('Purge command used by unauthorized user');
            return;
        }

        const args = message.content.toLowerCase().split(' ');

        // Handle status and stop commands
        if (args[1] === 'status' || args[1] === 'stop') {
            const type = args[2];
            if (!type || !['noroles', 'unverified'].includes(type)) return;

            const operation = purgeManager.getOperation(message.guild.id, type);

            if (args[1] === 'stop') {
                if (operation?.stop()) {
                    purgeManager.deleteOperation(message.guild.id, type);
                    await message.reply(`Stopped ${type} purge operation.`);
                } else {
                    await message.reply(`No ${type} purge operation is running.`);
                }
                return;
            }

            if (!operation?.isRunning) {
                await message.reply(`No ${type} purge operation is running.`);
                return;
            }

            const status = operation.getStatus();
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`${type} Purge Status`)
                .addFields(
                    { name: 'Running Time', value: status.runningTime, inline: true },
                    { name: 'Rate', value: `${status.rate}/hour`, inline: true },
                    { name: 'Processed', value: status.processedCount.toString(), inline: true },
                    { name: 'Skipped', value: status.skippedCount.toString(), inline: true }
                )
                .setFooter({ text: 'Only affecting users who joined >24h ago' });

            await message.reply({ embeds: [embed] });
            return;
        }

        // Handle start command
        if (!['noroles', 'unverified'].includes(args[1]) || !args[2]?.startsWith('rate=')) return;

        const type = args[1];
        const rate = parseInt(args[2].split('=')[1]);
        
        if (isNaN(rate) || rate <= 0) {
            await message.reply('Invalid rate. Please specify a positive number.');
            return;
        }

        const existingOperation = purgeManager.getOperation(message.guild.id, type);
        if (existingOperation?.isRunning) {
            await message.reply(`A ${type} purge operation is already running.`);
            return;
        }

        const operation = new PurgeOperation(message.guild.id, client, type, rate, debugLog);
        purgeManager.setOperation(message.guild.id, type, operation);

        if (await operation.start(verifiedRoleId)) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Started ${type} Purge Operation`)
                .setDescription(`Rate: ${rate} users/hour\nStarted at: ${operation.formatUTCDate(new Date())}`)
                .setFooter({ text: 'Only affecting users who joined >24h ago' });

            await message.reply({ embeds: [embed] });
        }
    });
}

module.exports = { setupPurgeCommands };