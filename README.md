# Discord Counter Bot

## Functionality

Discord bot for automated member counting and management in Discord servers. Provides real-time channel name updates with member counts, CSV exports of user data, and automated member purging based on verification status or role assignments.

## Usage Scenarios

- Automatically update voice channel names to display real-time member counts by role tier
- Track total server member count in a dedicated channel
- Export member data including message counts, join dates, and roles to CSV format
- List unverified members for manual review
- Automated purging of unverified members or members without roles

## Commands

All commands require specific role permissions and must be used in designated channels (configured via environment variables).

### Member Counting Commands

- `!count` - Display current member counts by role tier with percentages
- `!count unverified` - List all unverified members with user mentions
- `!count export` - Generate and download CSV export of all server members with message counts

### Data Export Commands

- `!extract unverified` - Export unverified members to CSV file with join dates and account creation dates
- `!extract noroles` - Export members without any roles to CSV file with time without roles

### Purge Commands

- `!purge noroles rate=X` - Start automated purge of members without roles (X per hour, only affects users joined >24h ago)
- `!purge unverified rate=X` - Start automated purge of unverified members (X per hour, only affects users joined >24h ago)
- `!purge status noroles` - Check status of noroles purge operation
- `!purge status unverified` - Check status of unverified purge operation
- `!purge stop noroles` - Stop noroles purge operation
- `!purge stop unverified` - Stop unverified purge operation

## Required Permissions

### Bot Permissions

The Discord bot requires the following permissions:
- Manage Channels (to update channel names)
- View Channels
- Send Messages
- Read Message History
- Kick Members (for purge operations)
- Attach Files (for CSV exports)

### Gateway Intents

Required intents in Discord Developer Portal:
- Guilds
- Guild Messages
- Guild Members (privileged intent)
- Message Content (privileged intent)

### Environment Variables

Create a `.env` file with the following configuration:

```
# Bot Configuration
DISCORD_TOKEN=your_bot_token_here

# Permissions
ALLOWED_ROLES=Role1,Role2,Role3
ALLOWED_CHANNELS=channel_id_1,channel_id_2

# Member Roles
VERIFIED_ROLE=verified_role_id
IGNORED_ROLE=role_id_1,role_id_2

# Count Roles (up to 6 role tiers)
COUNT_ROLE_1=role_id_1
COUNT_ROLE_2=role_id_2
COUNT_ROLE_3=role_id_3
COUNT_ROLE_4=role_id_4
COUNT_ROLE_5=role_id_5
COUNT_ROLE_6=role_id_6

# Total Member Count Channel
TOTAL_MEMBER_COUNT_CHANNEL_ID=channel_id
TOTAL_MEMBER_COUNT_NAME_FORMAT=Total Members: {count}

# Scheduled Role Channels (up to 6)
SCHEDULED_ROLE_1=role_id
SCHEDULED_CHANNEL_1=channel_id
SCHEDULED_CHANNEL_NAME_1=Role Name: {count}

SCHEDULED_ROLE_2=role_id
SCHEDULED_CHANNEL_2=channel_id
SCHEDULED_CHANNEL_NAME_2=Role Name: {count}

# Continue pattern for SCHEDULED_ROLE_3 through SCHEDULED_ROLE_6

# Update Interval
INTERVAL_MINUTES=5

# Debug Mode (optional)
DEBUG_MODE=false
```

### Role Configuration

- `ALLOWED_ROLES`: Comma-separated list of role names that can execute bot commands
- `ALLOWED_CHANNELS`: Comma-separated list of channel IDs where bot commands can be executed
- `VERIFIED_ROLE`: Role ID used to identify verified members
- `IGNORED_ROLE`: Optional comma-separated list of role IDs to exclude from counting
- `COUNT_ROLE_1` through `COUNT_ROLE_6`: Role IDs for hierarchical member counting (highest priority first)

## Installation and Execution

### Prerequisites

- Node.js (version 16 or higher)
- Discord bot token with required intents enabled
- Server Administrator permissions to configure channels and roles

### Install Dependencies

```bash
npm install
```

### Start the Bot

```bash
npm start
```

Or run directly:

```bash
node counter.js
```

### Debug Mode

Enable debug logging by setting `DEBUG_MODE=true` in your `.env` file. Debug logs include:
- Command execution details
- Member counting verification
- Role assignment tracking
- Purge operation logs

## Operation Details

### Automatic Channel Updates

The bot updates channel names on a scheduled interval (configured via `INTERVAL_MINUTES`):
- Total member count channel updated with non-bot member count
- Role-specific channels updated with count of members whose highest count role matches
- Members with ignored roles are excluded from all counts

### Message Tracking

The bot counts messages on-demand during CSV exports:
- Message counts are fetched from Discord's message history during export operations
- No real-time message tracking or caching in memory
- Counts include all historical messages accessible to the bot across all channels
- **Note**: For large servers, the `!count export` command may take significant time to complete as it fetches message history for each user

### Purge Safety Features

Automated purge operations include safety measures:
- Only affects users who joined more than 24 hours ago
- Processes users in batches at specified hourly rate
- Re-validates conditions before kicking each member
- Provides detailed logging for all actions
- Can be stopped at any time

### CSV Export Format

Exports include the following fields:
- User ID
- Username
- Highest Role (from count roles)
- Server Join Date (UTC)
- Discord Account Creation Date (UTC)
- Message Count (historical, fetched on-demand from all accessible channels)

## Notes

- All dates and times are in UTC format
- Channel name updates respect Discord's rate limits (2 updates per 10 minutes per channel)
- CSV files use UTF-8 encoding with BOM for Excel compatibility
- Bot requires privileged intents to be enabled in Discord Developer Portal
