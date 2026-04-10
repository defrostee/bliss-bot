const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, WebhookClient, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Persistent Storage ───────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

function getGuild(guildId) {
  if (!db[guildId]) db[guildId] = {};
  return db[guildId];
}

function save() { saveData(db); }

// ─── Ping messages ────────────────────────────────────────────────────────────
const PING_MESSAGES = [
  'why must you wake me up',
  'great.. what do you want?',
  'you interrupted my meditation!',
  'ping me again, i dare you.',
  'what the hell could you possibly need from me?',
  'im too tired for ts.',
  'let. me. sleep.',
  'this better be good.',
];

const DARE_NICKNAMES = [
  `obsessed with {BOT}`,
  `pings {BOT} too much`,
  `hated by {BOT}`,
  `annoying {BOT} pinger`,
  `meat bag`,
];

// Track who got the "dare" ping message
const dareUsers = new Map(); // userId -> boolean

// ─── Bump reminder intervals ──────────────────────────────────────────────────
const bumpIntervals = new Map(); // guildId -> intervalId

function startBumpReminder(guildId) {
  // Clear any existing interval for this guild
  if (bumpIntervals.has(guildId)) {
    clearInterval(bumpIntervals.get(guildId));
  }

  const intervalId = setInterval(async () => {
    const g = getGuild(guildId);
    if (!g.bumpr?.enabled) {
      clearInterval(bumpIntervals.get(guildId));
      bumpIntervals.delete(guildId);
      return;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(g.bumpr.channelId);
      if (!channel) return;

      const pingText = g.bumpr.pingRoleId ? `<@&${g.bumpr.pingRoleId}> ` : '';
      await channel.send(`${pingText}⏰ Time to bump the server! Use \`/bump\` from Disboard.`);
    } catch (e) {
      console.error(`Bump reminder error for guild ${guildId}:`, e.message);
    }
  }, 60 * 60 * 1000); // every hour

  bumpIntervals.set(guildId, intervalId);
}

