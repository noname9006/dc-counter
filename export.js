const { debugLog, formatDate, cleanCSVString } = require('./utils');
const fs = require('fs').promises;
const path = require('path');

// Constants for processing
const BATCH_SIZE = 1000;
const MESSAGE_BATCH_SIZE = 100;
const RATE_LIMIT_DELAY = 250;
const MESSAGE_UPDATE_INTERVAL = 5000; // 5 seconds between progress updates
const SAVE_INTERVAL = 10; // Save progress every 10 users

class ExportProgress {
    constructor(guildId) {
        this.guildId = guildId;
        this.processedUsers = new Set();
        this.currentBatch = 0;
        this.totalBatches = 0;
        this.startTime = Date.now();
        this.lastUpdateTime = Date.now();
        this.saveFile = path.join(process.cwd(), `export_progress_${guildId}.json`);
        this.totalMessagesFetched = 0;
    }

    async save() {
        const data = {
            processedUsers: Array.from(this.processedUsers),
            currentBatch: this.currentBatch,
            startTime: this.startTime,
            lastUpdateTime: Date.now(),
            totalMessagesFetched: this.totalMessagesFetched
        };
        try {
            await fs.writeFile(this.saveFile, JSON.stringify(data, null, 2));
            debugLog(`Progress saved: ${this.processedUsers.size} users processed`);
        } catch (error) {
            debugLog('Error saving progress:', error);
        }
    }

    async load() {
        try {
            const data = JSON.parse(await fs.readFile(this.saveFile));
            this.processedUsers = new Set(data.processedUsers);
            this.currentBatch = data.currentBatch;
            this.startTime = data.startTime;
            this.lastUpdateTime = data.lastUpdateTime || Date.now();
            this.totalMessagesFetched = data.totalMessagesFetched || 0;
            debugLog(`Progress loaded: ${this.processedUsers.size} users previously processed`);
            return true;
        } catch (e) {
            debugLog('No previous progress found, starting fresh');
            return false;
        }
    }

    async cleanup() {
        try {
            await fs.unlink(this.saveFile);
            debugLog('Progress file cleaned up');
        } catch (e) {
            // Ignore if file doesn't exist
        }
    }

    updateTotalMessagesFetched(count) {
        this.totalMessagesFetched += count;
        process.stdout.write(`\rTotal messages fetched: ${this.totalMessagesFetched}`);
    }
}

