import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const whatsappClient = new Client({
    authStrategy: new LocalAuth()
});

whatsappClient.on('qr', (qr) => qrcode.generate(qr, { small: true }));
whatsappClient.on('ready', () => console.log('WhatsApp client is ready'));
whatsappClient.on('message', async (msg) => {
    try {
        if (msg.from !== 'status@broadcast') {
            const contact = await msg.getContact();
            console.log(`Message from ${contact.name}: ${msg.body}`);
            await msg.reply('hi');
        }
    } catch (err) {
        console.log(err);
    }
});

whatsappClient.initialize();

export default whatsappClient;