function stopBumpReminder(guildId) {
  if (bumpIntervals.has(guildId)) {
    clearInterval(bumpIntervals.get(guildId));
    bumpIntervals.delete(guildId);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isOwner(member) {
  return member.id === member.guild.ownerId;
}

function getModRole(guildId) {
  return getGuild(guildId).modRole || null;
}

function hasModRole(member) {
  const modRoleId = getModRole(member.guild.id);
  if (!modRoleId) return false;
  return member.roles.cache.has(modRoleId);
}

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Prefix: -`);
  console.log(`   Servers: ${client.guilds.cache.size}`);

  // Restart any active bump reminders after bot restarts
  for (const [guildId, gData] of Object.entries(db)) {
    if (gData.bumpr?.enabled && gData.bumpr?.channelId) {
      console.log(`   Restarting bump reminder for guild ${guildId}`);
      startBumpReminder(guildId);
    }
  }
});

// ─── Auto-role on join ────────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  const g = getGuild(member.guild.id);
  if (!g.autorole) return;
  try {
    const role = await member.guild.roles.fetch(g.autorole);
    if (role) await member.roles.add(role);
  } catch (e) {
    console.error('Autorole error:', e.message);
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const g = getGuild(message.guild.id);

  // ─── Ping protection ────────────────────────────────────────────────────────
  const protectedPings = g.protectedPings || [];

  for (const targetId of protectedPings) {
    const mentioned = message.mentions.users.has(targetId) || message.mentions.roles.cache?.has(targetId);
    if (!mentioned) continue;

    const key = `${message.guild.id}:${message.author.id}:${targetId}`;
    const current = (g.pingOffences?.[key]) || 0;
    const next = current + 1;
    if (!g.pingOffences) g.pingOffences = {};
    g.pingOffences[key] = next;
    save();

    const target = await message.guild.members.fetch(targetId).catch(() => null)
      || message.guild.roles.cache.get(targetId);
    const name = target?.displayName || target?.name || `<@${targetId}>`;

    if (next === 1) {
      await message.reply(`HEY! please dont ping ${name}!`);
    } else if (next === 2) {
      await message.reply(`s t o p     p i n g i n g        ${name}     p l e a s e !`);
      try { await message.member.timeout(5 * 60 * 1000, 'Repeated pinging of protected user'); } catch {}
    } else if (next === 3) {
      await message.reply(`now you're being punished. i warned you.`);
      try { await message.member.timeout(3 * 24 * 60 * 60 * 1000, 'Repeated pinging of protected user'); } catch {}
    } else if (next === 4) {
      await message.reply(`you're getting kicked, next is ban.`);
      try {
        await message.author.send(`you're getting kicked from **${message.guild.name}**, next is ban.`).catch(() => {});
        await message.member.kick('Repeated pinging of protected user');
      } catch {}
    } else if (next >= 5) {
      await message.reply(`we will not appeal you. you should've listened`);
      try {
        await message.author.send(`we will not appeal you. you should've listened`).catch(() => {});
        await message.member.ban({ reason: 'Repeated pinging of protected user' });
      } catch {}
    }
    return;
  }

  // ─── Commands ───────────────────────────────────────────────────────────────
  if (!message.content.startsWith('-')) return;

  const raw = message.content.slice(1).trim();
  const args = raw.split(/\s+/);
  const cmd = args[0]?.toLowerCase();

  // ── -ping ──────────────────────────────────────────────────────────────────
  if (cmd === 'ping') {
    const userId = message.author.id;
    if (dareUsers.get(userId)) {
      dareUsers.delete(userId);
      const botName = message.guild.members.me?.displayName || client.user.username;
      const template = DARE_NICKNAMES[Math.floor(Math.random() * DARE_NICKNAMES.length)];
      const newNick = template.replace('{BOT}', botName);
      try { await message.member.setNickname(newNick, 'You were warned about pinging'); } catch {}
      return message.reply('i warned you');
    }

    const response = PING_MESSAGES[Math.floor(Math.random() * PING_MESSAGES.length)];
    await message.reply(response);
    if (response === 'ping me again, i dare you.') {
      dareUsers.set(userId, true);
    }
    return;
  }

  // ── -help ──────────────────────────────────────────────────────────────────
  if (cmd === 'help') {
    const guildData = getGuild(message.guild.id);
    const ownerId = message.guild.ownerId;
    const modRoleId = guildData.modRole;

    let mentions = `<@${ownerId}>`;
    if (modRoleId) mentions += ` <@&${modRoleId}>`;

    const embed = new EmbedBuilder()
      .setTitle('📖 Bot Help')
      .setColor(0x5865F2)
      .addFields(
        { name: '`-ping`', value: 'Check if bot is alive', inline: true },
        { name: '`-help`', value: 'Show this message', inline: true },
        { name: '`-nuke #channel`', value: 'Clear all messages in a channel (mod only)', inline: false },
        { name: '`-fnitro option:react emoji-id:ID message-id:ID`', value: 'Fake react with nitro emoji via webhook', inline: false },
        { name: '`-fnitro option:sticker sticker-id:ID`', value: 'Send a nitro sticker via webhook', inline: false },
        { name: '`-color color:#RRGGBB`', value: 'Set your personal cosmetic color role', inline: false },
        { name: '`-bumpr enabled:yes/no #channel ping:yes/no @role`', value: 'Enable/disable hourly bump reminders in a channel with optional role ping (owner only)', inline: false },
        { name: '`-s!mr @role`', value: 'Set the mod role (owner only)', inline: false },
        { name: '`-s!ping set:yes/no @user_or_role`', value: 'Protect a user/role from pings (owner only)', inline: false },
        { name: '`-s!autorole @role`', value: 'Set auto-role for new members (owner only)', inline: false },
      )
      .setFooter({ text: 'Pinging support…' });

    await message.channel.send({ content: mentions, embeds: [embed] });
    return;
  }

  // ── -nuke #channel ─────────────────────────────────────────────────────────
  if (cmd === 'nuke') {
    if (!isOwner(message.member) && !hasModRole(message.member)) {
      return message.reply('❌ You need the mod role to use this command.');
    }

    const targetChannel = message.mentions.channels.first() || message.channel;

    if (!targetChannel.isTextBased()) {
      return message.reply('❌ That channel is not a text channel.');
    }

    const botMember = message.guild.members.me;
    if (!targetChannel.permissionsFor(botMember).has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('❌ I need **Manage Messages** permission in that channel.');
    }

    try {
      const position = targetChannel.position;
      const cloned = await targetChannel.clone({ reason: `Channel purge by ${message.author.tag}` });
      await cloned.setPosition(position);
      await targetChannel.delete(`Channel purge by ${message.author.tag}`);
      await cloned.send('💥 Channel has been purged.');
    } catch (e) {
      console.error('Nuke error:', e);
      message.reply('❌ Failed to purge channel: ' + e.message).catch(() => {});
    }
    return;
  }

  // ── -bumpr ─────────────────────────────────────────────────────────────────
  if (cmd === 'bumpr') {
    if (!isOwner(message.member)) return message.reply('❌ Owner only.');

    // Parse named args
    const parsedArgs = {};
    for (let i = 1; i < args.length; i++) {
      const colonIdx = args[i].indexOf(':');
      if (colonIdx !== -1) {
        const key = args[i].slice(0, colonIdx).toLowerCase();
        const val = args[i].slice(colonIdx + 1).toLowerCase();
        parsedArgs[key] = val;
      }
    }

    const enabledArg = parsedArgs['enabled'];
    if (!enabledArg || (enabledArg !== 'yes' && enabledArg !== 'no')) {
      return message.reply('❌ Usage: `-bumpr enabled:yes/no #channel ping:yes/no @role`');
    }

    const gData = getGuild(message.guild.id);

    if (enabledArg === 'no') {
      gData.bumpr = { enabled: false };
      save();
      stopBumpReminder(message.guild.id);
      return message.reply('✅ Bump reminders **disabled**.');
    }

    // enabled:yes — need a channel
    const channel = message.mentions.channels.first();
    if (!channel) {
      return message.reply('❌ Please mention a channel. Usage: `-bumpr enabled:yes #channel ping:yes/no @role`');
    }

    const pingArg = parsedArgs['ping'];
    const wantsPing = pingArg === 'yes';
    const pingRole = wantsPing ? message.mentions.roles.first() : null;

    if (wantsPing && !pingRole) {
      return message.reply('❌ You set `ping:yes` but didn\'t mention a role.');
    }

    gData.bumpr = {
      enabled: true,
      channelId: channel.id,
      pingRoleId: pingRole?.id || null,
    };
    save();
    startBumpReminder(message.guild.id);

    const roleText = pingRole ? ` and will ping <@&${pingRole.id}>` : ' with no role ping';
    return message.reply(`✅ Bump reminders **enabled** in <#${channel.id}>${roleText} every hour.`);
  }

  // ── -fnitro ────────────────────────────────────────────────────────────────
  if (cmd === 'fnitro') {
    const parsedArgs = {};
    for (let i = 1; i < args.length; i++) {
      const [key, val] = args[i].split(':');
      if (key && val) parsedArgs[key.toLowerCase()] = val;
    }

    const option = parsedArgs['option'];

    if (option === 'react') {
      const emojiId = parsedArgs['emoji-id'];
      const messageId = parsedArgs['message-id'];

      if (!emojiId || !messageId) {
        return message.reply('❌ Usage: `-fnitro option:react emoji-id:EMOJI_ID message-id:MESSAGE_ID`');
      }

      const emoji = client.emojis.cache.get(emojiId);
      if (!emoji) return message.reply('❌ Emoji not found. Make sure the bot is in a server that has this emoji.');

      let targetMsg;
      try {
        targetMsg = await message.channel.messages.fetch(messageId);
      } catch {
        return message.reply('❌ Could not find that message in this channel.');
      }

      const webhook = await getOrCreateWebhook(message.channel);
      if (!webhook) return message.reply('❌ Could not create webhook in this channel.');

      const member = message.member;
      const avatarURL = member.displayAvatarURL({ dynamic: true });

      await webhook.send({
        username: member.displayName,
        avatarURL,
        content: `${emoji} *(reacted to [this message](https://discord.com/channels/${message.guild.id}/${message.channel.id}/${messageId}))*`,
      });

      await message.delete().catch(() => {});
      return;
    }

    if (option === 'sticker') {
      const stickerId = parsedArgs['sticker-id'];
      if (!stickerId) return message.reply('❌ Usage: `-fnitro option:sticker sticker-id:STICKER_ID`');

      let sticker;
      try {
        sticker = await client.fetchSticker(stickerId);
      } catch {
        return message.reply('❌ Could not find that sticker.');
      }

      const webhook = await getOrCreateWebhook(message.channel);
      if (!webhook) return message.reply('❌ Could not create webhook in this channel.');

      const member = message.member;
      const avatarURL = member.displayAvatarURL({ dynamic: true });
      const stickerUrl = `https://media.discordapp.net/stickers/${stickerId}.${sticker.format === 'LOTTIE' ? 'json' : 'webp'}?size=240`;

      await webhook.send({
        username: member.displayName,
        avatarURL,
        content: `*(sent a sticker: **${sticker.name}**)*\n${stickerUrl}`,
      });

      await message.delete().catch(() => {});
      return;
    }

    return message.reply('❌ Invalid option. Use `option:react` or `option:sticker`.');
  }

  // ── -color ─────────────────────────────────────────────────────────────────
  if (cmd === 'color') {
    const colorArg = args.find(a => a.toLowerCase().startsWith('color:'));
    if (!colorArg) return message.reply('❌ Usage: `-color color:#RRGGBB`');

    const hex = colorArg.split(':')[1];
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      return message.reply('❌ Invalid hex color. Example: `-color color:#FF5733`');
    }

    const roleName = `color:${message.member.displayName}`;
    let role = message.guild.roles.cache.find(r => r.name === roleName);

    try {
      if (role) {
        await role.setColor(hex);
        await message.reply(`✅ Updated your color role to **${hex}**!`);
      } else {
        role = await message.guild.roles.create({
          name: roleName,
          color: hex,
          permissions: [],
          reason: `Cosmetic color role for ${message.author.tag}`,
        });
        await message.member.roles.add(role);
        await message.reply(`✅ Created your color role with **${hex}**!`);
      }
    } catch (e) {
      message.reply('❌ Failed to manage role: ' + e.message);
    }
    return;
  }

  // ── -s!mr ──────────────────────────────────────────────────────────────────
  if (cmd === 's!mr') {
    if (!isOwner(message.member)) return message.reply('❌ Owner only.');

    const role = message.mentions.roles.first();
    if (!role) return message.reply('❌ Please mention a role. Usage: `-s!mr @role`');

    const gData = getGuild(message.guild.id);
    gData.modRole = role.id;
    save();

    return message.reply(`✅ Mod role set to **${role.name}**.`);
  }

  // ── -s!ping ────────────────────────────────────────────────────────────────
  if (cmd === 's!ping') {
    if (!isOwner(message.member)) return message.reply('❌ Owner only.');

    const setArg = args.find(a => a.toLowerCase().startsWith('set:'));
    if (!setArg) return message.reply('❌ Usage: `-s!ping set:yes/no @user_or_role`');

    const setting = setArg.split(':')[1]?.toLowerCase();
    if (setting !== 'yes' && setting !== 'no') return message.reply('❌ set must be `yes` or `no`.');

    const targetUser = message.mentions.users.first();
    const targetRole = message.mentions.roles.first();
    const targetId = targetUser?.id || targetRole?.id;

    if (!targetId) return message.reply('❌ Please mention a user or role.');

    const gData = getGuild(message.guild.id);
    if (!gData.protectedPings) gData.protectedPings = [];

    if (setting === 'yes') {
      if (!gData.protectedPings.includes(targetId)) {
        gData.protectedPings.push(targetId);
        save();
        return message.reply(`✅ Ping protection **enabled** for <@${targetId}> ${targetRole ? '(role)' : '(user)'}.`);
      } else {
        return message.reply('ℹ️ Already protected.');
      }
    } else {
      gData.protectedPings = gData.protectedPings.filter(id => id !== targetId);
      save();
      return message.reply(`✅ Ping protection **disabled** for <@${targetId}>.`);
    }
  }

  // ── -s!autorole ────────────────────────────────────────────────────────────
  if (cmd === 's!autorole') {
    if (!isOwner(message.member)) return message.reply('❌ Owner only.');

    const role = message.mentions.roles.first();
    if (!role) return message.reply('❌ Please mention a role. Usage: `-s!autorole @role`');

    const gData = getGuild(message.guild.id);
    gData.autorole = role.id;
    save();

    return message.reply(`✅ Auto-role set to **${role.name}**. New members will receive it on join.`);
  }
});

// ─── Webhook helper ───────────────────────────────────────────────────────────
async function getOrCreateWebhook(channel) {
  try {
    const webhooks = await channel.fetchWebhooks();
    let wh = webhooks.find(w => w.owner?.id === client.user.id);
    if (!wh) {
      wh = await channel.createWebhook({ name: client.user.username, avatar: client.user.displayAvatarURL() });
    }
    return wh;
  } catch (e) {
    console.error('Webhook error:', e.message);
    return null;
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN environment variable is not set!');
  process.exit(1);
}

client.login(token);