async function getUserMessageCount(guild, userId, progress) {
    let totalMessages = 0;
    const textChannels = guild.channels.cache.filter(
        channel => channel.type === 0 && channel.viewable
    );

    debugLog(`Counting messages for user ${userId} in ${textChannels.size} channels`);

    for (const [channelId, channel] of textChannels) {
        try {
            let lastMessageId = null;
            let channelMessages = 0;
            let keepFetching = true;

            debugLog(`Fetching messages in channel ${channel.name} for user ${userId}`);

            while (keepFetching) {
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

                const messages = await channel.messages.fetch({
                    limit: MESSAGE_BATCH_SIZE,
                    ...(lastMessageId && { before: lastMessageId })
                });

                if (messages.size === 0) break;

                const userMessages = messages.filter(msg => msg.author.id === userId);
                channelMessages += userMessages.size;
                totalMessages += userMessages.size;
                lastMessageId = messages.last().id;

                if (messages.size < MESSAGE_BATCH_SIZE) break;

                progress.updateTotalMessagesFetched(messages.size);
            }

            channel.messages.cache.clear();

            if (channelMessages > 0) {
                debugLog(`Channel ${channel.name}: ${channelMessages} messages for user ${userId}`);
            }

        } catch (error) {
            debugLog(`Error in channel ${channel.name}:`, error);
            continue;
        }
    }

    debugLog(`Total messages for user ${userId}: ${totalMessages}`);
    return totalMessages;
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function updateProgressMessage(progressMessage, progress, member, members, startTime) {
    const currentTime = Date.now();
    const elapsedTime = (currentTime - startTime) / 1000;
    const processedCount = progress.processedUsers.size;
    const remainingUsers = members.length - processedCount;
    
    const timePerUser = processedCount > 0 ? elapsedTime / processedCount : 0;
    const estimatedTimeRemaining = processedCount > 0 ? (timePerUser * remainingUsers) : 0;
    
    const progressPercent = ((processedCount / members.length) * 100).toFixed(2);
    const progressBar = '█'.repeat(Math.floor(progressPercent / 5)) + '░'.repeat(20 - Math.floor(progressPercent / 5));

    const progressMsg = [
        `🤖 **Discord User Data Export**`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `Progress: ${progressBar} ${progressPercent}%`,
        ``,
        `📊 **Status**`,
        `• Batch: ${progress.currentBatch}/${progress.totalBatches}`,
        `• Processed: ${processedCount}/${members.length} users`,
        `• Current: ${member.user.tag}`,
        ``,
        `⏱ **Timing**`,
        `• Per User: ${timePerUser.toFixed(1)}s`,
        `• Elapsed: ${formatTime(elapsedTime)}`,
        `• Remaining: ${formatTime(estimatedTimeRemaining)}`,
        ``,
        `🔄 Last Update: ${new Date().toISOString().replace('T', ' ').split('.')[0]} UTC`
    ].join('\n');

    try {
        await progressMessage.edit(progressMsg);
        progress.lastUpdateTime = currentTime;
        debugLog(`Progress message updated: ${processedCount}/${members.length}`);
    } catch (error) {
        debugLog('Failed to update progress message:', error);
    }
}

async function exportUserDataToCSV(guild, progressMessage) {
    debugLog('Starting CSV export with batch processing');
    
    const progress = new ExportProgress(guild.id);
    const resuming = await progress.load();

    const csvHeader = ['User ID', 'Username', 'Highest Role', 'Server Join Date', 'Discord Join Date', 'Message Count'];
    let csvRows = resuming ? [] : [csvHeader];

    await guild.members.fetch();
    const members = Array.from(guild.members.cache.values())
        .filter(member => !member.user.bot && !progress.processedUsers.has(member.id));

    progress.totalBatches = Math.ceil(members.length / BATCH_SIZE);

    const tempFilePath = path.join(process.cwd(), `temp_export_${guild.id}_${Date.now()}.csv`);
    const finalFilePath = path.join(process.cwd(), `user_data_${guild.id}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);

    try {
        for (let i = 0; i < members.length; i += BATCH_SIZE) {
            progress.currentBatch++;
            const batch = members.slice(i, i + BATCH_SIZE);
            
            for (const member of batch) {
                const currentTime = Date.now();
                if (currentTime - progress.lastUpdateTime >= MESSAGE_UPDATE_INTERVAL) {
                    await updateProgressMessage(progressMessage, progress, member, members, progress.startTime);
                }

                let messageCount = 0;
                try {
                    messageCount = await getUserMessageCount(guild, member.id, progress);
                } catch (error) {
                    debugLog(`Error counting messages for ${member.user.tag}:`, error);
                }

                csvRows.push([
                    member.id,
                    cleanCSVString(`${member.user.username}#${member.user.discriminator}`),
                    cleanCSVString(member.roles.highest.name),
                    formatDate(member.joinedAt),
                    formatDate(member.user.createdAt),
                    messageCount
                ]);

                progress.processedUsers.add(member.id);
                
                if (progress.processedUsers.size % SAVE_INTERVAL === 0) {
                    await progress.save();
                }

                if (csvRows.length >= 100) {
                    await fs.appendFile(tempFilePath, csvRows.map(row => row.join(',')).join('\n') + '\n');
                    csvRows = [];
                }
            }
        }

        if (csvRows.length > 0) {
            await fs.appendFile(tempFilePath, csvRows.map(row => row.join(',')).join('\n') + '\n');
        }

        const BOM = '\ufeff';
        const finalContent = BOM + await fs.readFile(tempFilePath, 'utf-8');
        await fs.writeFile(finalFilePath, finalContent);
        await fs.unlink(tempFilePath);
        
        // Final progress update
        await updateProgressMessage(progressMessage, progress, members[members.length - 1], members, progress.startTime);
        
        return finalFilePath;

    } catch (error) {
        debugLog('Error in export:', error);
        throw error;
    } finally {
        await progress.cleanup();
    }
}

module.exports = {
    ExportProgress,
    exportUserDataToCSV,
    getUserMessageCount
};