module.exports = {
    description: "Show Commands and the descriptions",
    role: "user",
    credits: "rejardgwapo",
    cooldown: 16,		
    execute(api, event, args, commands) {
        let helpMessage = '𝙷𝚒! 𝚃𝚑𝚒𝚜 𝙱𝚘𝚝 𝚒𝚜 𝚌𝚛𝚎𝚊ted by Bioscope08 𝙷𝚎𝚛𝚎 𝚊𝚛𝚎 𝚊𝚕𝚕 𝚝𝚑𝚎 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜 𝚒𝚗𝚜𝚝𝚊𝚕𝚕𝚎𝚍 𝚘𝚗 𝚝𝚑𝚒𝚜 𝚜𝚎𝚛𝚟𝚎𝚛\n';
        helpMessage += '💮═══════════════💮\n';
        commands.forEach((command, name) => {
            helpMessage += `𝙽𝚊𝚖𝚎: ${name}\n`;
            helpMessage += `𝙳𝚎𝚜𝚌𝚛𝚒𝚙𝚝𝚒𝚘𝚗: ${command.description || 'No description provided'}\n`;
            helpMessage += `𝚁𝚘𝚕𝚎: ${command.role || 'user'}\n`;
            helpMessage += `Credits: ${command.credits || 'Chatbot Community 2025'}\n`;
            helpMessage += `Costs: ${command.coins !== undefined ? command.coins : 'Free'}\n`;
            helpMessage += `Cooldown: ${command.cooldown !== undefined ? command.cooldown : 'No cooldown'}\n`;
            helpMessage += '💮═══════════════💮\n';
        });
        helpMessage += '💬https://www.facebook.com/profile.php?id=61571494527595';
        api.sendMessage(helpMessage, event.threadID);
    }
};
